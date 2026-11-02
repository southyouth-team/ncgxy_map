import { createSceneObjectFromFeature } from './featureSceneAdapter.js'
import { createMapCoordinateMapper } from './mapCoordinateMapper.js'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1'

async function request(path, userId) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'X-Dev-User-Id': userId || import.meta.env.VITE_DEV_USER_ID || 'map-editor-local' },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || `场景数据请求失败：HTTP ${response.status}`)
  return payload
}

/**
 * 聚合地图 GIS Feature、图层类型与三维场景文档。
 * 未保存三维配置的 Feature 使用临时默认表现，绝不写回服务端。
 */
export async function loadCampusSceneData({ campusId, map, userId, worldWidth = 150 }) {
  if (!campusId || !map?.id) throw new TypeError('加载三维场景必须提供 campusId 和 map')
  const base = `/campuses/${campusId}/maps/${map.id}`
  const [layers, features, sceneResponse] = await Promise.all([
    request(`${base}/layers`, userId),
    request(`${base}/features`, userId),
    request(`${base}/scene`, userId),
  ])
  const layerById = new Map(layers.map((layer) => [String(layer.id), layer]))
  const savedDocument = sceneResponse.document || null
  const objectByFeature = new Map(
    (savedDocument?.objects || []).map((object) => [String(object.featureId), object]),
  )
  const mapCoordinateToWorld = createMapCoordinateMapper(map, { worldWidth })
  const objects = features.map((feature) => {
    const layer = layerById.get(String(feature.layer_id))
    const saved = objectByFeature.get(String(feature.id))
    const sceneObject = saved || createSceneObjectFromFeature(feature, {
      featureType: layer?.feature_type,
      layerId: String(feature.layer_id),
      source: 'gis-preview',
    })
    return { feature, sceneObject, mapCoordinateToWorld }
  })
  return {
    campusId: String(campusId),
    mapId: String(map.id),
    revision: Number(sceneResponse.revision || 0),
    document: savedDocument,
    objects,
    layers,
    mapCoordinateToWorld,
    source: 'postgis',
  }
}
