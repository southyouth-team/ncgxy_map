import { createSceneObject } from './sceneDocument.js'

const FEATURE_TO_SCENE_TYPE = Object.freeze({
  building: 'building',
  road: 'road',
  water: 'water',
  green: 'terrain',
  sports: 'terrain',
  boundary: 'terrain',
  poi: 'facility',
  custom: 'facility',
})

/**
 * 将 API Feature 转成场景对象描述。
 * 这里只建立引用和三维属性，不复制 Feature.geometry。
 */
export function createSceneObjectFromFeature(feature, options = {}) {
  if (!feature || feature.id === undefined || feature.id === null) {
    throw new TypeError('GIS Feature 必须包含 id')
  }
  const featureType = options.featureType || feature.featureType || feature.layerType
  const type = FEATURE_TO_SCENE_TYPE[featureType]
  if (!type) throw new TypeError(`无法映射 GIS Feature 类型：${featureType || '(empty)'}`)

  return createSceneObject(type, {
    id: options.id,
    featureId: String(feature.id),
    name: options.name || feature.name || defaultName(type),
    templateId: options.templateId,
    assetId: options.assetId,
    layerId: options.layerId || String(feature.layerId || 'default'),
    elevation: options.elevation,
    modelTransform: options.modelTransform,
    render: options.render,
    properties: options.properties,
    source: options.source || 'gis-feature',
  })
}

/**
 * 把 GIS GeoJSON 坐标映射为 Three.js 地面 X/Z 坐标。
 * mapCoordinateToWorld 接收 [mapX,mapY]，返回 {x,z}；
 * Geometry 的拓扑层级和类型保持不变。
 */
export function mapFeatureGeometryToWorld(feature, mapCoordinateToWorld) {
  if (!feature?.geometry || typeof feature.geometry.type !== 'string') {
    throw new TypeError('GIS Feature 缺少合法 geometry')
  }
  if (typeof mapCoordinateToWorld !== 'function') {
    throw new TypeError('必须提供地图坐标到三维世界坐标的转换函数')
  }
  return {
    type: feature.geometry.type,
    coordinates: mapCoordinates(feature.geometry.coordinates, mapCoordinateToWorld),
  }
}

function mapCoordinates(value, mapper) {
  if (!Array.isArray(value)) throw new TypeError('GeoJSON coordinates 格式无效')
  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    const point = mapper(value)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      throw new TypeError('坐标转换函数必须返回有限数值 x、z')
    }
    return [point.x, point.z]
  }
  return value.map((child) => mapCoordinates(child, mapper))
}

function defaultName(type) {
  return ({ building: '未命名建筑', road: '未命名道路', terrain: '未命名地表', water: '未命名水域', facility: '校园设施' })[type]
}
