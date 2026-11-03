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

/**
 * 校验像素空间几何。Polygon 使用闭合环；LineString 至少两个点；Point 为单点。
 * 不自动修复或猜测几何，避免标注错误被静默写入正式数据。
 */
export function validateCampusGeometry(geometry, imageWidth, imageHeight) {
  if (!geometry || typeof geometry !== 'object') return false
  if (!Number.isFinite(imageWidth) || imageWidth <= 0
    || !Number.isFinite(imageHeight) || imageHeight <= 0) return false

  const validPoint = (point) => Array.isArray(point)
    && point.length === 2
    && point.every(Number.isFinite)
    && point[0] >= 0 && point[0] <= imageWidth
    && point[1] >= 0 && point[1] <= imageHeight

  if (geometry.type === 'Point') return validPoint(geometry.coordinates)
  if (geometry.type === 'LineString') {
    return Array.isArray(geometry.coordinates)
      && geometry.coordinates.length >= 2
      && geometry.coordinates.every(validPoint)
  }
  if (geometry.type === 'Polygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return false
    return geometry.coordinates.every((ring) => Array.isArray(ring)
      && ring.length >= 4
      && ring.every(validPoint)
      && ring[0][0] === ring[ring.length - 1][0]
      && ring[0][1] === ring[ring.length - 1][1])
  }
  return false
}

/** 基础要素校验：所有要素必须可追溯且显式标记核验状态。 */
export function validateCampusFeature(feature, imageWidth, imageHeight) {
  if (!feature || typeof feature !== 'object') return false
  if (!feature.id || !feature.type) return false
  if (!['unverified', 'draft', 'verified'].includes(feature.status)) return false
  if (!['low', 'medium', 'high'].includes(feature.confidence)) return false
  if (!Array.isArray(feature.sourceRefs) || feature.sourceRefs.length === 0) return false
  if (feature.geometry && !validateCampusGeometry(feature.geometry, imageWidth, imageHeight)) return false
  return true
}


const FEATURE_COLLECTIONS = {
  boundary: { collection: 'boundary', geometry: 'Polygon' },
  entrance: { collection: 'entrances', geometry: 'Point' },
  road: { collection: 'roads', geometry: 'LineString' },
  'water-body': { collection: 'waterBodies', geometry: 'Polygon' },
  bridge: { collection: 'bridges', geometry: 'LineString' },
  'sports-ground': { collection: 'sportsGrounds', geometry: 'Polygon' },
  'building-cluster': { collection: 'buildingClusters', geometry: 'Polygon' },
  building: { collection: 'buildings', geometry: 'Polygon' },
  'green-space': { collection: 'greenSpaces', geometry: 'Polygon' },
  landmark: { collection: 'landmarks', geometry: 'Point' },
}

/** 完整 V2 文档校验：集合、类型、像素范围、唯一 ID 和校准尺寸。 */
export function validateCampusLayoutV2(documentData) {
  const errors = []
  if (!documentData || typeof documentData !== 'object') return { valid: false, errors: ['V2 文档必须是对象'] }
  if (documentData.schemaVersion !== '2.0.0') errors.push('schemaVersion 必须为 2.0.0')
  if (documentData.campusId !== 'ncgxy-main-campus') errors.push('campusId 不属于南昌工学院主校区')
  const coordinateSystem = documentData.coordinateSystem
  if (coordinateSystem?.type !== 'image-pixel' || coordinateSystem?.origin !== 'top-left'
    || coordinateSystem?.xAxis !== 'right' || coordinateSystem?.yAxis !== 'down' || coordinateSystem?.unit !== 'px') {
    errors.push('坐标系必须为左上角原点、X 向右、Y 向下的 image-pixel / px')
  }
  const referenceImage = coordinateSystem?.referenceImage
  const imageWidth = referenceImage?.width
  const imageHeight = referenceImage?.height
  if (!Number.isFinite(imageWidth) || imageWidth <= 0 || !Number.isFinite(imageHeight) || imageHeight <= 0) {
    errors.push('参考图必须包含有效的像素宽高')
  }
  const features = documentData.features
  if (!features || typeof features !== 'object' || Array.isArray(features)) {
    errors.push('features 必须是集合对象')
    return { valid: false, errors }
  }
  const expectedCollections = new Set(Object.values(FEATURE_COLLECTIONS).map(item => item.collection))
  for (const collection of expectedCollections) {
    if (!Array.isArray(features[collection])) errors.push('缺少有效要素集合：' + collection)
  }
  for (const collection of Object.keys(features)) {
    if (!expectedCollections.has(collection)) errors.push('存在未知要素集合：' + collection)
  }
  const ids = new Set()
  for (const [type, definition] of Object.entries(FEATURE_COLLECTIONS)) {
    const items = features[definition.collection]
    if (!Array.isArray(items)) continue
    for (const feature of items) {
      const label = feature?.id || definition.collection
      if (!feature || feature.type !== type) {
        errors.push('要素类型与集合不匹配：' + label)
        continue
      }
      if (ids.has(feature.id)) errors.push('要素 ID 重复：' + feature.id)
      if (feature.id) ids.add(feature.id)
      if (feature.geometry?.type !== definition.geometry) errors.push('要素几何类型错误：' + label + '，应为 ' + definition.geometry)
      if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)
        || !validateCampusFeature(feature, imageWidth, imageHeight) || !feature.geometry) {
        errors.push('要素元数据或几何校验失败：' + label)
      }
    }
  }
  if (documentData.calibration != null) {
    try {
      validateCalibration(documentData.calibration)
      if (documentData.calibration.imageWidth !== imageWidth || documentData.calibration.imageHeight !== imageHeight) {
        errors.push('校准参数的图像尺寸与参考图尺寸不一致')
      }
    } catch (error) {
      errors.push(error.message || '坐标校准参数无效')
    }
  }
  return { valid: errors.length === 0, errors }
}
