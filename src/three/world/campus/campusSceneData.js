import { getCampusSpatialLayers } from '../../../data/campus/campusGeoJSON.js'

/**
 * Shared normalization boundary for the homepage renderer and editor preview.
 * Both renderers consume the same FeatureCollection-derived spatial layers.
 */
export function createCampusSceneRenderData(featureCollection) {
  const layers = getCampusSpatialLayers(featureCollection)
  return {
    featureCollection,
    layers,
    previewDocument: {
      buildings: layers.buildings.map(building => ({
        ...(building.properties || {}),
        id: building.id,
        label: building.label,
        footprint: building.polygon,
        floors: building.floors,
        height: building.height,
        template: building.template,
        walkable: building.walkable,
        confidence: building.confidence,
        source: building.source,
        qualityStatus: building.qualityStatus,
      })),
      roads: layers.roads.map(road => ({
        ...(road.properties || {}),
        id: road.id,
        name: road.name,
        points: road.points,
        width: road.width,
        walkable: road.walkable,
        confidence: road.confidence,
      })),
      areas: layers.areas.map(area => ({
        ...(area.properties || {}),
        id: area.id,
        name: area.name,
        type: area.type,
        polygon: area.polygon,
        holes: area.holes,
        walkable: area.walkable,
        rect: area.rect,
        confidence: area.confidence,
      })),
      objects: layers.objects.map(object => ({
        id: object.id,
        type: object.type,
        name: object.name,
        geometry: { type: 'Point', coordinates: object.position },
        properties: { ...object.properties, rotation: object.rotation, scale: object.scale, walkable: object.walkable },
        source: object.source,
        qualityStatus: object.qualityStatus,
      })),
    },
  }
}

const CATEGORY_CONTRACTS = Object.freeze([
  {
    name: 'buildings',
    accepts: feature => feature?.properties?.featureType === 'building' && feature.geometry?.type === 'Polygon',
    layer: data => data.layers?.buildings,
    preview: data => data.previewDocument?.buildings,
    geometry: feature => feature.geometry.coordinates?.[0]?.slice(0, -1),
    layerGeometry: item => item.polygon,
    previewGeometry: item => item.footprint,
  },
  {
    name: 'roads',
    accepts: feature => feature?.properties?.featureType === 'road' && feature.geometry?.type === 'LineString',
    layer: data => data.layers?.roads,
    preview: data => data.previewDocument?.roads,
    geometry: feature => feature.geometry.coordinates,
    layerGeometry: item => item.points,
    previewGeometry: item => item.points,
  },
  {
    name: 'areas',
    accepts: feature => ['area', 'green', 'water', 'sports', 'plaza', 'parking'].includes(feature?.properties?.featureType) && feature.geometry?.type === 'Polygon',
    layer: data => data.layers?.areas,
    preview: data => data.previewDocument?.areas,
    geometry: feature => feature.geometry.coordinates.map(ring => ring.slice(0, -1)),
    layerGeometry: item => [item.polygon, ...(item.holes || [])],
    previewGeometry: item => [item.polygon, ...(item.holes || [])],
  },
  {
    name: 'objects',
    accepts: feature => feature?.geometry?.type === 'Point' && !['gate', 'poi'].includes(feature?.properties?.featureType),
    layer: data => data.layers?.objects,
    preview: data => data.previewDocument?.objects,
    geometry: feature => feature.geometry.coordinates,
    layerGeometry: item => item.position,
    previewGeometry: item => item.geometry?.coordinates,
  },
])

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Audit FeatureCollection -> normalized layers -> editor preview projection.
 * This is a deterministic data-pipeline check, not a substitute for GPU/browser
 * visual verification of the actual Three.js output.
 */
export function validateCampusSceneRenderData(featureCollection, renderData = createCampusSceneRenderData(featureCollection)) {
  const features = Array.isArray(featureCollection?.features) ? featureCollection.features : []
  const errors = []
  const push = (code, category, featureId, message) => errors.push({ code, category, featureId, message })

  for (const contract of CATEGORY_CONTRACTS) {
    const expected = features.filter(contract.accepts)
    const layers = Array.isArray(contract.layer(renderData)) ? contract.layer(renderData) : []
    const preview = Array.isArray(contract.preview(renderData)) ? contract.preview(renderData) : []
    const expectedIds = expected.map(feature => String(feature.id))
    const layerIds = layers.map(item => String(item?.id))
    const previewIds = preview.map(item => String(item?.id))

    const duplicates = values => values.filter((value, index) => values.indexOf(value) !== index)
    for (const id of duplicates(expectedIds)) push('DUPLICATE_SOURCE_ID', contract.name, id, '源 FeatureCollection 存在重复 ID')
    for (const id of duplicates(layerIds)) push('DUPLICATE_LAYER_ID', contract.name, id, '归一化图层存在重复 ID')
    for (const id of duplicates(previewIds)) push('DUPLICATE_PREVIEW_ID', contract.name, id, '编辑器预览存在重复 ID')

    const compareIds = (actual, target, stage) => {
      const expectedSet = new Set(target)
      const actualSet = new Set(actual)
      for (const id of target) if (!actualSet.has(id)) push('MISSING_FEATURE', contract.name, id, `${stage}缺少源对象`)
      for (const id of actual) if (!expectedSet.has(id)) push('UNEXPECTED_FEATURE', contract.name, id, `${stage}出现源数据之外的对象`)
    }
    compareIds(layerIds, expectedIds, '归一化图层')
    compareIds(previewIds, expectedIds, '编辑器预览')

    const layerById = new Map(layers.map(item => [String(item?.id), item]))
    const previewById = new Map(preview.map(item => [String(item?.id), item]))
    for (const feature of expected) {
      const id = String(feature.id)
      const layer = layerById.get(id)
      const projected = previewById.get(id)
      if (!layer || !projected) continue
      const sourceGeometry = contract.geometry(feature)
      if (!sameJsonValue(contract.layerGeometry(layer), sourceGeometry)) {
        push('LAYER_GEOMETRY_MISMATCH', contract.name, id, '归一化图层几何与源 Feature 不一致')
      }
      if (!sameJsonValue(contract.previewGeometry(projected), sourceGeometry)) {
        push('PREVIEW_GEOMETRY_MISMATCH', contract.name, id, '编辑器预览几何与源 Feature 不一致')
      }
      if (layer.walkable !== projected.walkable) {
        push('WALKABILITY_MISMATCH', contract.name, id, '归一化图层与编辑器预览的通行属性不一致')
      }
    }
  }

  const summary = Object.fromEntries(CATEGORY_CONTRACTS.map(contract => [
    contract.name,
    Array.isArray(contract.layer(renderData)) ? contract.layer(renderData).length : 0,
  ]))
  return {
    valid: errors.length === 0,
    errorCount: errors.length,
    errors,
    summary: {
      featureCount: features.length,
      ...summary,
      checkedCount: Object.values(summary).reduce((total, count) => total + count, 0),
    },
  }
}
