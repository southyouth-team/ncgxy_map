/**
 * campus-local 地图坐标到 Three.js XZ 平面的统一转换。
 * 当前只做平移与等比例缩放；不得把 pixel/local-unit 解释为真实米制。
 */
export function createMapCoordinateMapper(map, options = {}) {
  const width = Number(map?.canvas_width ?? map?.canvasWidth)
  const height = Number(map?.canvas_height ?? map?.canvasHeight)
  const worldWidth = Number(options.worldWidth || 150)
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError('地图必须提供有效 canvas_width 和 canvas_height')
  }
  if (!Number.isFinite(worldWidth) || worldWidth <= 0) throw new TypeError('worldWidth 必须为正数')
  const scale = worldWidth / width
  return ([mapX, mapY]) => {
    if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) throw new TypeError('地图坐标必须是有限数值')
    return {
      x: (mapX - width / 2) * scale,
      z: (mapY - height / 2) * scale,
    }
  }
}
