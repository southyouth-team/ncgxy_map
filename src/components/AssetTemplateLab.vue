<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createCampusAssetTemplateRuntime } from '../three/world/campus/createCampusAssetTemplateRuntime.js'
import { createObjectSculptModel, applyObjectSculptParameter } from '../three/reconstruction/createObjectSculptModel.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'
const wizardStep = ref(1), templateName = ref(''), templateCategory = ref('building')
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'map-editor-local'
const viewport = ref(null), templates = ref([]), instances = ref([])
const selectedId = ref(''), selectedCategory = ref('all'), selectedInstanceId = ref('')
const scale = ref(1), status = ref('正在初始化'), error = ref('')
const prompt = ref('')
const objectType = ref('')
const imageFile = ref(null), imageDataUrl = ref(''), referencePreview = ref('')
const generating = ref(false), generationLog = ref('')
const modifying = ref(false), modifyInstruction = ref('')
const parameterizing = ref(false), parameterInstruction = ref('')
const savedAssetId = ref('')
watch(wizardStep, async step => { if (step >= 2) { await nextTick(); resize() } })
const categories = computed(() => [...new Set(templates.value.map(x => x.category))])
const visibleTemplates = computed(() => templates.value.filter(x => selectedCategory.value === 'all' || x.category === selectedCategory.value))
const selectedTemplate = computed(() => templates.value.find(x => x.id === selectedId.value))
const selectedInstance = computed(() => instances.value.find(x => x.id === selectedInstanceId.value))
const editorRevision = ref(0)
const selectedSpec = computed(() => { editorRevision.value; return objects.get(selectedInstanceId.value)?.userData?.objectSculptSpec || null })
const selectedComponent = computed(() => selectedSpec.value?.componentTree?.find(node => node.id === selectedComponentId.value) || null)
const selectedParameters = computed(() => selectedSpec.value?.parameterSchema || [])
const componentTree = computed(() => {
  const nodes = selectedSpec.value?.componentTree || []
  const byParent = new Map()
  nodes.forEach(node => { const key = node.parent || ''; if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(node) })
  const rows = []
  const visit = (parent, depth = 0) => (byParent.get(parent) || []).forEach(node => { rows.push({ ...node, depth }); visit(node.id, depth + 1) })
  visit('')
  return rows
})
const selectedComponentColor = computed(() => selectedComponent.value?.material && selectedSpec.value?.materials?.[selectedComponent.value.material]?.color || '#b8b8b8')
const selectedComponentVisible = computed(() => selectedComponent.value?.hidden !== true)
const selectedComponentTransform = computed(() => ({ position: selectedComponent.value?.transform?.position || [0,0,0], rotation: selectedComponent.value?.transform?.rotation || [0,0,0], scale: selectedComponent.value?.transform?.scale || [1,1,1] }))
const selectedComponentId = ref('')
const labels = {building:'建筑',vegetation:'植被',structure:'构筑物',facility:'设施',decoration:'装饰',sports:'运动设施',road:'道路',water:'水域',terrain:'地形'}
let renderer, scene, camera, controls, observer, frame, serial = 0
const objects = new Map()
const categoryLabel = value => labels[value] || value
const authHeaders = () => ({ 'Content-Type': 'application/json', 'X-Dev-User-Id': DEV_USER_ID })

