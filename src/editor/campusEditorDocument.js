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
