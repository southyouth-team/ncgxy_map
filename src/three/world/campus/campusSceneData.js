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
    previewWalkable: item => item.properties?.walkable,
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
      const previewWalkable = contract.previewWalkable ? contract.previewWalkable(projected) : projected.walkable
      if (layer.walkable !== previewWalkable) {
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


/**
 * Audit the actual Three.js campus scene tree against normalized feature layers.
 * Every renderable spatial feature root/segment must carry featureId metadata.
 */
export function auditCampusSceneFeatureCoverage(spatialLayers, sceneRoot) {
  const expected = {
    buildings: (spatialLayers?.buildings || []).map(item => String(item.id)),
    roads: (spatialLayers?.roads || []).map(item => String(item.id)),
    areas: (spatialLayers?.areas || []).map(item => String(item.id)),
    objects: (spatialLayers?.objects || []).map(item => String(item.id)),
  }
  const actual = Object.fromEntries(Object.keys(expected).map(key => [key, new Map()]))
  const push = (errors, code, category, featureId, message) => errors.push({ code, category, featureId, message })
  const errors = []

  sceneRoot?.traverse?.(object => {
    // Feature metadata 通常挂在 Group 根节点；向上查找最近的 Feature owner，
    // 使其子 Mesh 也计入该 Feature 的实际可渲染资源。
    let owner = object
    while (owner && (!owner.userData?.featureCategory || owner.userData?.featureId === undefined)) owner = owner.parent
    const data = owner?.userData || {}
    const category = data.featureCategory
    const id = data.featureId ?? (category === 'buildings' ? data.buildingId : undefined)
    if (!category || id === undefined || !actual[category]) return
    const key = String(id)
    const record = actual[category].get(key) || { renderableMeshes: 0, missingMaterialMeshes: 0 }
    if (object.isMesh || object.isLine || object.isPoints) {
      record.renderableMeshes += 1
      if (object.isMesh && (!object.geometry || !object.material)) record.missingMaterialMeshes += 1
    }
    actual[category].set(key, record)
  })

  for (const category of Object.keys(expected)) {
    const expectedIds = expected[category]
    const actualMap = actual[category]
    const expectedSet = new Set(expectedIds)
    for (const id of expectedSet) {
      if (!actualMap.has(id)) push(errors, 'SCENE_FEATURE_MISSING', category, id, '空间对象未生成对应的 Three.js 场景节点')
      else if (actualMap.get(id).renderableMeshes === 0) push(errors, 'SCENE_FEATURE_NOT_RENDERABLE', category, id, '场景节点未包含可渲染 Mesh/Line/Points')
      else if (actualMap.get(id).missingMaterialMeshes > 0) push(errors, 'SCENE_FEATURE_MATERIAL_MISSING', category, id, '场景中存在缺少几何体或材质的 Mesh')
    }
    for (const id of actualMap.keys()) {
      if (!expectedSet.has(id)) push(errors, 'SCENE_FEATURE_UNEXPECTED', category, id, '场景包含空间数据之外的 Feature 节点')
    }
    const counts = new Map()
    for (const id of expectedIds) counts.set(id, (counts.get(id) || 0) + 1)
    for (const [id, count] of counts) {
      if (count > 1) push(errors, 'SCENE_SOURCE_DUPLICATE_ID', category, id, '规范空间图层存在重复 Feature ID')
    }
  }

  const summary = Object.fromEntries(Object.keys(expected).map(category => [
    category,
    { expected: expected[category].length, rendered: actual[category].size },
  ]))
  return { valid: errors.length === 0, errorCount: errors.length, errors, summary }
}


/**
 * Validate asynchronously loaded GLB building roots without requiring a WebGL renderer.
 * A missing GLB is not an error: the procedural building remains the fallback renderer.
 */
export function validateCampusBuildingModels(models, canonicalBuildingIds = []) {
  const knownIds = new Set(Array.from(canonicalBuildingIds, id => String(id)))
  const seen = new Set()
  const errors = []
  const summary = { modelCount: Array.isArray(models) ? models.length : 0, meshCount: 0, triangleCount: 0 }
  const push = (code, buildingId, message) => errors.push({ code, buildingId, message })

  for (const model of Array.isArray(models) ? models : []) {
    const id = String(model?.userData?.buildingId ?? model?.name ?? '')
    if (!id) {
      push('GLB_BUILDING_ID_MISSING', null, 'GLB 模型缺少 buildingId')
      continue
    }
    if (seen.has(id)) push('GLB_BUILDING_ID_DUPLICATE', id, '同一建筑加载了多个 GLB 模型')
    seen.add(id)
    if (knownIds.size && !knownIds.has(id)) push('GLB_BUILDING_ID_UNKNOWN', id, 'GLB 模型 ID 不存在于规范建筑空间数据')

    let hasMesh = false
    let hasValidBounds = false
    model.traverse?.(object => {
      if (!object.isMesh) return
      hasMesh = true
      summary.meshCount += 1
      if (!object.geometry || !object.material) {
        push('GLB_MESH_RESOURCE_MISSING', id, 'GLB Mesh 缺少 geometry 或 material')
        return
      }
      const geometry = object.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox?.()
      const bounds = geometry.boundingBox
      if (bounds && [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)) {
        const sizeX = bounds.max.x - bounds.min.x
        const sizeY = bounds.max.y - bounds.min.y
        const sizeZ = bounds.max.z - bounds.min.z
        if (sizeX > 0 && sizeY > 0 && sizeZ > 0) hasValidBounds = true
      }
      const indexCount = geometry.index?.count ?? geometry.attributes?.position?.count ?? 0
      summary.triangleCount += geometry.index ? Math.floor(indexCount / 3) : Math.floor(indexCount / 3)
    })
    if (!hasMesh) push('GLB_MESH_MISSING', id, 'GLB 场景中没有 Mesh')
    else if (!hasValidBounds) push('GLB_BOUNDS_INVALID', id, 'GLB 模型没有有效的三维包围尺寸')
  }

  return { valid: errors.length === 0, errorCount: errors.length, errors, summary }
}
