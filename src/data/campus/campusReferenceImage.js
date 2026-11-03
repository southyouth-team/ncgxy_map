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