function resize() {
  if (!renderer || !viewport.value || !camera) return
  const w = Math.max(1, viewport.value.clientWidth), h = Math.max(1, viewport.value.clientHeight)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

/**
 * 使用地面包围球和相机视场角计算取景距离，确保完整沙盒进入视口。
 * 透视相机仍保留真实 3D 观察角度，不通过 CSS 或平面背景伪造地面。
 */
function fitSandboxGround() {
  if (!camera || !controls) return

  const halfWidth = 90
  const halfDepth = 70
  const corners = [
    new THREE.Vector3(-halfWidth, -0.08, -halfDepth),
    new THREE.Vector3(halfWidth, -0.08, -halfDepth),
    new THREE.Vector3(-halfWidth, -0.08, halfDepth),
    new THREE.Vector3(halfWidth, -0.08, halfDepth),
  ]
  const direction = new THREE.Vector3(1, 1.15, 1).normalize()

  controls.target.set(0, 0, 0)
  camera.near = 0.1
  camera.far = 3000
  camera.updateProjectionMatrix()

  // 逐个检查地面四角的实际投影范围，避免包围球算法把镜头推得过远。
  let distance = 150
  let fits = false
  for (let i = 0; i < 40; i += 1) {
    camera.position.copy(controls.target).addScaledVector(direction, distance)
    camera.lookAt(controls.target)
    camera.updateMatrixWorld()
    const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    fits = corners.every(corner => {
      const projected = corner.clone().applyMatrix4(viewProjection)
      return Math.abs(projected.x) <= 0.84 && Math.abs(projected.y) <= 0.84 && projected.z >= -1 && projected.z <= 1
    })
    if (fits) break
    distance *= 1.06
  }

  // 额外留出约 16% 的视觉边距，地面仍占据主要视口。
  camera.position.copy(controls.target).addScaledVector(direction, distance * 1.16)
  camera.lookAt(controls.target)
  camera.updateMatrixWorld()
  controls.minDistance = 12
  controls.maxDistance = 1200
  controls.update()
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取参考图片失败'))
    reader.readAsDataURL(file)
  })
}
async function onImageChange(event) {
  const file = event.target.files?.[0]
  imageFile.value = file || null
  imageDataUrl.value = ''
  referencePreview.value = ''
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    error.value = '仅支持 PNG、JPG、WebP 图片'; imageFile.value = null; return
  }
  if (file.size > 10 * 1024 * 1024) {
    error.value = '参考图片不能超过 10 MB'; imageFile.value = null; return
  }
  try {
    imageDataUrl.value = await readFileAsDataUrl(file)
    referencePreview.value = imageDataUrl.value
    error.value = ''
  } catch (e) { error.value = e?.message || '读取图片失败' }
}
async function requestJson(path, body) {
  const response = await fetch(API_BASE + path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || '接口请求失败：HTTP ' + response.status)
  return payload
}
async function generateModel() {
  if (generating.value) return
  if (!prompt.value.trim() && !imageDataUrl.value) {
    error.value = '请填写生成提示词或上传参考图片'; return
  }
  generating.value = true; error.value = ''; generationLog.value = ''; status.value = '正在请求 AI 生成模型…'
  const startedAt = performance.now()
  try {
    let result
    let spec
    let model
    const isReferenceImage = Boolean(imageDataUrl.value)
    if (isReferenceImage) {
      status.value = '图片模式：正在确认参考图并调用视觉模型重建…'
      result = await requestJson('/assets/ai-image/reconstruct-object', {
        objectType: objectType.value.trim(), visualStyle: 'realistic',
        imageDataUrl: imageDataUrl.value, prompt: prompt.value.trim(),
      })
    } else {
      status.value = '提示词模式：正在生成结构描述…'
      result = await requestJson('/assets/ai-image/generate-object', {
        objectType: objectType.value.trim() || '独立 3D 物体', visualStyle: 'realistic', prompt: prompt.value.trim(),
      })
    }
    spec = result?.design?.objectSculptSpec || result?.objectSculptSpec
    if (!spec) throw new Error('AI 返回结果缺少 ObjectSculptSpec')
    try {
      model = createObjectSculptModel(THREE, spec, { source: 'ai-object-sculpt' })
    } catch (runtimeError) {
      status.value = 'Runtime 校验未通过，正在定向修复当前模型结构…'
      const repaired = await requestJson('/assets/ai-image/repair-object', {
        objectSculptSpec: spec, validationError: runtimeError?.message || String(runtimeError),
        objectType: spec.objectType || objectType.value.trim() || '独立 3D 物体',
        visualStyle: spec.visualStyle || 'anime-painted',
      })
      const repairedSpec = repaired?.objectSculptSpec
      if (!repairedSpec) throw new Error('AI 定向修复未返回 ObjectSculptSpec')
      model = createObjectSculptModel(THREE, repairedSpec, { source: 'ai-object-sculpt-repaired' })
      spec = repairedSpec
      result = repaired
    }
    result.__runtimeModel = model
    const id = 'ai-instance-' + (++serial)
    const index = instances.value.length
    model.position.set(((index % 4) - 1.5) * 12, 0, Math.floor(index / 4) * 12)
    model.scale.setScalar(scale.value)
    // 不在 Runtime 层强制整体接地：悬空、架空或飞行资产应保留生成结构中的真实高度。
    // 地面接触与内部支撑关系由视觉分析和 ObjectSculptSpec 决定，不能通过移动整个根节点掩盖结构偏差。
    model.userData.assetInstanceId = id
    model.userData.assetTemplate = { id: 'ai-generated:' + id, version: 1, category: spec.category || 'other', objectType: spec.objectType || objectType.value }
    scene.add(model)
    objects.set(id, model)
    instances.value.push({ id, name: spec.targetName || objectType.value || 'AI 生成模型', templateId: 'AI ObjectSculptSpec', category: spec.category || 'other', source: 'AI' })
    // 新增模型只更新选择状态，不自动平移相机目标；保持沙盒全局取景不变。
    selectedInstanceId.value = id
    selectedComponentId.value = spec.componentTree?.[0]?.id || ''
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1)
    generationLog.value += '视觉模型：' + (result.model || '未返回') + '\n参考图分析：' + (result.referenceAnalysis ? (result.referenceAnalysis.silhouette || '已完成') + '；识别组件：' + (result.referenceAnalysis.components?.length || 0) : '未执行') + '\n组件数量：' + spec.componentTree.length + '\n生成耗时：' + elapsed + ' 秒\n输入方式：' + (imageDataUrl.value ? '参考图片' : '纯提示词') + '\n模型来源：AI 视觉分析 → ObjectSculptSpec → Three.js Mesh'
    status.value = '模型已生成并加入沙盒：' + (spec.targetName || objectType.value)
    wizardStep.value = 2
  } catch (e) {
    error.value = e?.message || 'AI 模型生成失败'
    status.value = '生成失败'
  } finally { generating.value = false }
}
function getComponentGroup(instanceId, componentId) {
  return objects.get(instanceId)?.userData?.componentGroups?.get(componentId) || null
}
let highlightedComponentGroup = null
function clearComponentHighlight() {
  highlightedComponentGroup?.traverse(child => {
    if (child.isMesh && child.material?.emissive && child.userData.editorOriginalEmissive) {
      child.material.emissive.copy(child.userData.editorOriginalEmissive)
      child.material.emissiveIntensity = child.userData.editorOriginalEmissiveIntensity ?? 0
    }
  })
  highlightedComponentGroup = null
}
function clearComponentSelection() {
  clearComponentHighlight()
  selectedComponentId.value = ''
}
function toggleComponentSelection(componentId) {
  if (selectedComponentId.value === componentId) {
    clearComponentSelection()
    return
  }
  selectComponent(componentId)
}
function selectComponent(componentId) {
  if (!selectedSpec.value?.componentTree?.some(node => node.id === componentId)) return
  clearComponentHighlight()
  selectedComponentId.value = componentId
  const group = getComponentGroup(selectedInstanceId.value, componentId)
  if (group) {
    highlightedComponentGroup = group
    group.traverse(child => {
      if (child.isMesh && child.material?.emissive) {
        child.userData.editorOriginalEmissive = child.material.emissive.clone()
        child.userData.editorOriginalEmissiveIntensity = child.material.emissiveIntensity
        child.material.emissive.set('#d6a33b')
        child.material.emissiveIntensity = 0.28
      }
    })
  }
}
function updateSelectedComponentColor(color) {
  const node = selectedComponent.value
  if (!node || !/^#[0-9a-f]{6}$/i.test(color)) return
  const spec = objects.get(selectedInstanceId.value)?.userData?.objectSculptSpec
  if (!spec) return
  const previousKey = typeof node.material === 'string' ? node.material : 'default'
  if (!spec.materials) spec.materials = {}
  const previousMaterial = spec.materials[previousKey] || { color: '#b8b8b8', roughness: 0.82, metalness: 0 }
  const key = 'component-' + node.id
  if (node.material !== key) {
    spec.materials[key] = { ...previousMaterial }
    node.material = key
  }
  spec.materials[key].color = color
  editorRevision.value += 1
  const group = getComponentGroup(selectedInstanceId.value, node.id)
  group?.traverse(child => { if (child.isMesh) child.material.color.set(color) })
}
function updateAssetParameter(parameterId, value) {
  const root = objects.get(selectedInstanceId.value)
  if (!root) return
  try {
    applyObjectSculptParameter(THREE, root, parameterId, value)
    editorRevision.value += 1
    if (selectedComponentId.value) selectComponent(selectedComponentId.value)
    error.value = ''
  } catch (e) { error.value = e?.message || '参数更新失败' }
}
function toggleSelectedComponentVisibility() {
  const node = selectedComponent.value
  if (!node) return
  node.hidden = node.hidden !== true
  const group = getComponentGroup(selectedInstanceId.value, node.id)
  if (group) group.visible = node.hidden !== true
  editorRevision.value += 1
}
let pointerDownPosition = null
function onViewportPointerDown(event) { pointerDownPosition = { x: event.clientX, y: event.clientY } }
function onViewportPointerUp(event) {
  if (!pointerDownPosition || Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y) > 4 || !renderer || !camera) return
  const rect = renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects([...objects.values()], true)
  const hit = hits.find(item => item.object.userData?.componentId)
  if (!hit) {
    clearComponentSelection()
    return
  }
  const componentId = hit.object.userData.componentSourceId || hit.object.userData.componentId
  for (const [instanceId, root] of objects) {
    if (root.userData?.componentGroups?.has(componentId)) {
      if (selectedInstanceId.value !== instanceId) clearComponentHighlight()
      selectedInstanceId.value = instanceId
      selectComponent(componentId)
      nextTick(() => document.querySelector('.component-node.active')?.scrollIntoView({ block: 'nearest' }))
      break
    }
  }
}
function updateSelectedComponentTransform(axis, value) {
  const node = selectedComponent.value
  const group = getComponentGroup(selectedInstanceId.value, node?.id)
  if (!node || !group || !['x','y','z'].includes(axis)) return
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || Math.abs(numeric) > 100) return
  if (!node.transform) node.transform = { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  node.transform.position[index] = numeric
  group.position.set(...node.transform.position)
  editorRevision.value += 1
}
async function modifySelectedAsset() {
  const root = objects.get(selectedInstanceId.value)
  if (!root || !selectedComponentId.value || !modifyInstruction.value.trim() || modifying.value) return
  modifying.value = true; error.value = ''; status.value = 'AI 正在修改选中部件…'
  try {
    const result = await requestJson('/assets/ai-image/modify-object', {
      objectSculptSpec: selectedSpec.value,
      selectedNodeIds: [selectedComponentId.value],
      instruction: modifyInstruction.value.trim(),
    })
    const nextSpec = result.objectSculptSpec
    const position = root.position.clone(), rotation = root.rotation.clone(), objectScale = root.scale.clone()
    clearComponentHighlight()
    scene.remove(root)
    root.traverse(child => { child.geometry?.dispose?.(); if (child.material && !Array.isArray(child.material)) child.material.dispose?.() })
    const nextRoot = createObjectSculptModel(THREE, nextSpec, { source: 'ai-local-edit' })
    nextRoot.position.copy(position); nextRoot.rotation.copy(rotation); nextRoot.scale.copy(objectScale)
    scene.add(nextRoot); objects.set(selectedInstanceId.value, nextRoot)
    selectedComponentId.value = result.affectedNodeIds?.includes(selectedComponentId.value) ? selectedComponentId.value : nextSpec.componentTree[0]?.id || ''
    editorRevision.value += 1
    modifyInstruction.value = ''
    if (selectedComponentId.value) selectComponent(selectedComponentId.value)
    status.value = '局部修改完成；未选中组件保持原结构'
  } catch (e) {
    error.value = e?.message || 'AI 局部修改失败'
    status.value = '局部修改失败'
  } finally { modifying.value = false }
}
async function addParametersFromConversation() {
  const root = objects.get(selectedInstanceId.value)
  if (!root || !selectedSpec.value || !parameterInstruction.value.trim() || parameterizing.value) return
  parameterizing.value = true; error.value = ''; status.value = 'AI 正在分析模型结构并设计参数…'
  try {
    const result = await requestJson('/assets/ai-image/add-object-parameters', {
      objectSculptSpec: selectedSpec.value,
      instruction: parameterInstruction.value.trim(),
    })
    const position = root.position.clone(), rotation = root.rotation.clone(), objectScale = root.scale.clone()
    const assetInstanceId = root.userData.assetInstanceId
    const assetTemplate = root.userData.assetTemplate
    clearComponentHighlight()
    scene.remove(root)
    root.traverse(child => {
      child.geometry?.dispose?.()
      if (Array.isArray(child.material)) child.material.forEach(material => material.dispose?.())
      else child.material?.dispose?.()
    })
    const nextRoot = createObjectSculptModel(THREE, result.objectSculptSpec, { source: 'ai-parameterized-template' })
    nextRoot.position.copy(position); nextRoot.rotation.copy(rotation); nextRoot.scale.copy(objectScale)
    nextRoot.userData.assetInstanceId = assetInstanceId
    nextRoot.userData.assetTemplate = assetTemplate
    scene.add(nextRoot)
    objects.set(selectedInstanceId.value, nextRoot)
    editorRevision.value += 1
    parameterInstruction.value = ''
    const added = (result.addedParameters || []).map(item => item.label).join('、')
    const unsupported = (result.unsupported || []).join('；')
    const generators = (result.addedGenerators || []).map(item => item.id).join('、')
    status.value = added ? '已新增模板参数：' + added + (generators ? '；结构生成规则：' + generators : '') : '参数设计完成，未新增参数'
    if (selectedComponentId.value) selectComponent(selectedComponentId.value)
    if (unsupported) error.value = '当前结构暂不支持：' + unsupported
  } catch (e) {
    error.value = e?.message || 'AI 参数设计失败'
    status.value = '参数设计失败'
  } finally { parameterizing.value = false }
}
async function saveSelectedAsset() {
  if (!selectedSpec.value) return
  if (!templateName.value.trim()) { error.value = '请先填写模板名称'; return }
  try {
    selectedSpec.value.category = templateCategory.value.trim() || 'other'
    const result = await requestJson('/assets/visual-assets/objects', {
      name: templateName.value.trim(), category: templateCategory.value.trim() || 'other',
      objectSculptSpec: selectedSpec.value,
    })
    savedAssetId.value = result.assetId
    status.value = '结构化资产已保存：' + result.assetId
  } catch (e) { error.value = e?.message || '资产保存失败' }
}
async function loadSavedAsset() {
  if (!savedAssetId.value.trim()) return
  try {
    const response = await fetch(API_BASE + '/assets/visual-assets/objects/' + encodeURIComponent(savedAssetId.value.trim()), { headers: { 'X-Dev-User-Id': DEV_USER_ID } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.message || '资产读取失败：HTTP ' + response.status)
    const spec = payload.spec
    const id = 'saved-asset-' + (++serial)
    const object = createObjectSculptModel(THREE, spec, { source: 'saved-object-asset' })
    scene.add(object); objects.set(id, object)
    instances.value.push({ id, name: spec.targetName || '已保存资产', templateId: payload.assetId, category: spec.category || 'other', source: '已保存资产' })
    selectedInstanceId.value = id
    selectedComponentId.value = spec.componentTree?.[0]?.id || ''
    if (selectedComponentId.value) selectComponent(selectedComponentId.value)
    status.value = '已加载结构化资产：' + payload.assetId
  } catch (e) { error.value = e?.message || '资产读取失败' }
}
function addTemplate() {
  try {
    const item = selectedTemplate.value
    if (!item) return
    const id = 'lab-instance-' + (++serial), n = instances.value.length
    const object = runtime.templates.createInto(scene, item.id, {
      instanceId: id,
      parameters: { dimensions: { width: 5, height: item.category === 'building' ? 7 : 3.5, depth: 4 }, visualStyle: 'anime-painted', style: 'anime-painted', width: 5, height: 7, depth: 4, label: item.name },
      transform: { position: [((n % 4) - 1.5) * 10, 0, Math.floor(n / 4) * 9 - 5], scale: [scale.value, scale.value, scale.value] },
    })
    objects.set(id, object)
    instances.value.push({ id, name: item.name, templateId: item.id, category: item.category, source: '预置模板' })
    selectedInstanceId.value = id; scale.value = object.scale.x; status.value = '已添加预置模板 ' + item.name; error.value = ''
  } catch (e) { error.value = e?.message || '模板实例化失败' }
}
function removeInstance(id) {
  const object = objects.get(id)
  if (object) {
    scene.remove(object)
    object.traverse(child => { child.geometry?.dispose?.(); if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.()); else child.material?.dispose?.() })
  }
  objects.delete(id); instances.value = instances.value.filter(x => x.id !== id)
  if (selectedInstanceId.value === id) {
    clearComponentSelection()
    selectedInstanceId.value = instances.value.at(-1)?.id || ''
  }
}
function focusInstance(id) {
  clearComponentHighlight()
  selectedInstanceId.value = id
  const selectedObject = objects.get(id)
  if (selectedObject) scale.value = selectedObject.scale.x
  const spec = objects.get(id)?.userData?.objectSculptSpec
  selectedComponentId.value = spec?.componentTree?.[0]?.id || ''
  if (selectedComponentId.value) selectComponent(selectedComponentId.value)
  const object = objects.get(id)
  if (object) { controls.target.copy(object.position); controls.update() }
}
function clearScene() { [...objects.keys()].forEach(removeInstance); status.value = '场景已清空' }
function resetCamera() { fitSandboxGround() }

