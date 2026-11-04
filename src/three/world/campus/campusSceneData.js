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
    // building-cluster 是建筑布局辅助分组，不单独生成地面 Mesh。
    areas: (spatialLayers?.areas || []).filter(item => item.type !== 'building-cluster').map(item => String(item.id)),
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


/**
 * Compare loaded GLB world bounds with canonical building footprints.
 * Polygon AABBs are a coarse diagnostic; concave and rotated footprints can
 * legitimately differ from an axis-aligned model box.
 */
export function auditCampusBuildingModelGeometry(buildings, modelRecords, mapPixelToWorld, options = {}) {
  const centerTolerance = Number.isFinite(options.centerTolerance) ? options.centerTolerance : 2.5
  const sizeRelativeTolerance = Number.isFinite(options.sizeRelativeTolerance) ? options.sizeRelativeTolerance : 0.35
  const heightTolerance = Number.isFinite(options.heightTolerance) ? options.heightTolerance : 1.5
  const models = new Map((Array.isArray(modelRecords) ? modelRecords : []).map(model => [String(model.buildingId), model]))
  const errors = []
  const results = []
  const push = (code, buildingId, message, details = {}) => errors.push({ code, buildingId, message, ...details })
  let notLoadedCount = 0
  let checkedCount = 0

  for (const building of Array.isArray(buildings) ? buildings : []) {
    const id = String(building?.id ?? '')
    const model = models.get(id)
    if (!model) {
      notLoadedCount += 1
      results.push({ buildingId: id, status: 'not_loaded' })
      continue
    }
    checkedCount += 1
    const polygon = Array.isArray(building.polygon) ? building.polygon : []
    const worldPoints = polygon.map(point => mapPixelToWorld(point[0], point[1]))
      .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.z))
    if (worldPoints.length < 3) {
      results.push({ buildingId: id, status: 'not_comparable', reason: 'invalid_canonical_footprint' })
      continue
    }
    const expected = {
      minX: Math.min(...worldPoints.map(point => point.x)),
      maxX: Math.max(...worldPoints.map(point => point.x)),
      minZ: Math.min(...worldPoints.map(point => point.z)),
      maxZ: Math.max(...worldPoints.map(point => point.z)),
    }
    const bounds = model.bounds || {}
    const values = [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, bounds.minY, bounds.maxY]
    if (!values.every(Number.isFinite)) {
      push('GLB_WORLD_BOUNDS_INVALID', id, '模型世界包围盒缺少有限坐标')
      results.push({ buildingId: id, status: 'invalid_model_bounds' })
      continue
    }
    const expectedCenter = { x: (expected.minX + expected.maxX) / 2, z: (expected.minZ + expected.maxZ) / 2 }
    const actualCenter = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
    const centerOffset = Math.hypot(actualCenter.x - expectedCenter.x, actualCenter.z - expectedCenter.z)
    // Sort dimensions so a correctly rotated 90-degree rectangular model is not
    // falsely reported as a width/depth swap.
    const expectedDimensions = [expected.maxX - expected.minX, expected.maxZ - expected.minZ].sort((a, b) => b - a)
    const actualDimensions = [bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ].sort((a, b) => b - a)
    const widthError = expectedDimensions[0] > 0 ? Math.abs(actualDimensions[0] - expectedDimensions[0]) / expectedDimensions[0] : null
    const depthError = expectedDimensions[1] > 0 ? Math.abs(actualDimensions[1] - expectedDimensions[1]) / expectedDimensions[1] : null
    const itemErrors = []
    if (centerOffset > centerTolerance) {
      itemErrors.push('GLB_FOOTPRINT_CENTER_OFFSET')
      push('GLB_FOOTPRINT_CENTER_OFFSET', id, '模型世界包围盒中心偏离建筑 footprint 包围盒中心', { centerOffset, tolerance: centerTolerance })
    }
    if (widthError !== null && widthError > sizeRelativeTolerance) {
      itemErrors.push('GLB_FOOTPRINT_WIDTH_MISMATCH')
      push('GLB_FOOTPRINT_WIDTH_MISMATCH', id, '模型世界包围盒长边与 footprint 粗略长边不一致', { relativeError: widthError, tolerance: sizeRelativeTolerance })
    }
    if (depthError !== null && depthError > sizeRelativeTolerance) {
      itemErrors.push('GLB_FOOTPRINT_DEPTH_MISMATCH')
      push('GLB_FOOTPRINT_DEPTH_MISMATCH', id, '模型世界包围盒短边与 footprint 粗略短边不一致', { relativeError: depthError, tolerance: sizeRelativeTolerance })
    }
    const expectedHeight = Number(building.height)
    const actualHeight = bounds.maxY - bounds.minY
    let heightStatus = 'not_comparable'
    if (Number.isFinite(expectedHeight) && expectedHeight > 0) {
      const tolerance = Math.max(heightTolerance, expectedHeight * 0.2)
      heightStatus = Math.abs(actualHeight - expectedHeight) <= tolerance ? 'matched' : 'mismatch'
      if (heightStatus === 'mismatch') {
        itemErrors.push('GLB_BUILDING_HEIGHT_MISMATCH')
        push('GLB_BUILDING_HEIGHT_MISMATCH', id, '模型实际高度与建筑源数据高度不一致', { actualHeight, expectedHeight, tolerance })
      }
    }
    const transform = model.transform || {}
    if (![transform.x, transform.y, transform.z, transform.rotationY].every(value => value === undefined || Number.isFinite(value))) {
      itemErrors.push('GLB_TRANSFORM_NON_FINITE')
      push('GLB_TRANSFORM_NON_FINITE', id, '模型根节点位置或旋转包含非有限数值')
    }
    results.push({
      buildingId: id,
      status: itemErrors.length ? 'mismatch' : 'checked',
      centerOffset,
      widthRelativeError: widthError,
      depthRelativeError: depthError,
      actualHeight,
      expectedHeight: Number.isFinite(expectedHeight) && expectedHeight > 0 ? expectedHeight : null,
      heightStatus,
      rotationY: Number.isFinite(transform.rotationY) ? transform.rotationY : null,
      checks: itemErrors,
    })
  }

  const canonicalIds = new Set((Array.isArray(buildings) ? buildings : []).map(item => String(item?.id ?? '')))
  const unknownModelIds = [...models.keys()].filter(id => !canonicalIds.has(id))
  for (const id of unknownModelIds) push('GLB_GEOMETRY_UNKNOWN_BUILDING', id, '模型没有对应的规范建筑 footprint')
  return {
    valid: errors.length === 0,
    errorCount: errors.length,
    errors,
    results,
    summary: {
      canonicalBuildingCount: Array.isArray(buildings) ? buildings.length : 0,
      loadedModelCount: models.size,
      checkedCount,
      notLoadedCount,
      mismatchCount: results.filter(item => item.status === 'mismatch' || item.status === 'invalid_model_bounds').length,
      unknownModelCount: unknownModelIds.length,
    },
    limitations: [
      '占地尺寸使用 footprint 与模型世界包围盒的轴对齐包围盒比较；凹形、斜边或旋转建筑可能产生近似误差。',
      '仅当建筑源数据提供明确 height 时才比较高度；缺失高度标记为 not_comparable。',
      '模型旋转角仅记录，不与预期角度比较，因为当前规范建筑 Feature 未提供统一的方向基准。',
    ],
  }
}

