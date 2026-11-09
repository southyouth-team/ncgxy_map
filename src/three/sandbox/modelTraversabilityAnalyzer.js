/**
 * Bind AI-declared traversal features to real Three.js geometry and collect
 * conservative geometric evidence. This is a diagnostic stage only: it does
 * not create colliders or certify a route as walkable.
 */

function collectComponentParts(root) {
  const parts = new Map()
  const duplicates = new Set()
  root.traverse(object => {
    const id = object.userData?.componentId
    if (typeof id !== 'string' || !id.trim()) return
    if (parts.has(id)) duplicates.add(id)
    else parts.set(id, object)
  })
  return { parts, duplicates }
}

function collectMeshes(target) {
  const meshes = []
  target.traverse(object => {
    const position = object.geometry?.getAttribute?.('position')
    if (object.isMesh && position && position.count >= 3) meshes.push(object)
  })
  return meshes
}

function measureUpwardTriangles(THREE, meshes) {
  let upwardTriangleCount = 0
  const slopes = []
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.index
    const count = index ? index.count : position.count
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const readIndex = i => index ? index.getX(i) : i
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, readIndex(i)).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(position, readIndex(i + 1)).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(position, readIndex(i + 2)).applyMatrix4(mesh.matrixWorld)
      ab.subVectors(b, a)
      ac.subVectors(c, a)
      normal.crossVectors(ab, ac)
      if (normal.lengthSq() < 1e-12) continue
      normal.normalize()
      if (normal.y <= 0.05) continue
      upwardTriangleCount += 1
      slopes.push(Math.atan2(Math.hypot(normal.x, normal.z), normal.y) * 180 / Math.PI)
    }
  }
  slopes.sort((a, b) => a - b)
  const medianSlopeDegrees = slopes.length
    ? slopes[Math.floor((slopes.length - 1) / 2)]
    : null
  return { upwardTriangleCount, medianSlopeDegrees }
}

function measureStairProfile(THREE, meshes, levelTolerance = 0.035) {
  const triangles = []
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.index
    const count = index ? index.count : position.count
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const ab = new THREE.Vector3()
    const ac = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const readIndex = i => index ? index.getX(i) : i
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, readIndex(i)).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(position, readIndex(i + 1)).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(position, readIndex(i + 2)).applyMatrix4(mesh.matrixWorld)
      ab.subVectors(b, a)
      ac.subVectors(c, a)
      normal.crossVectors(ab, ac)
      const areaTwice = normal.length()
      if (areaTwice < 1e-8) continue
      normal.multiplyScalar(1 / areaTwice)
      if (normal.y < Math.cos(12 * Math.PI / 180)) continue
      triangles.push({
        y: (a.y + b.y + c.y) / 3,
        x: (a.x + b.x + c.x) / 3,
        z: (a.z + b.z + c.z) / 3,
        area: areaTwice / 2,
        vertices: [a.clone(), b.clone(), c.clone()],
      })
    }
  }

  triangles.sort((a, b) => a.y - b.y)
  const levels = []
  for (const triangle of triangles) {
    let level = levels[levels.length - 1]
    if (!level || Math.abs(triangle.y - level.meanY) > levelTolerance) {
      level = { triangles: [], area: 0, weightedY: 0, weightedX: 0, weightedZ: 0 }
      levels.push(level)
    }
    level.triangles.push(triangle)
    level.area += triangle.area
    level.weightedY += triangle.y * triangle.area
    level.weightedX += triangle.x * triangle.area
    level.weightedZ += triangle.z * triangle.area
    level.meanY = level.weightedY / level.area
  }
  for (const level of levels) {
    level.center = {
      x: level.weightedX / level.area,
      y: level.weightedY / level.area,
      z: level.weightedZ / level.area,
    }
  }

  if (levels.length < 2) {
    return { detectedLevelCount: levels.length, averageRiserHeight: null, averageTreadDepth: null, levels: [] }
  }
  const first = levels[0].center
  const last = levels[levels.length - 1].center
  const runX = last.x - first.x
  const runZ = last.z - first.z
  const runLength = Math.hypot(runX, runZ)
  const axis = runLength > 1e-5 ? { x: runX / runLength, z: runZ / runLength } : null
  const risers = []
  const treads = []
  const compactLevels = levels.map(level => {
    if (axis) {
      const projections = level.triangles.flatMap(triangle => triangle.vertices.map(vertex =>
        vertex.x * axis.x + vertex.z * axis.z))
      treads.push(Math.max(...projections) - Math.min(...projections))
    }
    return { center: level.center, area: level.area }
  })
  for (let i = 1; i < levels.length; i += 1) {
    const delta = levels[i].center.y - levels[i - 1].center.y
    if (delta > 0.025 && delta < 0.6) risers.push(delta)
  }
  return {
    detectedLevelCount: levels.length,
    averageRiserHeight: risers.length ? risers.reduce((sum, value) => sum + value, 0) / risers.length : null,
    averageTreadDepth: treads.length ? treads.reduce((sum, value) => sum + value, 0) / treads.length : null,
    levels: compactLevels,
  }
}

