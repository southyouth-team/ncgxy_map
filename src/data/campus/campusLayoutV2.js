/**
 * 南昌工学院校园空间数据 V2。
 *
 * V2 与旧版 campusLayout.js 隔离：在参考图完成配准和人工核验前，
 * 不迁移旧版占位坐标，避免将演示数据误认为真实校园测绘数据。
 */

export const CAMPUS_LAYOUT_V2 = {
  schemaVersion: '2.0.0',
  campusId: 'ncgxy-main-campus',
  coordinateSystem: {
    type: 'image-pixel',
    origin: 'top-left',
    xAxis: 'right',
    yAxis: 'down',
    unit: 'px',
    calibrationStatus: 'uncalibrated',
    referenceImage: {
      id: 'freshman-guide-2026-campus-plan',
      title: '南昌工学院2026级新生报到指南校园平面图',
      sourcePage: 'https://app.gaokaozhitongche.com/newsguide/h/Rg1KJO0N',
      imageUrl: 'https://mmbiz.qpic.cn/sz_mmbiz_jpg/I7CrcZW85viauJhPE5oxIic650acadic3zicLbM1kQ4eHcz4fbdYMNw0QliaiapzFkyBOakxlRcZINmMyD2DO1ib6Da2agZD6iaKM9RhmA1mkh3H8Pc/640?from=appmsg&wx_fmt=jpeg',
      width: null,
      height: null,
      rightsStatus: 'reference-only',
    },
  },
  calibration: null,
  features: {
    boundary: [],
    entrances: [],
    roads: [],
    waterBodies: [],
    bridges: [],
    sportsGrounds: [],
    buildingClusters: [],
    buildings: [],
    greenSpaces: [],
    landmarks: [],
  },
}

/**
 * 将参考图像素坐标映射到以校园中心为原点的 XZ 平面。
 * 必须显式提供已核验的图像尺寸和世界宽度；V2 不提供虚构的默认比例尺。
 */
export function imagePixelToWorld(pixelX, pixelY, calibration) {
  validateCalibration(calibration)
  if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
    throw new TypeError('图像坐标必须是有限数值')
  }
  if (pixelX < 0 || pixelX > calibration.imageWidth
    || pixelY < 0 || pixelY > calibration.imageHeight) {
    throw new RangeError('图像坐标超出参考图范围')
  }

  const scale = calibration.worldWidth / calibration.imageWidth
  return {
    x: (pixelX - calibration.imageWidth / 2) * scale,
    z: (pixelY - calibration.imageHeight / 2) * scale,
  }
}

/** 校验配准参数，worldWidth 仅代表项目场景单位，不自动等同于米。 */
export function validateCalibration(calibration) {
  if (!calibration || typeof calibration !== 'object') {
    throw new TypeError('缺少坐标校准参数')
  }
  const required = ['imageWidth', 'imageHeight', 'worldWidth']
  for (const key of required) {
    if (!Number.isFinite(calibration[key]) || calibration[key] <= 0) {
      throw new TypeError('坐标校准参数无效：' + key)
    }
  }
  return true
}

/** 基础要素校验：所有要素必须可追溯且显式标记核验状态。 */
export function validateCampusFeature(feature) {
  if (!feature || typeof feature !== 'object') return false
  if (!feature.id || !feature.type) return false
  if (!['unverified', 'draft', 'verified'].includes(feature.status)) return false
  if (!['low', 'medium', 'high'].includes(feature.confidence)) return false
  if (!Array.isArray(feature.sourceRefs) || feature.sourceRefs.length === 0) return false
  return true
}
