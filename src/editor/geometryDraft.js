/**
 * 将画布采集的顶点转换为 GeoJSON 几何。
 * 地图编辑器使用同一坐标系；LineString 表示道路中心线，Polygon 表示建筑/区域边界。
 */
export function createDraftGeometry(type, points) {
  if (!Array.isArray(points)) throw new TypeError('绘制顶点必须是数组')
  if (!points.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
    throw new TypeError('所有绘制顶点都必须是有限数值 [x, y]')
  }

  if (type === 'LineString') {
    if (points.length < 2) throw new Error('线要素至少需要 2 个顶点')
    return { type, coordinates: points.map((point) => [...point]) }
  }

  if (type === 'Polygon') {
    if (points.length < 3) throw new Error('面要素至少需要 3 个顶点')
    const ring = points.map((point) => [...point])
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first])
    return { type, coordinates: [ring] }
  }

  throw new TypeError('当前绘制工具仅支持 LineString 和 Polygon')
}