function setCameraView(view) {
  if (!camera || !controls) return
  const target = controls.target.clone()
  const distance = Math.max(camera.position.distanceTo(target), 24)
  const directions = {
    iso: new THREE.Vector3(1, 1.15, 1),
    top: new THREE.Vector3(0, 1, 0.001),
    front: new THREE.Vector3(0, 0.22, 1),
    side: new THREE.Vector3(1, 0.22, 0),
  }
  const direction = directions[view]
  if (!direction) return
  camera.position.copy(target).addScaledVector(direction.normalize(), distance)
  camera.up.set(0, 1, 0)
  camera.lookAt(target)
  controls.update()
}

function frameSelectedInstance() {
  const object = objects.get(selectedInstanceId.value)
  if (!object || !camera || !controls) return
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) return
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  const radius = Math.max(sphere.radius, 0.5)
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2)) * 1.18
  const direction = camera.position.clone().sub(controls.target).normalize()
  if (direction.lengthSq() < 0.001) direction.set(1, 1, 1).normalize()
  controls.target.copy(sphere.center)
  camera.position.copy(sphere.center).addScaledVector(direction, distance)
  camera.near = Math.max(0.05, distance / 1000)
  camera.far = Math.max(3000, distance * 20)
  camera.updateProjectionMatrix()
  controls.update()
}

