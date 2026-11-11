/**
 * 静态沙盒模型合批器。
 *
 * AI 建模/GLB 恢复的模型常把同一材质拆成数百个小 mesh（塔吊 276、茅草屋 262），
 * 全场景因此产生 600+ draw call，而三角形总量很小，瓶颈在 CPU 绘制提交而非 GPU。
 * 本模块在模型内部按材质分组合并几何，把 draw call 降到材质数量级：
 *   - 只合批“纯装饰”mesh。注意 createObjectSculptModel 会给每个节点（Group 与
 *     mesh）都挂 componentId，所以“有 componentId 就保护”会跳过整棵树；真正的保护
 *     依据是 collectProtectedPartIds 枚举的**运行时清单引用**（碰撞/支撑面/水域/
 *     楼梯坡道/室内入口/环境绑定/能力控制文档），以及带 stateBinding /
 *     interactionConfig 运行时标记的对象子树
 *   - 几何烘焙到模型根的局部空间，合批 mesh 挂在根下的独立 Group；
 *     根节点 position/rotation/scale 与 sandboxModelId 不变，选中/变换/raycast 回溯不受影响
 *   - 合批 mesh 记录源部件 ID 与面范围（staticBatchPartIds/staticBatchSourceRanges），
 *     resolveStaticBatchPartId 可把 raycast 命中的 faceIndex 还原为 componentId，
 *     部件点选契约（onSandboxPartSelected）不因合批而失效
 *   - 材质对象共享、不释放；被消费的旧 geometry 立即释放
 *   - 属性不兼容导致 mergeGeometries 失败时整组回退，绝不丢几何
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const STATIC_BATCH_ROOT_NAME = '_staticBatchRoot'
const STATIC_BATCH_MARK = 'staticBatched'

const EMPTY_RESULT = Object.freeze({
  mergedMeshCount: 0,
  consumedMeshCount: 0,
  skippedMeshCount: 0,
  materialGroups: Object.freeze([]),
})

function addPartId(ids, value) {
  if (typeof value === 'string' && value.trim()) ids.add(value)
}

function addPartScopedRecordIds(ids, record) {
  if (!record || typeof record !== 'object') return
  const scope = record.scope
  if (!scope || typeof scope !== 'object') return
  // 按部件定位的记录（scope.partId，或 targetType === 'part' 的 targetId）。
  addPartId(ids, scope.partId)
  if (scope.targetType === 'part') addPartId(ids, scope.targetId)
}

function addRecordsPartIds(ids, records) {
  if (!Array.isArray(records)) return
  for (const record of records) addPartId(ids, record?.targetPartId)
}

/**
 * 枚举模型中所有被运行时系统实际引用的 componentId。
 * 与 modelSpatialRuntime/waterVolumeRuntime/sandboxInteriorRuntime/
 * worldStateRuntime(applyEnvironmentBindings)/capabilityControl 的消费点一一对应。
 * @returns {Set<string>} 需要保留原始节点树的部件 ID 集
 */
export function collectProtectedPartIds(root) {
  const ids = new Set()
  const userData = root?.userData || {}
  const manifest = userData.proceduralModelCapabilityManifest || {}
  const capabilities = manifest.capabilities || {}
  const spatial = capabilities.spatial || {}
  addRecordsPartIds(ids, spatial.colliders)
  addRecordsPartIds(ids, spatial.surfaces)
  if (Array.isArray(spatial.waterVolumes)) {
    for (const volume of spatial.waterVolumes) {
      addPartId(ids, volume?.targetPartId)
      addPartId(ids, volume?.surfacePartId)
    }
  }
  const traversability = spatial.traversability || {}
  for (const key of ['stairs', 'ramps', 'jumps', 'passages', 'connections']) {
    addRecordsPartIds(ids, traversability[key])
  }
  addRecordsPartIds(ids, capabilities.interior?.entryPoints)
  addRecordsPartIds(ids, capabilities.visual?.animations)
  addRecordsPartIds(ids, capabilities.environmentBindings)
  addRecordsPartIds(ids, userData.proceduralModelEnvironmentBindings)
  const control = userData.proceduralModelCapabilityControlDocument || {}
  if (Array.isArray(control.overrides)) {
    for (const record of control.overrides) addPartScopedRecordIds(ids, record)
  }
  if (Array.isArray(control.inference?.proposals)) {
    for (const record of control.inference.proposals) addPartScopedRecordIds(ids, record)
  }
  if (Array.isArray(manifest.parameters)) {
    for (const parameter of manifest.parameters) {
      if (!Array.isArray(parameter?.bindings)) continue
      for (const binding of parameter.bindings) addPartScopedRecordIds(ids, binding)
    }
  }
  return ids
}

