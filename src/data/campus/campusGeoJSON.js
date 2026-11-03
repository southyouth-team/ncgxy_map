import {
  CAMPUS_AREAS,
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_PLAN_REFERENCE,
  CAMPUS_ROAD_CENTERLINES,
  CAMPUS_ROAD_WIDTHS,
} from './campusLayout.js'

/**
 * 统一校园空间数据出口。
 * 坐标保持在校园参考平面图的图像像素系；所有展示端应消费此数据，
 * 不得在 2D / 2.5D / 3D 中重复维护位置。当前数据仍是人工近似数字化。
 */
export const CAMPUS_SPATIAL_DATASET = Object.freeze({
  id: 'ncgxy-main-campus',
  version: 1,
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

/** 构建符合 RFC 7946 FeatureCollection 结构的校园平面数据。 */
export function buildCampusGeoJSON() {
  const features = []

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
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }

  return {
    type: 'FeatureCollection',
    name: CAMPUS_SPATIAL_DATASET.id,
    metadata: CAMPUS_SPATIAL_DATASET,
    features,
  }
}