let runtime
onMounted(() => {
  try {
    runtime = createCampusAssetTemplateRuntime(THREE)
    templates.value = runtime.templates.list()
    selectedId.value = templates.value.find(x => x.category === 'building')?.id || templates.value[0]?.id || ''
    scene = runtime.createSandboxScene()
    scene.background = new THREE.Color('#dfe8e0')
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 140), new THREE.MeshStandardMaterial({ color: '#83b86f', roughness: 1 }))
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08; ground.receiveShadow = true; ground.name = 'sandbox-ground'; scene.add(ground)
    const grid = new THREE.GridHelper(180, 36, '#557b4d', '#a9c99e'); grid.position.y = -0.06; grid.name = 'sandbox-grid'; scene.add(grid)
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500); camera.position.set(30, 28, 34)
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace; viewport.value.replaceChildren(renderer.domElement)
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, 0, 0); controls.update()
    renderer.domElement.addEventListener('pointerdown', onViewportPointerDown)
    renderer.domElement.addEventListener('pointerup', onViewportPointerUp)
    observer = new ResizeObserver(resize); observer.observe(viewport.value); resize(); fitSandboxGround()
    const render = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render) }; render()
    status.value = '沙盒已就绪；可输入提示词或上传图片生成独立模型'
  } catch (e) { error.value = e?.message || '初始化失败'; status.value = '初始化失败' }
})
watch(scale, value => { const object = objects.get(selectedInstanceId.value); if (object) object.scale.setScalar(value) })
onBeforeUnmount(() => {
  cancelAnimationFrame(frame); observer?.disconnect()
  renderer?.domElement?.removeEventListener('pointerdown', onViewportPointerDown)
  renderer?.domElement?.removeEventListener('pointerup', onViewportPointerUp)
  clearComponentHighlight()
  controls?.dispose()
  scene?.traverse(o => { o.geometry?.dispose?.(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.()); else o.material?.dispose?.() })
  renderer?.dispose()
})
</script>