function hasRuntimeMarkedAncestor(mesh, root) {
  let node = mesh.parent
  while (node && node !== root) {
    const userData = node.userData || {}
    // stateBinding 驱动可见性/旋转/发光；interactionConfig 驱动交互索引与动作目标。
    if (userData.stateBinding || userData.interactionConfig?.action) return true
    node = node.parent
  }
  return false
}

function hasProtectedAncestor(mesh, root, protectedIds) {
  let node = mesh
  while (node) {
    const componentId = node.userData?.componentId
    if (componentId != null && protectedIds.has(String(componentId))) return true
    if (node === root) break
    node = node.parent
  }
  return false
}

function isBatchableMesh(mesh, root, protectedIds) {
  if (!mesh?.isMesh) return false
  return skipReason(mesh, root, protectedIds) === null
}

function skipReason(mesh, root, protectedIds) {
  if (mesh === root) return 'root'
  if (mesh.visible === false) return 'invisible'
  if (mesh.isSkinnedMesh) return 'skinned'
  if (Array.isArray(mesh.material) || !mesh.material) return 'materialArray'
  if (!mesh.geometry?.getAttribute?.('position')) return 'noPosition'
  if (mesh.morphTargetInfluences?.length) return 'morph'
  if (mesh.raycast !== THREE.Mesh.prototype.raycast) return 'customRaycast'
  if (hasRuntimeMarkedAncestor(mesh, root)) return 'runtimeMarked'
  if (hasProtectedAncestor(mesh, root, protectedIds)) return 'protectedPart'
  return null
}

/**
 * 把合批 mesh 上 raycast 命中的 faceIndex 还原为源部件 componentId。
 * mergeGeometries 按输入顺序拼接索引，源几何在合并索引中的偏移即其首个三角面的
 * 索引偏移；staticBatchSourceRanges 在合并时按同一偏移记录。
 * @returns {string|null} 命中的部件 ID；未标注部件或非法输入返回 null
 */
export function resolveStaticBatchPartId(mesh, faceIndex) {
  const ranges = mesh?.userData?.staticBatchSourceRanges
  if (!Array.isArray(ranges) || !Number.isInteger(faceIndex) || faceIndex < 0) return null
  const cursor = faceIndex * 3
  for (const range of ranges) {
    if (cursor < range.start || cursor >= range.start + range.count) continue
    return typeof range.partId === 'string' ? range.partId : null
  }
  return null
}

function attributeSignature(geometry) {
  return Object.keys(geometry.attributes || {}).sort().join(',')
}

/**
 * 按（材质 × 属性签名）收集合批分区。mergeGeometries 要求同组几何的索引形态与
 * 属性布局完全一致，而真实模型混用 Box（有索引）与 Extrude（无索引）：
 * 合并前统一 toNonIndexed 消除索引差异，再按属性签名分区，兼容子集总能成组。
 */
function collectBatchPartitions(root, protectedIds) {
  const partitions = new Map()
  const skipReasons = {}
  let skippedMeshCount = 0
  let total = 0
  root.traverse((object) => {
    if (!object.isMesh) return
    total += 1
    const reason = skipReason(object, root, protectedIds)
    if (reason) {
      skipReasons[reason] = (skipReasons[reason] || 0) + 1
      skippedMeshCount += 1
      return
    }
    let byMaterial = partitions.get(object.material)
    if (!byMaterial) {
      byMaterial = new Map()
      partitions.set(object.material, byMaterial)
    }
    const signature = attributeSignature(object.geometry)
    const list = byMaterial.get(signature) || []
    list.push(object)
    byMaterial.set(signature, list)
  })
  return { partitions, skipReasons, skippedMeshCount, total }
}

/**
 * Dry-run diagnosis: explain why a model would or would not batch, without
 * mutating the scene. Used by the __batchAudit console command.
 */
