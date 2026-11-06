const MIN_POINTS = 3
const MAX_POINTS = 32
const MIN_COORDINATE = -0.5
const MAX_COORDINATE = 0.5
const MIN_AREA = 0.0001

export function polygonOutlineArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0) / 2
}

export function validatePolygonOutline(points) {
  if (!Array.isArray(points) || points.length < MIN_POINTS || points.length > MAX_POINTS) throw new RangeError('轮廓必须包含 3 到 32 个点')
  points.forEach((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(Number(value)) || Number(value) < MIN_COORDINATE || Number(value) > MAX_COORDINATE)) throw new TypeError('轮廓点 ' + (index + 1) + ' 必须是 [-0.5,0.5] 范围内的二维坐标')
  })
  if (Math.abs(polygonOutlineArea(points)) < MIN_AREA) throw new RangeError('轮廓面积不能为零')
  return points
}

export function updatePolygonOutlinePoint(points, index, axis, value) {
  const next = points.map(point => [...point])
  if (!Number.isInteger(index) || index < 0 || index >= next.length || ![0, 1].includes(axis)) throw new RangeError('轮廓点索引或坐标轴无效')
  next[index][axis] = Number(value)
  return validatePolygonOutline(next)
}

export function addPolygonOutlinePoint(points) {
  validatePolygonOutline(points)
  if (points.length >= MAX_POINTS) throw new RangeError('轮廓点已达到 32 个上限')
  let longestIndex = 0, longestDistance = -1
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    const distance = (next[0] - point[0]) ** 2 + (next[1] - point[1]) ** 2
    if (distance > longestDistance) { longestDistance = distance; longestIndex = index }
  })
  const next = points.map(point => [...point])
  const a = points[longestIndex], b = points[(longestIndex + 1) % points.length]
  next.splice(longestIndex + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
  return validatePolygonOutline(next)
}

export function removePolygonOutlinePoint(points) {
  validatePolygonOutline(points)
  if (points.length <= MIN_POINTS) throw new RangeError('轮廓至少保留 3 个点')
  return validatePolygonOutline(points.slice(0, -1).map(point => [...point]))
}

export function polygonOutlineNormalizedToLocal(point, width, height) {
  return [Number(point[0]) * Number(width), Number(point[1]) * Number(height)]
}
export function polygonOutlineLocalToNormalized(x, y, width, height) {
  if (![x,y,width,height].every(value=>Number.isFinite(Number(value))) || Number(width)<=0 || Number(height)<=0) throw new TypeError('Polygon 局部坐标和尺寸必须是有限数值，尺寸必须大于零')
  return [Number(x)/Number(width),Number(y)/Number(height)]
}

export function updatePolygonOutlineVertex(points, index, x, y) {
  const next = points.map(point => [...point])
  if (!Number.isInteger(index) || index < 0 || index >= next.length) throw new RangeError('轮廓点索引无效')
  next[index] = [Number(x), Number(y)]
  return validatePolygonOutline(next)
}