<template>
  <main class="lab wizard-lab">
    <header class="wizard-header">
      <div><small>NCGXY / ASSET TEMPLATE WORKSHOP</small><h1>创建 3D 素材模板</h1><p>先定义模板并生成预览，确认整体结构后再进入微调。</p></div>
      <a href="/">返回校园</a>
    </header>
    <nav class="wizard-progress" aria-label="模板创建进度">
      <div v-for="(label,index) in ['创建模板','微调与预览','保存模板']" :key="label" :class="{active:wizardStep===index+1,done:wizardStep>index+1}">
        <span>{{ index+1 }}</span><b>{{ label }}</b>
      </div>
    </nav>

    <section v-if="wizardStep===1" class="wizard-card create-step">
      <div class="step-heading"><div><small>STEP 01</small><h2>定义模板内容</h2><p>模板基础信息与生成素材在同一步完成，图片和提示词可任选其一，也可以同时提供。</p></div></div>
      <div class="create-grid">
        <div class="form-column">
          <label>模板名称 <em>*</em></label><input v-model="templateName" placeholder="例如：奇幻学院主城堡">
          <label>模板分类 <em>*</em></label><input v-model="templateCategory" list="asset-category-options" placeholder="输入新分类，或从已有分类中选择">
          <datalist id="asset-category-options"><option value="building">建筑</option><option value="vegetation">植被</option><option value="structure">构筑物</option><option value="facility">设施</option><option value="decoration">装饰</option><option value="sports">运动设施</option><option value="road">道路</option><option value="water">水域</option><option value="terrain">地形</option></datalist>
          <label>物体名称 / 类型</label><input v-model="objectType" placeholder="例如：城堡、香樟树、拱桥、长椅">
          <label>生成提示词</label><textarea v-model="prompt" rows="6" placeholder="描述外形轮廓、组成部件、比例、颜色、材质和视觉风格"></textarea>
        </div>
        <div class="reference-column">
          <label>参考素材（可选）</label><div class="upload-drop"><input type="file" accept="image/png,image/jpeg,image/webp" @change="onImageChange"><p>支持 PNG / JPG / WebP，最大 10 MB</p><img v-if="referencePreview" class="reference" :src="referencePreview" alt="模板参考图"><p v-else class="upload-empty">上传图片作为结构与外观参考</p></div>
          <p class="input-rule">支持三种输入方式：仅提示词、仅图片、图片 + 提示词。至少提供一种。</p>
        </div>
      </div>
      <div v-if="error" class="error">{{ error }}</div>
      <div class="step-actions"><span class="hint">模板名称和分类用于后续资产检索与复用。</span><button class="generate" :disabled="generating || !templateName.trim() || (!prompt.trim() && !imageDataUrl)" @click="generateModel">{{ generating ? 'AI 正在生成结构…' : '生成 3D 素材' }}</button></div>
    </section>

    <section v-show="wizardStep===2" class="wizard-preview editor-step">
      <div class="preview-heading"><div><small>STEP 02</small><h2>微调结构与预览</h2><p>左侧负责高频调整，右侧实时预览；点击模型部件可同步定位到对应结构。</p></div><div class="preview-meta"><b>{{ templateName }}</b><span>{{ templateCategory }}</span></div></div>
      <div class="editor-workspace">
        <aside class="panel inspector">
          <section v-if="selectedSpec" class="ai-local-editor primary-editor">
            <label>AI 参数与结构对话</label>
            <textarea v-model="parameterInstruction" rows="3" placeholder="例如：增加楼层数参数，默认 3 层、最高 8 层；或让树冠增加一层"></textarea>
            <button class="generate" :disabled="parameterizing||!parameterInstruction.trim()" @click="addParametersFromConversation">{{ parameterizing?'AI 正在设计参数…':'根据描述新增 / 调整参数' }}</button>
          </section>
          <section v-if="selectedComponent" class="ai-local-editor">
            <label>AI 修改当前部件：{{ selectedComponent.name||selectedComponent.id }}</label>
            <textarea v-model="modifyInstruction" rows="3" placeholder="例如：把窗户改成拱形，保留原位置和周围墙体"></textarea>
            <button class="generate" :disabled="modifying||!modifyInstruction.trim()" @click="modifySelectedAsset">{{ modifying?'AI 修改中…':'修改选中部件' }}</button>
          </section>
          <section v-if="selectedSpec" class="component-editor">
            <h3>可调参数 <span>{{ selectedParameters.length }} 项</span></h3>
            <div class="asset-parameters">
              <div v-for="parameter in selectedParameters" :key="parameter.id" class="parameter-row"><label>{{ parameter.label }}</label><input v-if="parameter.type==='number'" type="range" :min="parameter.min" :max="parameter.max" :step="parameter.step||0.1" :value="parameter.value" @input="updateAssetParameter(parameter.id,Number($event.target.value))"><div v-if="parameter.type==='number'" class="parameter-value">{{ parameter.value }} {{ parameter.unit||'' }}</div><input v-else-if="parameter.type==='color'" type="color" :value="parameter.value" @input="updateAssetParameter(parameter.id,$event.target.value)"><input v-else-if="parameter.type==='boolean'" type="checkbox" :checked="parameter.value" @change="updateAssetParameter(parameter.id,$event.target.checked)"><select v-else-if="parameter.type==='select'" :value="parameter.value" @change="updateAssetParameter(parameter.id,$event.target.value)"><option v-for="option in parameter.options" :key="option.value" :value="option.value">{{ option.label }}</option></select></div>
              <p v-if="!selectedParameters.length" class="empty-hint">当前模型还没有可调参数，可先通过上方 AI 对话生成。</p>
            </div>
            <div v-if="selectedComponent" class="component-properties"><b>{{ selectedComponent.name||selectedComponent.id }}</b><template v-if="(selectedComponent.kind||'mesh')==='mesh'"><label>部件颜色</label><input type="color" :value="selectedComponentColor" @input="updateSelectedComponentColor($event.target.value)"></template><small v-else>逻辑分组节点：变换和显隐作用于整个子树。</small><label>局部位置 X / Y / Z</label><div class="axis-inputs"><input v-for="(value,index) in selectedComponentTransform.position" :key="index" type="number" step="0.1" :value="value" @change="updateSelectedComponentTransform(['x','y','z'][index],$event.target.value)"></div><button class="secondary" @click="toggleSelectedComponentVisibility">{{ selectedComponentVisible?'隐藏此部件':'显示此部件' }}</button>
            </div>
          </section>
          <section v-if="selectedSpec" class="component-editor">
            <h3>模型结构 <span>{{ selectedSpec.componentTree.length }} 个部件</span></h3>
            <div class="component-tree"><button v-for="node in componentTree" :key="node.id" class="component-node" :class="{active:selectedComponentId===node.id}" :style="{paddingLeft:(8+node.depth*15)+'px'}" @click="toggleComponentSelection(node.id)"><span>{{ node.name || node.id }}</span><small>{{ node.kind==='group'?'结构分组':(node.role||node.primitive||'Mesh') }}</small></button></div>
          </section>
        </aside>
        <div class="editor-viewport-column">
          <section class="viewport-panel">
            <div ref="viewport" class="viewport"></div>
            <div class="toolbar"><button @click="resetCamera">全局视角</button><button :disabled="!selectedInstanceId" @click="frameSelectedInstance">聚焦选中</button><button @click="setCameraView('iso')">等轴测</button><button @click="setCameraView('top')">俯视</button><button @click="setCameraView('front')">正视</button><button @click="setCameraView('side')">侧视</button></div>
            <div class="hint status">{{ status }}</div>
          </section>
          <div v-if="generationLog" class="log">{{ generationLog }}</div>
        </div>
      </div>
      <div v-if="error" class="error">{{ error }}</div>
      <div class="step-actions"><button class="secondary" @click="wizardStep=1">返回修改输入</button><button class="secondary" :disabled="generating" @click="generateModel">重新生成</button><button class="generate" :disabled="!selectedSpec" @click="wizardStep=3">下一步：保存模板</button></div>
    </section>

    <section v-if="wizardStep===3" class="wizard-editor save-step">
      <div class="preview-heading"><div><small>STEP 03</small><h2>保存模板</h2><p>确认微调结果，将当前结构、材质和参数定义保存到素材库。</p></div><div class="preview-meta"><b>{{ templateName }}</b><span>{{ templateCategory }}</span></div></div>
      <div class="save-panel"><div><b>模板保存</b><p>保存后可在后续场景中复用该结构化资产。</p><small v-if="savedAssetId">已保存 ID：{{ savedAssetId }}</small></div><button class="generate" :disabled="!selectedSpec" @click="saveSelectedAsset">保存模板</button></div>
      <div v-if="error" class="error">{{ error }}</div>
      <div class="step-actions"><button class="secondary" @click="wizardStep=2">返回继续微调</button><button class="secondary" @click="wizardStep=1">返回模板信息</button></div>
    </section>
    <footer>独立素材模板实验环境 · AI 输出 ObjectSculptSpec，由 Three.js Runtime 转换为真实 Mesh。</footer>
  </main>