export function explainBatching(root) {
  if (!root?.isObject3D) return null
  const protectedIds = collectProtectedPartIds(root)
  const { partitions, skipReasons, total } = collectBatchPartitions(root, protectedIds)
  const materialGroups = []
  let batchableMeshCount = 0
  for (const [material, bySignature] of partitions) {
    for (const [signature, meshes] of bySignature) {
      batchableMeshCount += meshes.length
      materialGroups.push({
        materialName: material.name || 'unnamed',
        meshCount: meshes.length,
        attributes: signature,
        willMerge: meshes.length >= 2,
      })
    }
  }
  return {
    name: root.name || root.type,
    total,
    skipReasons,
    batchableMeshCount,
    materialGroups,
  }
}

/**
 * Merge batchable meshes under root in place.
 * @param {THREE.Object3D} root sandbox model root carrying userData.sandboxModelId
 * @returns {{mergedMeshCount:number, consumedMeshCount:number, skippedMeshCount:number, materialGroups:Array}}
 */
export function batchStaticModel(root) {
  if (!root?.isObject3D || root.userData?.[STATIC_BATCH_MARK]) return { ...EMPTY_RESULT, materialGroups: [] }
  root.updateWorldMatrix(true, true)

  const protectedIds = collectProtectedPartIds(root)
  const { partitions, skippedMeshCount: initialSkipped } = collectBatchPartitions(root, protectedIds)
  let skippedMeshCount = initialSkipped

  const rootInverse = root.matrixWorld.clone().invert()
  const batchRoot = new THREE.Group()
  batchRoot.name = STATIC_BATCH_ROOT_NAME
  let mergedMeshCount = 0
  let consumedMeshCount = 0
  const materialGroups = []

  // 源 mesh 的部件归属：自身或最近祖先的 componentId（用于部件点选反向映射）。
  function sourcePartId(mesh) {
    let node = mesh
    while (node && node !== root) {
      const componentId = node.userData?.componentId
      if (componentId != null) return String(componentId)
      node = node.parent
    }
    return null
  }

  for (const [material, bySignature] of partitions) {
    for (const [, meshes] of bySignature) {
      // 单 mesh 分组合并无收益，保留原节点。
      if (meshes.length < 2) {
        skippedMeshCount += meshes.length
        continue
      }
      const bakedGeometries = meshes.map((mesh) => {
        // 统一为非索引几何：Box（有索引）与 Extrude（无索引）才能同组合并。
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
        const localToRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld)
        geometry.applyMatrix4(localToRoot)
        return geometry
      })
      const mergedGeometry = mergeGeometries(bakedGeometries, false)
      // 克隆体无论合并成功与否都不再需要。
      bakedGeometries.forEach((geometry) => geometry.dispose())
      if (!mergedGeometry) {
        // 属性布局仍不兼容（如 itemSize/类型不一致）：整组回退，原 mesh 一个都不动。
        continue
      }

      // 与 mergeGeometries 的拼接顺序一致地记录源范围（统一非索引后即顶点数）。
      let indexOffset = 0
      const sourceRanges = []
      const partIds = new Set()
      meshes.forEach((mesh) => {
        const geometry = mesh.geometry
        const count = geometry.index ? geometry.index.count : geometry.attributes.position.count
        const partId = sourcePartId(mesh)
        sourceRanges.push({ start: indexOffset, count, partId })
        if (partId) partIds.add(partId)
        indexOffset += count
      })

      const batchMesh = new THREE.Mesh(mergedGeometry, material)
      batchMesh.name = 'static-batch:' + (material.name || 'unnamed-material')
      batchMesh.castShadow = meshes.every(mesh => mesh.castShadow)
      batchMesh.receiveShadow = meshes.every(mesh => mesh.receiveShadow)
      batchMesh.userData.staticBatch = true
      batchMesh.userData.staticBatchSourceCount = meshes.length
      batchMesh.userData.staticBatchSourceRanges = sourceRanges
      batchMesh.userData.staticBatchPartIds = [...partIds]
      batchRoot.add(batchMesh)

      for (const mesh of meshes) {
        mesh.parent?.remove(mesh)
        mesh.geometry?.dispose?.()
        consumedMeshCount += 1
      }
      mergedMeshCount += 1
      materialGroups.push({
        materialName: material.name || '',
        meshCount: meshes.length,
      })
    }
  }

  if (mergedMeshCount === 0) return { mergedMeshCount: 0, consumedMeshCount: 0, skippedMeshCount, materialGroups: [] }

  root.add(batchRoot)
  root.userData[STATIC_BATCH_MARK] = true
  return { mergedMeshCount, consumedMeshCount, skippedMeshCount, materialGroups }
}
