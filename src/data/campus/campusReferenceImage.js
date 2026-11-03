/**
 * 将原始参考图按等比 contain 放入校园逻辑画布。
 * 参考图的自然宽高可能随 CDN 转码变化，禁止直接拉伸导致道路/建筑形态失真。
 */
export function getReferenceImageContainRect(imageWidth, imageHeight, canvasWidth = 1000, canvasHeight = 500) {
  const values = [imageWidth, imageHeight, canvasWidth, canvasHeight].map(Number)
  if (!values.every(Number.isFinite) || values.some(value => value <= 0)) return null

  const [sourceWidth, sourceHeight, targetWidth, targetHeight] = values
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
    scale,
  }
}


/**
 * 判断参考图是否仍与校园数据集的图像坐标基准兼容。
 * 宽高比不一致通常意味着裁切或转码画布变化；此时不能假设矢量坐标仍可直接叠加。
 */
export function hasMatchingReferenceAspectRatio(
  imageWidth,
  imageHeight,
  referenceWidth = 1000,
  referenceHeight = 500,
  tolerance = 0.005,
) {
  const values = [imageWidth, imageHeight, referenceWidth, referenceHeight, tolerance].map(Number)
  if (!values.every(Number.isFinite) || values.some(value => value <= 0) || tolerance >= 1) return false
  const [sourceWidth, sourceHeight, targetWidth, targetHeight, allowedDeviation] = values
  const sourceRatio = sourceWidth / sourceHeight
  const targetRatio = targetWidth / targetHeight
  return Math.abs(sourceRatio - targetRatio) / targetRatio <= allowedDeviation
}
