/**
 * 校园编辑器空间文档工具。
 * 所有坐标均为原始校园平面图像素，不是经纬度或米制坐标。
 */
export function rectToPolygon(rect) {
  const [left, top, right, bottom] = rect
  return [[left, top], [right, top], [right, bottom], [left, bottom]]
}

export function polygonBounds(ring) {
  const xs = ring.map((point) => point[0])
  const ys = ring.map((point) => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function movePolygon(ring, dx, dy) {
  return ring.map(([x, y]) => [x + dx, y + dy])
}

export function rotatePolygon(ring, degrees = 90) {
  if (!ring?.length) return []
  const center = ring.reduce((sum, [x, y]) => [sum[0] + x / ring.length, sum[1] + y / ring.length], [0, 0])
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  return ring.map(([x, y]) => {
    const dx = x - center[0], dy = y - center[1]
    return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos]
  })
}

export function normalizeBuilding(building) {
  const footprint = Array.isArray(building.footprint) && building.footprint.length >= 3
    ? building.footprint.map(([x, y]) => [Number(x), Number(y)])
    : rectToPolygon(building.rect)
  return { ...building, footprint, rect: polygonBounds(footprint) }
}

export function createCampusEditorDocument(layout = {}) {
  return {
    schemaVersion: 2,
    coordinateSystem: 'campus-plan-pixel',
    units: 'pixel',
    source: 'campusLayout.js',
    areas: layout.areas || [],
    buildings: (layout.buildings || []).map(normalizeBuilding),
    roads: layout.roads || [],
    objects: layout.objects || [],
  }
}

export function validateCampusEditorDocument(document) {
  const errors = []
  if (!document || document.schemaVersion !== 2) errors.push('schemaVersion 必须为 2')
  if (document?.coordinateSystem !== 'campus-plan-pixel') errors.push('coordinateSystem 不受支持')
  for (const building of document?.buildings || []) {
    if (!building.id) errors.push('建筑缺少 id')
    if (!Array.isArray(building.footprint) || building.footprint.length < 3) errors.push(`建筑 ${building.id || 'unknown'} footprint 至少需要 3 个顶点`)
    if ((building.footprint || []).some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(Number(value))))) errors.push(`建筑 ${building.id || 'unknown'} footprint 坐标无效`)
  }
  for (const road of document?.roads || []) {
    if (!road.id || !Array.isArray(road.points) || road.points.length < 2) errors.push(`道路 ${road.id || 'unknown'} 至少需要两个路径点`)
  }
  return { valid: errors.length === 0, errors }
}

/**
 * 通用校园空间要素：建筑、道路、广场、绿地、水体、运动场、停车场等。
 * 面状要素统一使用 Polygon 顶点环；道路使用中心线 + 宽度；
 * modelRef 只引用外部/生成的三维资产，不把模型网格塞进 GIS 几何。
 */
export const CAMPUS_FEATURE_TYPES = Object.freeze([
  'building', 'road', 'plaza', 'green', 'water', 'sports',
  'parking', 'path', 'facility', 'terrain',
])

export function createSceneFeature({
  id, type = 'facility', name = '未命名要素', geometry,
  modelRef = null, properties = {},
}) {
  if (!CAMPUS_FEATURE_TYPES.includes(type)) throw new Error(`不支持的空间要素类型：${type}`)
  return {
    id: id || `feature-${Date.now()}`,
    type,
    name,
    geometry,
    modelRef,
    properties: { ...properties },
    confidence: 'unverified',
  }
}

export function validateSceneFeature(feature) {
  const errors = []
  if (!feature?.id) errors.push('空间要素缺少 id')
  if (!CAMPUS_FEATURE_TYPES.includes(feature?.type)) errors.push('空间要素类型不受支持')
  const geometry = feature?.geometry
  if (['building', 'plaza', 'green', 'water', 'sports', 'parking', 'facility', 'terrain'].includes(feature?.type)) {
    if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates?.[0]) || geometry.coordinates[0].length < 4) {
      errors.push('面状要素必须提供闭合 Polygon 坐标环')
    }
  }
  if (['road', 'path'].includes(feature?.type)) {
    if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      errors.push('线状要素必须提供至少两个点的 LineString')
    }
    if (!(Number(feature?.properties?.width) > 0)) errors.push('道路/路径必须提供大于 0 的 width')
  }
  return { valid: errors.length === 0, errors }
}

export function createModelAsset({
  id, name, source, format, uri, prompt = null, generator = null,
  license = null, bounds = null,
}) {
  const supportedFormats = ['glb', 'gltf', 'obj', 'fbx']
  if (!supportedFormats.includes(String(format).toLowerCase())) throw new Error('模型格式仅支持 GLB、GLTF、OBJ、FBX')
  if (!uri) throw new Error('模型资源必须提供可访问的资源 URI')
  if (!['import', 'ai-generated', 'builtin'].includes(source)) throw new Error('模型来源无效')
  return {
    id: id || `asset-${Date.now()}`,
    name: name || '未命名模型',
    source,
    format: String(format).toLowerCase(),
    uri,
    generation: source === 'ai-generated' ? { prompt, generator } : null,
    license,
    bounds,
    status: 'pending-review',
  }
}


/**
 * 将道路中心线转换为可渲染的面状轮廓。
 * 先用 Catmull-Rom 采样平滑中心线，再按局部切线偏移两侧边界；
 * miter 长度设上限，避免急弯处产生无限尖刺。
 * 输出未闭合重复点的 Polygon 外环（渲染层负责闭合）。
 */
export function roadToPolygon(points, width, samplesPerSegment = 8) {
  if (!Array.isArray(points) || points.length < 2 || !(Number(width) > 0)) return []
  const sampled = []
  if (points.length === 2) {
    sampled.push(points[0].map(Number), points[1].map(Number))
  } else {
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[Math.min(points.length - 1, i + 2)]
      for (let step = 0; step < samplesPerSegment; step++) {
        const t = step / samplesPerSegment
        const t2 = t * t, t3 = t2 * t
        const coordinate = (axis) => 0.5 * (
          2 * p1[axis] + (-p0[axis] + p2[axis]) * t +
          (2*p0[axis] - 5*p1[axis] + 4*p2[axis] - p3[axis]) * t2 +
          (-p0[axis] + 3*p1[axis] - 3*p2[axis] + p3[axis]) * t3
        )
        sampled.push([coordinate(0), coordinate(1)])
      }
    }
    sampled.push(points[points.length - 1].map(Number))
  }
  const half = Number(width) / 2
  const left = [], right = []
  for (let i = 0; i < sampled.length; i++) {
    const previous = sampled[Math.max(0, i - 1)]
    const next = sampled[Math.min(sampled.length - 1, i + 1)]
    let dx = next[0] - previous[0], dy = next[1] - previous[1]
    const length = Math.hypot(dx, dy) || 1
    dx /= length; dy /= length
    const nx = -dy, ny = dx
    left.push([sampled[i][0] + nx * half, sampled[i][1] + ny * half])
    right.push([sampled[i][0] - nx * half, sampled[i][1] - ny * half])
  }
  return [...left, ...right.reverse()]
}