</template>

<style scoped>
/* Wizard pages are document-flow layouts; do not inherit the legacy fixed-height editor shell. */
.wizard-lab{display:block!important;height:auto!important;min-height:100dvh!important;overflow:visible!important;padding:20px 24px!important}
.wizard-lab>.wizard-header,.wizard-lab>.wizard-progress,.wizard-lab>.wizard-card,.wizard-lab>.wizard-preview,.wizard-lab>.wizard-editor,.wizard-lab>.shared-viewport,.wizard-lab>footer{width:100%;max-width:1500px;margin-left:auto;margin-right:auto}
.wizard-lab>.wizard-header{margin-bottom:14px}
.wizard-lab>.wizard-progress{margin-bottom:16px}
.wizard-lab>.wizard-card,.wizard-lab>.wizard-preview,.wizard-lab>.wizard-editor{margin-bottom:16px}
.wizard-lab>.shared-viewport{display:block}
.wizard-lab .viewport-panel{position:relative}
.wizard-lab .viewport{position:absolute;inset:0;min-height:100%}
.wizard-lab footer{padding-bottom:max(16px,env(safe-area-inset-bottom))}
@media(max-width:700px){.wizard-lab{padding:12px!important}.wizard-lab>.wizard-header{align-items:flex-start}.wizard-lab>.shared-viewport .viewport-panel{height:55vh;min-height:360px}.wizard-lab>.wizard-card,.wizard-lab>.wizard-preview,.wizard-lab>.wizard-editor{margin-bottom:12px}}

