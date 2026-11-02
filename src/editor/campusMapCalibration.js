/**
 * 校园底图相似变换校准。
 *
 * source：底图像素坐标；target：校园局部坐标（单位由项目约定，例如 m）。
 * 仅拟合统一比例 + 旋转 + 平移，不涉及经纬度投影、仿射剪切或 GIS 坐标参考系。
 */

const EPSILON = 1e-10

function assertPoint(point, label) {
  if (!Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(Number(value)))) {
    throw new TypeError(`${label} 必须是两个有限数值组成的坐标`)
  }
}

export function applyCampusCalibration(point, transform) {
  assertPoint(point, 'source')
  if (!transform || ![transform.a, transform.b, transform.tx, transform.ty].every(Number.isFinite)) {
    throw new TypeError('校准参数无效')
  }
  const [x, y] = point.map(Number)
  return [transform.a * x - transform.b * y + transform.tx, transform.b * x + transform.a * y + transform.ty]
}

export function invertCampusCalibration(point, transform) {
  assertPoint(point, 'target')
  const determinant = transform?.a ** 2 + transform?.b ** 2
  if (!Number.isFinite(determinant) || determinant <= EPSILON || !Number.isFinite(transform.tx) || !Number.isFinite(transform.ty)) {
    throw new TypeError('校准变换不可逆')
  }
  const [x, y] = point.map(Number)
  const dx = x - transform.tx, dy = y - transform.ty
  return [(transform.a * dx + transform.b * dy) / determinant, (-transform.b * dx + transform.a * dy) / determinant]
}

/**
 * 使用最小二乘拟合 2D 相似变换。至少需要两个不同的源控制点。
 * 多于两个控制点时可降低人工点选误差，并通过 rmsError 评估拟合质量。
 */
export function fitCampusSimilarityTransform(controlPoints = []) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) throw new RangeError('相似变换校准至少需要两个控制点')
  controlPoints.forEach((item, index) => {
    assertPoint(item?.source, `控制点 ${index + 1} source`)
    assertPoint(item?.target, `控制点 ${index + 1} target`)
  })

  const count = controlPoints.length
  const sourceCenter = controlPoints.reduce((sum, item) => [sum[0] + Number(item.source[0]) / count, sum[1] + Number(item.source[1]) / count], [0, 0])
  const targetCenter = controlPoints.reduce((sum, item) => [sum[0] + Number(item.target[0]) / count, sum[1] + Number(item.target[1]) / count], [0, 0])
  let denominator = 0, real = 0, imaginary = 0
  for (const item of controlPoints) {
    const x = Number(item.source[0]) - sourceCenter[0]
    const y = Number(item.source[1]) - sourceCenter[1]
    const u = Number(item.target[0]) - targetCenter[0]
    const v = Number(item.target[1]) - targetCenter[1]
    denominator += x * x + y * y
    real += x * u + y * v
    imaginary += x * v - y * u
  }
  if (denominator <= EPSILON) throw new RangeError('源控制点重合或间距过小，无法计算比例')
  const a = real / denominator, b = imaginary / denominator
  const scale = Math.hypot(a, b)
  if (!Number.isFinite(scale) || scale <= EPSILON) throw new RangeError('目标控制点无法确定有效比例')
  const transform = {
    type: 'similarity',
    a,
    b,
    tx: targetCenter[0] - a * sourceCenter[0] + b * sourceCenter[1],
    ty: targetCenter[1] - b * sourceCenter[0] - a * sourceCenter[1],
    scale,
    rotationRadians: Math.atan2(b, a),
    rotationDegrees: Math.atan2(b, a) * 180 / Math.PI,
    controlPointCount: count,
  }
  const squaredError = controlPoints.reduce((sum, item) => {
    const predicted = applyCampusCalibration(item.source, transform)
    return sum + (predicted[0] - item.target[0]) ** 2 + (predicted[1] - item.target[1]) ** 2
  }, 0)
  transform.rmsError = Math.sqrt(squaredError / count)
  return transform
}

export function createReferenceImageMetadata({ id, name, uri, width, height, opacity = 0.65 } = {}) {
  if (!uri) throw new TypeError('底图必须提供可访问的资源 URI')
  if (!(Number(width) > 0) || !(Number(height) > 0)) throw new TypeError('底图必须提供有效像素宽高')
  return {
    id: id || `reference-image-${Date.now()}`,
    name: name || '校园参考底图',
    uri,
    width: Number(width),
    height: Number(height),
    opacity: Math.min(1, Math.max(0, Number(opacity))),
    coordinateSpace: 'image-pixel',
    status: 'unverified',
  }
}