/**
 * Build a complete GLB asset worklist from canonical building Features.
 * Footprint centers are placement candidates, not surveyed building origins.
 */
export function createCampusBuildingAssetInventory(buildings, manifestBuildings, mapPixelToWorld) {
  const manifest = Array.isArray(manifestBuildings) ? manifestBuildings : []
  const manifestById = new Map()
  const duplicateManifestIds = []
  for (const item of manifest) {
    const id = String(item?.buildingId ?? '')
    if (!id) continue
    if (manifestById.has(id)) duplicateManifestIds.push(id)
    else manifestById.set(id, item)
  }
  const canonical = Array.isArray(buildings) ? buildings : []
  const canonicalIds = new Set(canonical.map(item => String(item?.id ?? '')))
  const items = canonical.map(building => {
    const buildingId = String(building?.id ?? '')
    const configured = manifestById.get(buildingId) || {}
    const polygon = Array.isArray(building?.polygon) ? building.polygon : []
    const worldPoints = typeof mapPixelToWorld === 'function'
      ? polygon.map(point => mapPixelToWorld(point[0], point[1])).filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.z))
      : []
    const center = worldPoints.length >= 3 ? {
      x: (Math.min(...worldPoints.map(point => point.x)) + Math.max(...worldPoints.map(point => point.x))) / 2,
      z: (Math.min(...worldPoints.map(point => point.z)) + Math.max(...worldPoints.map(point => point.z))) / 2,
    } : null
    const hasConfiguredPosition = Array.isArray(configured.position) && configured.position.length === 3 && configured.position.every(Number.isFinite)
    const sourceRotation = building?.properties?.rotationY
    const hasConfiguredRotation = Number.isFinite(configured.rotationY)
    const hasSourceRotation = Number.isFinite(sourceRotation)
    const rotationY = hasConfiguredRotation ? configured.rotationY : hasSourceRotation ? sourceRotation : null
    const modelUrl = typeof configured.modelUrl === 'string' && configured.modelUrl.startsWith('/models/buildings/') ? configured.modelUrl : null
    return {
      buildingId,
      name: configured.name || building?.label || buildingId,
      position: hasConfiguredPosition ? [...configured.position] : center ? [center.x, 0, center.z] : null,
      positionSource: hasConfiguredPosition ? 'manifest' : center ? 'derived-footprint-aabb-center' : 'unavailable',
      positionVerified: hasConfiguredPosition && configured.positionVerified === true,
      rotationY,
      rotationSource: hasConfiguredRotation ? 'manifest' : hasSourceRotation ? 'canonical-feature' : 'unverified-default-required',
      rotationVerified: hasConfiguredRotation && configured.rotationVerified === true,
      modelUrl,
      assetStatus: modelUrl ? (configured.status || 'configured') : 'pending-model',
      source: configured.source || null,
      notes: configured.notes || null,
    }
  })
  const unknownManifestIds = [...manifestById.keys()].filter(id => !canonicalIds.has(id))
  return {
    schemaVersion: 1,
    coordinateSystem: 'local-campus-meter',
    units: 'meters',
    items,
    errors: [
      ...duplicateManifestIds.map(buildingId => ({ code: 'ASSET_MANIFEST_DUPLICATE_ID', buildingId })),
      ...unknownManifestIds.map(buildingId => ({ code: 'ASSET_MANIFEST_UNKNOWN_BUILDING', buildingId })),
    ],
    summary: {
      canonicalBuildingCount: canonical.length,
      configuredModelCount: items.filter(item => item.modelUrl).length,
      pendingModelCount: items.filter(item => !item.modelUrl).length,
      configuredPositionCount: items.filter(item => item.positionSource === 'manifest').length,
      derivedPositionCount: items.filter(item => item.positionSource === 'derived-footprint-aabb-center').length,
      unverifiedRotationCount: items.filter(item => item.rotationY === null).length,
      duplicateManifestIdCount: duplicateManifestIds.length,
      unknownManifestIdCount: unknownManifestIds.length,
    },
    limitations: [
      '由 footprint 轴对齐包围盒推导的位置只是模型摆放候选点，不是测绘确认的建筑原点。',
      '没有可靠方向数据时 rotationY 保持 null；模型资产进入 ready 状态前必须人工确认旋转角。',
      '没有模型文件的建筑保留在待制作清单，不会尝试加载虚构路径。',
    ],
  }
}