.lab{height:100vh;height:100dvh;min-height:0;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;padding:20px 24px;background:#edf1ed;color:#243329;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}
header{flex:0 0 auto;width:100%;max-width:1600px;margin:0 auto 14px;display:flex;justify-content:space-between;align-items:center;gap:20px}
header small{font-size:10px;letter-spacing:.15em;color:#66816b;font-weight:800}
h1{font-size:25px;margin:7px 0}
header p{font-size:13px;color:#718075;margin:0}
header a{color:#386b4b;text-decoration:none;font-weight:700;font-size:13px}
.layout{width:100%;max-width:1600px;flex:1 1 0;min-height:0;min-width:0;margin:0 auto;display:grid;grid-template-columns:minmax(300px,330px) minmax(420px,1fr) minmax(300px,320px);grid-template-rows:minmax(0,1fr);gap:13px;overflow:hidden}
.panel,.viewport-panel{min-width:0;min-height:0;background:#fff;border:1px solid #dce4dc;border-radius:11px}
.panel{display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:15px}
.panel>*{flex:0 0 auto;min-width:0}
.panel h3{font-size:13px;margin:0 0 14px;display:flex;justify-content:space-between;align-items:center}
.panel h3 span{font-size:11px;color:#87948a;font-weight:400}
.panel label{display:block;flex:0 0 auto;font-size:11px;color:#768378;margin:12px 0 7px}
.panel input:not([type=file]),.panel textarea,.panel select{display:block;width:100%;min-width:0;min-height:36px;flex:0 0 auto;box-sizing:border-box;padding:9px;border:1px solid #dce4dc;border-radius:7px;font:inherit;font-size:12px;background:#fff}
.panel textarea{min-height:88px;line-height:1.5;resize:vertical}
.panel input[type=range]{min-height:24px;padding:0 2px}
.panel input[type=checkbox]{width:18px;min-height:18px;padding:0}
.panel input[type=color]{height:34px;padding:3px}
.panel input[type=file]{display:block;flex:0 0 auto;max-width:100%;font-size:11px}
.reference{display:block;flex:0 0 auto;max-width:100%;max-height:170px;object-fit:contain;margin-top:10px;border-radius:7px;background:#f3f5f2}
.generate,.secondary{display:block;flex:0 0 auto;width:100%;min-height:38px;margin-top:12px;border:0;border-radius:8px;background:#3d7950;color:white;padding:10px 11px;font-weight:700;cursor:pointer;white-space:normal;line-height:1.4}
.generate:disabled{opacity:.55;cursor:wait}
.secondary{background:#fff;color:#3d7950;border:1px solid #b9cdbb}
.hint{flex:0 0 auto;font-size:10px;color:#7d8b80;line-height:1.65}
.log{flex:0 0 auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f7f2;border-radius:7px;padding:10px;margin-top:10px;font-size:10px;color:#53675a;line-height:1.6}
.error{flex:0 0 auto;margin-top:10px;background:#fff0ee;color:#a4493f;padding:9px;border-radius:7px;font-size:11px;overflow-wrap:anywhere}
.subheading{margin-top:22px!important;padding-top:14px;border-top:1px solid #e8ede8}
.templates,.instances{flex:0 0 auto;min-height:0;max-height:220px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:5px;margin-top:9px}
.templates button{flex:0 0 auto;display:flex;flex-direction:column;gap:4px;text-align:left;border:1px solid transparent;background:transparent;border-radius:7px;padding:9px;cursor:pointer;color:#34453a}
.templates button.active,.instances>div.active{background:#eef6ef;border-color:#bcd2bf}
.templates b,.instance b{font-size:12px}
.templates small,.instance small{font-size:10px;color:#89968b}
.viewport-panel{position:relative;overflow:hidden;background:#dfe8e0}
.viewport{position:absolute;inset:0;background:#b9c8bb}
.viewport :deep(canvas){display:block;width:100%;height:100%;touch-action:none}
.toolbar{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;pointer-events:none}
.toolbar button{flex:0 0 auto;pointer-events:auto;border:1px solid #d6e0d6;background:#ffffffed;border-radius:7px;padding:7px 9px;font-size:11px;cursor:pointer}
.toolbar button:disabled{opacity:.45;cursor:not-allowed}
.toolbar span{margin-left:auto;background:#ffffffc9;padding:7px;border-radius:6px;font-size:10px;color:#718075}
.status{position:absolute;bottom:12px;left:12px;max-width:calc(100% - 24px);background:#ffffffd9;border-radius:6px;padding:7px 10px}
.inspector input{accent-color:#4f855e}
.instances>div{flex:0 0 auto;display:flex;align-items:center;min-width:0;border:1px solid #e5ebe5;border-radius:7px}
.instance{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px;text-align:left;background:transparent;border:0;padding:9px;cursor:pointer;color:#34453a;overflow:hidden}
.instance small{overflow-wrap:anywhere}
.remove{flex:0 0 auto;border:0;background:transparent;color:#9a665d;font-size:19px;padding:5px 10px;cursor:pointer}
.instances p{flex:0 0 auto;font-size:11px;color:#9aa49b;text-align:center;padding:15px}
.asset-parameters{flex:0 0 auto;min-width:0;margin-top:12px;padding-top:10px;border-top:1px solid #edf0ed}
.asset-parameters h4{font-size:11px;margin:0 0 8px}
.asset-parameters h4 small{color:#89968b;font-weight:400}
.parameter-row{display:flex;flex:0 0 auto;flex-direction:column;gap:5px;margin:8px 0}
.parameter-row label{margin:0}
.parameter-row input[type=range]{width:100%;accent-color:#4f855e}
.parameter-row input[type=color]{width:100%;height:30px}
.parameter-row input[type=checkbox]{width:auto;align-self:flex-start}
.parameter-row select{width:100%}
.parameter-value{font-size:10px;color:#78867b;text-align:right}
.asset-actions,.ai-local-editor{flex:0 0 auto;min-width:0;margin-top:14px;padding-top:12px;border-top:1px solid #edf0ed}
.ai-local-editor textarea{width:100%;box-sizing:border-box;resize:vertical}
.asset-actions label,.ai-local-editor label{display:block;font-size:10px;color:#78867b;margin:8px 0}
.asset-actions input{width:100%;box-sizing:border-box;padding:8px;border:1px solid #dce4dc;border-radius:6px;font-size:11px}
.component-editor{flex:0 0 auto;min-width:0;margin-top:18px;padding-top:14px;border-top:1px solid #e8ede8}
.component-editor h3{margin-bottom:8px}
.component-tree{max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:3px}
.component-node{flex:0 0 auto;display:flex;justify-content:space-between;gap:6px;align-items:center;text-align:left;border:1px solid transparent;border-radius:5px;background:#f7f9f7;padding:7px 8px;color:#34453a;cursor:pointer;min-width:0}
.component-node.active{background:#eaf4eb;border-color:#a9c8ae}
.component-node span{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.component-node small{font-size:9px;color:#8a978c;white-space:nowrap}
.component-properties{display:flex;flex:0 0 auto;flex-direction:column;gap:6px;min-width:0;margin-top:10px;padding-top:10px;border-top:1px solid #edf0ed}
.component-properties>b{font-size:12px}
.component-properties label{margin:4px 0 0}
.component-properties input[type=color]{width:100%;height:32px;border:1px solid #dce4dc;border-radius:6px;padding:2px}
.axis-inputs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.axis-inputs input{min-width:0}
.wizard-lab{height:auto;min-height:100dvh;overflow:visible;max-width:100%;align-items:center}.wizard-header,.wizard-progress,.wizard-card,.wizard-preview,.wizard-editor,footer{width:100%;max-width:1500px}.wizard-progress{display:flex;gap:12px;margin:0 auto 16px}.wizard-progress>div{flex:1;display:flex;align-items:center;gap:10px;padding:12px 16px;background:#fff;border:1px solid #dce4dc;border-radius:10px;color:#829086}.wizard-progress span{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#edf1ed;font-weight:700}.wizard-progress .active{border-color:#4f855e;color:#315f3e;background:#f5faf5}.wizard-progress .done span,.wizard-progress .active span{background:#3d7950;color:white}.wizard-card,.wizard-preview,.wizard-editor{background:#fff;border:1px solid #dce4dc;border-radius:12px;padding:24px;margin:0 auto 16px;box-sizing:border-box}.step-heading,.preview-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:22px}.step-heading small,.preview-heading small{font-size:10px;letter-spacing:.12em;color:#66816b;font-weight:800}.step-heading h2,.preview-heading h2{margin:6px 0;font-size:21px}.step-heading p,.preview-heading p{margin:0;color:#7a887d;font-size:12px}.create-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(280px,.9fr);gap:28px}.form-column,.reference-column{min-width:0}.create-step label{display:block;margin:14px 0 7px;font-size:12px;color:#59695d}.create-step label em{color:#b45a4e;font-style:normal}.create-step input:not([type=file]),.create-step textarea{width:100%;box-sizing:border-box;padding:11px;border:1px solid #dce4dc;border-radius:8px;font:inherit;font-size:13px}.create-step textarea{resize:vertical;line-height:1.6}.upload-drop{min-height:220px;border:1px dashed #b9cbbb;border-radius:10px;padding:18px;background:#f8faf8}.upload-drop p{font-size:11px;color:#87948a}.upload-empty{display:grid;min-height:110px;place-items:center}.input-rule{margin-top:14px;padding:12px;background:#f2f7f2;border-radius:8px;font-size:11px;color:#66776a;line-height:1.6}.create-step .reference{max-width:100%;max-height:260px;object-fit:contain}.step-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:20px;padding-top:18px;border-top:1px solid #edf0ed}.step-actions .generate,.step-actions .secondary{width:auto;min-width:150px;margin:0}.preview-meta{display:flex;flex-direction:column;align-items:flex-end;gap:6px;color:#34453a}.preview-meta span{font-size:11px;color:#829086}.shared-viewport{width:100%;max-width:1500px;margin:0 auto 16px}.shared-viewport .viewport-panel{height:min(68vh,720px);min-height:440px}.editor-step .editor-workspace{display:grid;grid-template-columns:minmax(320px,420px) minmax(0,1fr);gap:14px;align-items:stretch;min-height:680px}.editor-step .inspector{max-height:720px;gap:0}.editor-viewport-column{display:flex;min-width:0;min-height:0;flex-direction:column;gap:10px}.editor-step .viewport-panel{position:relative;flex:1 1 auto;min-height:620px}.editor-step .log{margin:0}.save-step{min-height:260px}.empty-hint{margin:8px 0;color:#87948a;font-size:11px;line-height:1.5}.save-panel{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:18px;margin-top:16px;background:#f5f8f5;border:1px solid #dce8dc;border-radius:10px}.save-panel p{margin:6px 0;color:#78867b;font-size:12px}.save-panel small{font-size:10px;color:#4f855e}.save-panel .generate{width:auto;min-width:150px;margin:0}.wizard-lab footer{margin:12px auto 0;text-align:left}.wizard-lab .toolbar{z-index:2}.wizard-lab .status{z-index:2}.wizard-lab .panel{overflow:auto}.wizard-lab .component-tree{max-height:250px}.editor-step .component-tree{max-height:200px}.editor-step .primary-editor{margin-top:0;padding-top:0;border-top:0}.editor-step .inspector .component-editor{margin-top:14px}
footer{flex:0 0 auto;width:100%;max-width:1600px;margin:10px auto 0;text-align:right;color:#87948a;font-size:10px}
@media(max-width:1180px) and (min-width:701px){.lab{padding:16px}.layout{grid-template-columns:minmax(270px,300px) minmax(320px,1fr);grid-template-rows:minmax(360px,1fr) minmax(260px,.75fr);overflow-y:auto}.viewport-panel{grid-column:2;grid-row:1}.generator{grid-column:1;grid-row:1}.inspector{grid-column:1/-1;grid-row:2}.panel{overflow:visible}.inspector{overflow-y:visible}.instances{max-height:180px}.component-tree{max-height:180px}}
@media(max-width:1100px){.editor-step .editor-workspace{grid-template-columns:minmax(280px,360px) minmax(0,1fr)}.editor-step .viewport-panel{min-height:560px}}@media(max-width:900px){.create-grid{grid-template-columns:1fr}.editor-step .editor-workspace{display:flex;flex-direction:column-reverse;min-height:0}.editor-step .inspector{max-height:none;overflow:visible}.editor-step .viewport-panel{min-height:480px;flex:0 0 60vh}}
@media(max-width:700px){.wizard-progress{gap:5px}.wizard-progress>div{padding:8px 5px;gap:5px;font-size:10px}.wizard-card,.wizard-preview,.wizard-editor{padding:14px}.step-heading,.preview-heading{flex-direction:column}.step-actions{align-items:stretch;flex-wrap:wrap}.step-actions .generate,.step-actions .secondary{flex:1;min-width:120px}.save-panel{align-items:stretch;flex-direction:column}.save-panel .generate{width:100%}.shared-viewport .viewport-panel{min-height:380px;height:55vh}.wizard-editor .viewport-panel{min-height:380px}.lab{height:auto;min-height:100dvh;overflow:visible;padding:12px}header{align-items:flex-start;flex-direction:column;gap:8px}.layout{display:flex;flex:initial;min-height:0;overflow:visible;flex-direction:column}.panel{max-height:none;overflow:visible}.templates,.instances{max-height:180px}.viewport-panel{height:min(65vh,560px);min-height:420px;flex:0 0 auto}.toolbar{right:8px;left:8px;gap:4px}.toolbar button{font-size:10px;padding:6px 7px}.toolbar span{display:none}footer{text-align:left}}
</style>