import {
  CAMPUS_AREAS,
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_PLAN_REFERENCE,
  CAMPUS_ROAD_CENTERLINES,
  CAMPUS_ROAD_WIDTHS,
} from './campusLayout.js'
import { CAMPUS_BOUNDARY, CAMPUS_GATES, CAMPUS_POIS, CAMPUS_SITE_AREAS, CAMPUS_BUILDING_METADATA, buildCampusRoadGraph } from './campusInventory.js'

/**
 * 统一校园空间数据出口。
 * 坐标保持在校园参考平面图的图像像素系；所有展示端应消费此数据，
 * 不得在 2D / 2.5D / 3D 中重复维护位置。当前数据仍是人工近似数字化。
 */

// 当前程序化环境资产的既有坐标迁移为 Feature，后续可由编辑器逐个校准与替换。
const CAMPUS_DECORATION_OBJECTS = [
  ...[
    [176,82,0.9],[205,52,0.82],[244,75,0.88],[286,105,0.82],[285,145,0.9],
    [285,180,0.82],[292,210,0.9],[286,250,0.82],[282,290,0.9],[285,340,0.82],
    [175,300,0.88],[190,330,0.82],[220,355,0.9],[245,390,0.82],[275,425,0.9],
    [445,118,0.82],[470,92,0.9],[520,82,0.82],[575,92,0.9],[620,125,0.82],
    [650,170,0.9],[660,225,0.82],[645,285,0.9],[610,330,0.82],[565,355,0.9],
    [510,360,0.82],[465,335,0.9],[435,290,0.82],[420,235,0.9],[425,180,0.82],
    [650,155,0.9],[700,155,0.82],[755,160,0.9],[800,165,0.82],
    [810,300,0.9],[790,330,0.82],[760,335,0.9],[720,330,0.82],
    [500,445,0.9],[550,440,0.82],[610,440,0.9],[670,440,0.82],[730,440,0.9],
    [785,430,0.82],[330,160,0.9],[300,185,0.82],[300,310,0.9],[320,340,0.82],
    [380,340,0.9],[400,365,0.82],[365,430,0.9],[320,440,0.82],
  ].map(([x,y,scale], index) => ({ id: 'campus-tree-' + String(index + 1).padStart(3,'0'), type: 'tree', x, y, scale, source: 'legacy-scene-decoration' })),
  ...[[295,160],[310,190],[300,270],[300,370],[350,155],[405,160],[445,350],[470,365],[525,365],[585,350],[640,330],[655,160],[690,160],[745,165],[800,165],[810,330],[770,340],[725,340],[520,445],[600,445],[680,445],[745,445],[240,435],[190,420]]
    .map(([x,y], index) => ({ id: 'campus-flower-' + String(index + 1).padStart(3,'0'), type: 'flower', x, y, scale: 1, source: 'legacy-scene-decoration' })),
  ...[[300,175],[420,350],[185,330],[545,365],[650,345],[740,340],[250,420],[690,445]]
    .map(([x,y], index) => ({ id: 'campus-bench-' + String(index + 1).padStart(3,'0'), type: 'bench', x, y, scale: 1, source: 'legacy-scene-decoration' })),
  ...[[295,175],[405,165],[445,350],[640,345],[700,335],[785,315],[520,445],[610,445],[730,435],[185,330],[245,415],[800,175]]
    .map(([x,y], index) => ({ id: 'campus-lamp-' + String(index + 1).padStart(3,'0'), type: 'streetlight', x, y, scale: 1, source: 'legacy-scene-decoration' })),
]

export const CAMPUS_SPATIAL_DATASET = Object.freeze({
  id: 'ncgxy-main-campus',
  version: 2,
  coordinateSystem: 'NCGXY_REFERENCE_IMAGE_PIXEL',
  coordinateUnit: 'pixel',
  width: CAMPUS_PLAN_REFERENCE.image.width,
  height: CAMPUS_PLAN_REFERENCE.image.height,
  bounds: CAMPUS_PLAN_REFERENCE.mapBounds,
  source: CAMPUS_PLAN_REFERENCE.image.source,
  sourcePublishedAt: CAMPUS_PLAN_REFERENCE.image.publishedAt,
  sourceUrl: CAMPUS_PLAN_REFERENCE.image.sourcePageUrl,
  accuracyNote: '人工近似数字化，非测绘成果；未核验对象不得用于精确导航或工程测量。',
})

function closeRing(points) {
  if (!Array.isArray(points) || points.length < 3) return null
  const ring = points.map(([x, y]) => [x, y])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first])
  return ring
}