function getWorldBounds(THREE, meshes) {
  const bounds = new THREE.Box3()
  let hasBounds = false
  for (const mesh of meshes) {
    const box = new THREE.Box3().setFromObject(mesh)
    if (box.isEmpty()) continue
    if (!hasBounds) {
      bounds.copy(box)
      hasBounds = true
    } else bounds.union(box)
  }
  if (!hasBounds) return null
  return {
    min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    size: {
      x: bounds.max.x - bounds.min.x,
      y: bounds.max.y - bounds.min.y,
      z: bounds.max.z - bounds.min.z,
    },
  }
}

export function analyzeModelTraversability(THREE, root) {
  const manifest = root?.userData?.proceduralModelCapabilityManifest
  const declarations = manifest?.capabilities?.spatial?.traversability || {}
  const collections = ['stairs', 'ramps', 'passages', 'connections']
  const { parts, duplicates } = root?.traverse
    ? collectComponentParts(root)
    : { parts: new Map(), duplicates: new Set() }
  root?.updateWorldMatrix?.(true, true)

  const issues = []
  const records = []
  const addIssue = (code, severity, path, detail) => issues.push({ code, severity, path, detail })

  for (const collection of collections) {
    const entries = Array.isArray(declarations[collection]) ? declarations[collection] : []
    for (let index = 0; index < entries.length; index += 1) {
      const declaration = entries[index]
      const path = `capabilities.spatial.traversability.${collection}[${index}]`
      if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
        addIssue('traversability.record.invalid', 'error', path, '声明必须是对象')
        continue
      }
      if (typeof declaration.id !== 'string' || !declaration.id.trim()) {
        addIssue('traversability.id.required', 'error', path + '.id', '声明缺少稳定 ID')
      }

      if (collection === 'connections') {
        const fromExists = typeof declaration.from === 'string' && declaration.from.trim()
        const toExists = typeof declaration.to === 'string' && declaration.to.trim()
        if (!fromExists || !toExists) {
          addIssue('traversability.connection.endpoints.required', 'error', path, '连接必须声明 from 和 to')
        }
        records.push({
          id: declaration.id || null, type: collection,
          bound: false, status: 'deferred',
          detail: '空间端点尚未绑定到室内/楼层节点图',
        })
        continue
      }

      const targetPartId = declaration.targetPartId
      if (typeof targetPartId !== 'string' || !targetPartId.trim()) {
        addIssue('traversability.targetPartId.required', 'error', path + '.targetPartId', '声明缺少目标部件 ID')
        records.push({ id: declaration.id || null, type: collection, bound: false, status: 'invalid' })
        continue
      }
      if (duplicates.has(targetPartId)) {
        addIssue('traversability.target-part.duplicate', 'error', path + '.targetPartId', '模型中存在重复 componentId，无法唯一绑定')
        records.push({ id: declaration.id || null, type: collection, targetPartId, bound: false, status: 'invalid' })
        continue
      }
      const target = parts.get(targetPartId)
      if (!target) {
        addIssue('traversability.target-part.missing', 'error', path + '.targetPartId', '目标部件未在 Three.js 模型中找到')
        records.push({ id: declaration.id || null, type: collection, targetPartId, bound: false, status: 'invalid' })
        continue
      }

      const meshes = collectMeshes(target)
      if (!meshes.length) {
        addIssue('traversability.geometry.missing', 'error', path + '.targetPartId', '目标部件没有可用 Mesh 几何')
        records.push({ id: declaration.id || null, type: collection, targetPartId, bound: true, status: 'invalid' })
        continue
      }
      const bounds = getWorldBounds(THREE, meshes)
      const surface = measureUpwardTriangles(THREE, meshes)
      const stairProfile = collection === 'stairs' ? measureStairProfile(THREE, meshes) : null
      if (collection === 'stairs' || collection === 'ramps') {
        if (surface.upwardTriangleCount === 0) {
          addIssue('traversability.walking-surface.missing', 'error', path, '几何中未检测到朝上的三角面，无法证明存在承托面')
        }
        if (collection === 'ramps' && surface.medianSlopeDegrees == null) {
          addIssue('traversability.ramp.slope-unmeasurable', 'warning', path, '无法从当前几何测量坡面角度')
        }
        if (collection === 'ramps' && Number.isFinite(Number(declaration.slopeDegrees))
          && surface.medianSlopeDegrees != null
          && Math.abs(Number(declaration.slopeDegrees) - surface.medianSlopeDegrees) > 12) {
          addIssue('traversability.ramp.slope-mismatch', 'warning', path + '.slopeDegrees', '声明坡度与朝上三角面中位坡度差异超过 12°')
        }
        if (collection === 'stairs') {
          if (stairProfile.detectedLevelCount < 2) {
            addIssue('traversability.stairs.levels-insufficient', 'warning', path, '只检测到一个或没有明显水平踏步高度层，无法提取连续楼梯级')
          }
          if (Number.isFinite(Number(declaration.riserHeight)) && stairProfile.averageRiserHeight != null
            && Math.abs(Number(declaration.riserHeight) - stairProfile.averageRiserHeight) > 0.06) {
            addIssue('traversability.stairs.riser-mismatch', 'warning', path + '.riserHeight', '声明级高与几何提取的平均级高差异超过 0.06 个世界单位')
          }
          if (Number.isFinite(Number(declaration.treadDepth)) && stairProfile.averageTreadDepth != null
            && Math.abs(Number(declaration.treadDepth) - stairProfile.averageTreadDepth) > 0.12) {
            addIssue('traversability.stairs.tread-mismatch', 'warning', path + '.treadDepth', '声明踏深与几何提取的平均水平踏步深度差异超过 0.12 个世界单位')
          }
          addIssue('traversability.stairs.step-continuity-unverified', 'warning', path, '已提取踏步高度层统计，但尚未完成逐级连通、边缘断裂和人物胶囊体实测')
        }
      }
      if (collection === 'passages') {
        addIssue('traversability.passage.clearance-unverified', 'warning', path, '已绑定通道相关几何，但仅凭目标 Mesh 包围盒不能证明门洞净空')
      }

      records.push({
        id: declaration.id || null,
        type: collection,
        targetPartId,
        bound: true,
        status: 'geometry-bound',
        meshCount: meshes.length,
        bounds,
        upwardTriangleCount: surface.upwardTriangleCount,
        medianSlopeDegrees: surface.medianSlopeDegrees,
        stairProfile,
      })
    }
  }

  const blockingIssues = issues.filter(issue => issue.severity === 'error').length
  const reviewIssues = issues.filter(issue => issue.severity === 'warning').length
  return {
    version: 1,
    status: blockingIssues ? 'invalid' : (reviewIssues ? 'needs-review' : 'geometry-bound'),
    certifiedWalkable: false,
    summary: {
      declarationCount: records.length,
      geometryBoundCount: records.filter(record => record.bound).length,
      issueCount: issues.length,
      blockingIssueCount: blockingIssues,
      reviewIssueCount: reviewIssues,
    },
    records,
    issues,
  }
}