function rectToRing(rect) {
  if (!Array.isArray(rect) || rect.length !== 4) return null
  const [left, top, right, bottom] = rect
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null
  return closeRing([[left, top], [right, top], [right, bottom], [left, bottom]])
}

function areaGeometry(area) {
  const outer = area.polygon ? closeRing(area.polygon) : rectToRing(area.rect)
  if (!outer) return null
  const holes = (area.holes || []).map(closeRing).filter(Boolean)
  return { type: 'Polygon', coordinates: [outer, ...holes] }
}

/** 构建 GeoJSON FeatureCollection 兼容结构；坐标为本项目定义的本地像素系，并非 RFC 7946 经纬度。 */
export function buildCampusGeoJSON() {
  const features = []

  features.push({
    type: 'Feature',
    id: CAMPUS_BOUNDARY.id,
    properties: {
      id: CAMPUS_BOUNDARY.id,
      name: CAMPUS_BOUNDARY.name,
      featureType: 'boundary',
      confidence: CAMPUS_BOUNDARY.confidence,
      verificationStatus: CAMPUS_BOUNDARY.verificationStatus,
      source: CAMPUS_BOUNDARY.source,
      boundaryStatus: CAMPUS_BOUNDARY.boundaryStatus,
    },
    geometry: { type: 'Polygon', coordinates: [closeRing(CAMPUS_BOUNDARY.polygon)] },
  })

  for (const gate of CAMPUS_GATES) {
    features.push({
      type: 'Feature',
      id: gate.id,
      properties: {
        id: gate.id,
        name: gate.name,
        featureType: 'gate',
        category: 'campus-entrance',
        confidence: gate.confidence,
        verificationStatus: gate.verificationStatus,
        accessModes: gate.accessModes,
        source: gate.source,
        positionNote: gate.positionNote,
      },
      geometry: { type: 'Point', coordinates: [...gate.position] },
    })
  }

  for (const area of CAMPUS_AREAS) {
    const geometry = areaGeometry(area)
    if (!geometry) continue
    features.push({
      type: 'Feature',
      id: area.id,
      properties: {
        id: area.id,
        name: area.name,
        featureType: 'area',
        category: area.type,
        confidence: area.confidence || 'low',
        verificationStatus: 'unverified',
        source: CAMPUS_SPATIAL_DATASET.source,
      },
      geometry,
    })
  }

  for (const road of CAMPUS_ROAD_CENTERLINES) {
    if (!Array.isArray(road.points) || road.points.length < 2) continue
    features.push({
      type: 'Feature',
      id: road.id,
      properties: {
        id: road.id,
        name: road.name || road.id,
        featureType: 'road',
        confidence: road.confidence || 'low',
        verificationStatus: 'unverified',
        width: CAMPUS_ROAD_WIDTHS[road.id] || 12,
        source: CAMPUS_SPATIAL_DATASET.source,
      },
      geometry: { type: 'LineString', coordinates: road.points.map(([x, y]) => [x, y]) },
    })
  }

  for (const building of CAMPUS_BUILDING_FOOTPRINTS) {
    const ring = building.polygon ? closeRing(building.polygon) : rectToRing(building.rect)
    if (!ring) continue
    features.push({
      type: 'Feature',
      id: building.id,
      properties: {
        id: building.id,
        name: building.label || building.id,
        featureType: 'building',
        confidence: building.confidence || 'low',
        verificationStatus: building.verified === true ? 'verified' : 'unverified',
        source: CAMPUS_SPATIAL_DATASET.source,
        canonicalName: CAMPUS_BUILDING_METADATA[building.id]?.canonicalName ?? null,
        useType: CAMPUS_BUILDING_METADATA[building.id]?.useType || 'unclassified',
        identityStatus: CAMPUS_BUILDING_METADATA[building.id]?.identityStatus || 'pending',
        footprintStatus: CAMPUS_BUILDING_METADATA[building.id]?.footprintStatus || 'approximate',
        buildingNumber: CAMPUS_BUILDING_METADATA[building.id]?.buildingNumber ?? null,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }

  for (const object of CAMPUS_DECORATION_OBJECTS) {
    features.push({
      type: 'Feature',
      id: object.id,
      properties: {
        id: object.id,
        name: object.type === 'tree' ? '校园绿化树木' : object.type === 'flower' ? '景观花卉' : object.type === 'bench' ? '公共座椅' : '校园路灯',
        featureType: 'object',
        objectType: object.type,
        scale: object.scale,
        confidence: 'low',
        qualityStatus: 'unverified',
        verificationStatus: 'unverified',
        source: object.source,
      },
      geometry: { type: 'Point', coordinates: [object.x, object.y] },
    })
  }

  return {
    type: 'FeatureCollection',
    name: CAMPUS_SPATIAL_DATASET.id,
    metadata: {
      ...CAMPUS_SPATIAL_DATASET,
      // 未定位 POI/场地作为非空间目录记录保存，不伪造 GeoJSON 几何。
      catalogue: {
        pois: CAMPUS_POIS.map(item => ({ ...item })),
        siteAreas: CAMPUS_SITE_AREAS.map(item => ({ ...item })),
        buildingMetadata: Object.fromEntries(Object.entries(CAMPUS_BUILDING_METADATA).map(([id, value]) => [id, { ...value }])),
      },
    },
    features,
  }
}

function openRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return []
  const first = ring[0]
  const last = ring[ring.length - 1]
  return ring.slice(0, ring.length - (first[0] === last[0] && first[1] === last[1] ? 1 : 0))
}


/**
 * 合并首页校园场景的基础结构/装饰数据与编辑器数据。
 * boundary/gate/object 由基础数据提供默认值；编辑器同 ID Feature 覆盖基础值；
 * deletedFeatureIds 对基础对象执行删除屏蔽，避免下次启动重新出现。
 */
export function mergeCampusSceneFeatureCollections(baseCollection = buildCampusGeoJSON(), editorCollection = {}) {
  const structuralTypes = new Set(['boundary', 'gate', 'object'])
  const featureById = new Map(
    (baseCollection?.features || [])
      .filter(feature => structuralTypes.has(feature?.properties?.featureType))
      .map(feature => [String(feature.id), feature]),
  )
  for (const feature of editorCollection?.features || []) {
    if (feature?.id !== undefined && feature?.id !== null) featureById.set(String(feature.id), feature)
  }
  const deletedFeatureIds = [...new Set((editorCollection?.deletedFeatureIds || []).map(String))]
  const deleted = new Set(deletedFeatureIds)
  return {
    type: 'FeatureCollection',
    metadata: baseCollection?.metadata || {},
    features: [...featureById.values()].filter(feature => !deleted.has(String(feature.id))),
    deletedFeatureIds,
  }
}


/**
 * 返回供 Canvas 2D 与 Three.js 消费的统一空间图层视图。
 * 几何只从 FeatureCollection 派生，不在渲染端重复维护。
 */
export function getCampusSpatialLayers(collection = buildCampusGeoJSON()) {
  const features = Array.isArray(collection?.features) ? collection.features : []
  const featureType = feature => feature?.properties?.featureType
  const confidenceOf = feature => feature.properties.confidence || feature.properties.qualityStatus || 'low'
  const boundary = features.find(feature => featureType(feature) === 'boundary') || null
  const gates = features
    .filter(feature => featureType(feature) === 'gate' && feature.geometry?.type === 'Point')
    .map(feature => ({ id: feature.id, name: feature.properties.name, position: feature.geometry.coordinates, confidence: confidenceOf(feature) }))
  const catalogue = collection?.metadata?.catalogue || {}
  const pois = (catalogue.pois || CAMPUS_POIS).map(poi => ({ ...poi }))
  const siteAreas = (catalogue.siteAreas || CAMPUS_SITE_AREAS).map(area => ({ ...area }))
  // 编辑器 FeatureCollection 使用 green/water/sports/plaza/parking 作为直接类型；
  // 基础校园底图仍使用 area + category。此处统一归一化，不复制几何数据。
  const areaTypes = new Set(['area', 'green', 'water', 'sports', 'plaza', 'parking'])
  const areas = features
    .filter(feature => areaTypes.has(featureType(feature)) && feature.geometry?.type === 'Polygon')
    .map(feature => {
      const rings = feature.geometry.coordinates || []
      const polygon = openRing(rings[0])
      const xs = polygon.map(point => point[0])
      const ys = polygon.map(point => point[1])
      const category = feature.properties.category || feature.properties.areaType ||
        (featureType(feature) === 'green' ? 'vegetation' : featureType(feature))
      return {
        id: feature.id,
        name: feature.properties.name,
        type: category,
        confidence: confidenceOf(feature),
        polygon,
        holes: rings.slice(1).map(openRing),
        rect: category === 'sports' && polygon.length
          ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
          : null,
      }
    })

  const roads = features
    .filter(feature => featureType(feature) === 'road' && feature.geometry?.type === 'LineString')
    .map(feature => ({
      id: feature.id,
      name: feature.properties.name,
      confidence: confidenceOf(feature),
      points: feature.geometry.coordinates,
      width: Number(feature.properties.width) > 0 ? Number(feature.properties.width) : 12,
    }))

  const buildings = features
    .filter(feature => featureType(feature) === 'building' && feature.geometry?.type === 'Polygon')
    .map(feature => ({
      id: feature.id,
      label: feature.properties.name,
      confidence: confidenceOf(feature),
      polygon: openRing(feature.geometry.coordinates[0]),
      floors: feature.properties.floors,
      height: feature.properties.height,
      template: feature.properties.template,
      source: feature.properties.source,
      qualityStatus: feature.properties.qualityStatus,
    }))

  const objects = features
    .filter(feature => feature.geometry?.type === 'Point' && !['gate', 'poi'].includes(featureType(feature)))
    .map(feature => ({
      id: feature.id,
      type: feature.properties.objectType || featureType(feature) || 'facility',
      name: feature.properties.name,
      position: feature.geometry.coordinates,
      rotation: Number(feature.properties.rotation) || 0,
      scale: Number(feature.properties.scale) > 0 ? Number(feature.properties.scale) : 1,
      properties: { ...feature.properties },
      source: feature.properties.source,
      qualityStatus: feature.properties.qualityStatus,
    }))

  return {
    boundary, gates, areas, roads, buildings, objects, pois,
    roadGraph: buildCampusRoadGraph(
      features.filter(feature => featureType(feature) === 'road'),
      features.filter(feature => featureType(feature) === 'gate'),
    ),
    siteAreas,
  }
}


/**
 * 校园空间数据静态质检。
 * 返回结构化问题清单，不修改输入数据；可用于 CI、数据导入和编辑器保存前校验。
 */
export function validateCampusGeoJSON(collection = buildCampusGeoJSON(), dataset = CAMPUS_SPATIAL_DATASET) {
  const errors = []
  const warnings = []
  const features = Array.isArray(collection?.features) ? collection.features : []
  const width = Number.isFinite(dataset?.width) ? dataset.width : 0
  const height = Number.isFinite(dataset?.height) ? dataset.height : 0
  const seenIds = new Set()
  const allowedConfidence = new Set(['low', 'medium', 'high'])
  const allowedStatus = new Set(['verified', 'unverified'])

  if (collection?.type !== 'FeatureCollection') {
    errors.push({ code: 'INVALID_COLLECTION_TYPE', message: '根节点必须是 FeatureCollection' })
  }
  if (width <= 0 || height <= 0) {
    errors.push({ code: 'INVALID_DATASET_BOUNDS', message: '数据集必须提供有效的图像宽高' })
  }

  const visitCoordinates = (value, featureId, path = 'geometry.coordinates') => {
    if (!Array.isArray(value)) {
      errors.push({ code: 'INVALID_COORDINATES', featureId, path, message: '坐标节点必须是数组' })
      return
    }
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      const [x, y] = value
      if (x < 0 || y < 0 || x > width || y > height) {
        errors.push({ code: 'COORDINATE_OUT_OF_BOUNDS', featureId, path, message: '坐标超出参考底图像素范围' })
      }
      if (value.length > 2 && !value.slice(2).every(Number.isFinite)) {
        errors.push({ code: 'INVALID_COORDINATE_DIMENSION', featureId, path, message: '坐标附加维度必须为有限数值' })
      }
      return
    }
    value.forEach((child, index) => visitCoordinates(child, featureId, `${path}[${index}]`))
  }

  const orientation = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const segmentsIntersect = (a, b, c, d) => {
    const o1 = orientation(a, b, c)
    const o2 = orientation(a, b, d)
    const o3 = orientation(c, d, a)
    const o4 = orientation(c, d, b)
    return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
  }
  const validateRingTopology = (ring, featureId, path) => {
    if (!Array.isArray(ring) || ring.length < 4) return
    const points = ring.slice(0, -1)
    const distinct = new Set(points.map(point => Array.isArray(point) ? point.join(',') : String(point)))
    if (distinct.size < 3) {
      errors.push({ code: 'DEGENERATE_POLYGON_RING', featureId, path, message: 'Polygon 环至少需要三个不同顶点' })
      return
    }
    let twiceArea = 0
    for (let i = 0; i < points.length; i++) {
      const current = points[i]
      const next = points[(i + 1) % points.length]
      if (Array.isArray(current) && Array.isArray(next) &&
        Number.isFinite(current[0]) && Number.isFinite(current[1]) &&
        Number.isFinite(next[0]) && Number.isFinite(next[1])) {
        twiceArea += current[0] * next[1] - next[0] * current[1]
      }
    }
    if (Math.abs(twiceArea) < 1e-6) {
      errors.push({ code: 'ZERO_AREA_POLYGON_RING', featureId, path, message: 'Polygon 环面积为零或过小' })
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length]
      for (let j = i + 1; j < points.length; j++) {
        // 相邻边及首尾相邻边共享端点，不属于自交。
        if (j === i || j === i + 1 || (i === 0 && j === points.length - 1)) continue
        const c = points[j], d = points[(j + 1) % points.length]
        if ([a, b, c, d].every(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) &&
          segmentsIntersect(a, b, c, d)) {
          errors.push({ code: 'SELF_INTERSECTING_POLYGON_RING', featureId, path, message: 'Polygon 环存在边交叉' })
          break
        }
      }
    }
  }

  for (const [index, feature] of features.entries()) {
    const featureId = feature?.id == null ? '' : String(feature.id)
    if (!featureId) {
      errors.push({ code: 'MISSING_FEATURE_ID', path: `features[${index}]`, message: 'Feature 缺少唯一 ID' })
    } else if (seenIds.has(featureId)) {
      errors.push({ code: 'DUPLICATE_FEATURE_ID', featureId, message: 'Feature ID 重复' })
    } else {
      seenIds.add(featureId)
    }

    const properties = feature?.properties || {}
    if (!allowedConfidence.has(properties.confidence)) {
      errors.push({ code: 'INVALID_CONFIDENCE', featureId, message: 'confidence 必须为 low、medium 或 high' })
    }
    if (!allowedStatus.has(properties.verificationStatus)) {
      errors.push({ code: 'INVALID_VERIFICATION_STATUS', featureId, message: 'verificationStatus 必须为 verified 或 unverified' })
    }
    if (!properties.source) {
      errors.push({ code: 'MISSING_SOURCE', featureId, message: 'Feature 必须记录数据来源' })
    }

    const geometry = feature?.geometry
    if (!geometry || !['Polygon', 'LineString', 'Point'].includes(geometry.type)) {
      errors.push({ code: 'UNSUPPORTED_GEOMETRY', featureId, message: '仅允许 Polygon、LineString 或 Point 几何' })
      continue
    }
    const expectedGeometry = properties.featureType === 'road' ? 'LineString'
      : ['gate', 'poi'].includes(properties.featureType) ? 'Point' : 'Polygon'
    if (['road', 'area', 'building', 'boundary', 'gate', 'poi'].includes(properties.featureType) && geometry.type !== expectedGeometry) {
      errors.push({ code: 'GEOMETRY_TYPE_MISMATCH', featureId, message: `${properties.featureType} 要素应使用 ${expectedGeometry}` })
    }
    if (geometry.type === 'Point' && (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || !geometry.coordinates.slice(0, 2).every(Number.isFinite))) {
      errors.push({ code: 'INVALID_POINT', featureId, message: 'Point 必须包含有效的 x、y 坐标' })
    }
    if (geometry.type === 'LineString' && (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2)) {
      errors.push({ code: 'INVALID_LINESTRING', featureId, message: '道路至少需要两个坐标点' })
    }
    if (geometry.type === 'Polygon') {
      if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
        errors.push({ code: 'INVALID_POLYGON', featureId, message: 'Polygon 至少需要一个外环' })
      } else {
        geometry.coordinates.forEach((ring, ringIndex) => {
          if (!Array.isArray(ring) || ring.length < 4 ||
            JSON.stringify(ring[0]) !== JSON.stringify(ring[ring.length - 1])) {
            errors.push({ code: 'INVALID_POLYGON_RING', featureId, path: `geometry.coordinates[${ringIndex}]`, message: 'Polygon 环至少包含四个坐标且首尾闭合' })
          } else {
            validateRingTopology(ring, featureId, `geometry.coordinates[${ringIndex}]`)
          }
        })
      }
    }
    if (properties.featureType === 'road' && (!Number.isFinite(properties.width) || properties.width <= 0)) {
      errors.push({ code: 'INVALID_ROAD_WIDTH', featureId, message: '道路 width 必须为正数' })
    }
    visitCoordinates(geometry.coordinates, featureId)
    if (properties.confidence === 'high' && properties.verificationStatus !== 'verified') {
      warnings.push({ code: 'HIGH_CONFIDENCE_UNVERIFIED', featureId, message: '高置信度要素尚未完成核验，建议复查置信度标注' })
    }
  }

  return {
    valid: errors.length === 0,
    featureCount: features.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  }
}
