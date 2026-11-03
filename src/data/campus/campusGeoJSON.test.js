import { describe, expect, it } from 'vitest'
import { CAMPUS_AREAS, CAMPUS_BUILDING_FOOTPRINTS, CAMPUS_ROAD_CENTERLINES } from './campusLayout.js'
import { buildCampusGeoJSON, getCampusSpatialLayers, validateCampusGeoJSON, CAMPUS_SPATIAL_DATASET } from './campusGeoJSON.js'

describe('统一校园空间数据出口', () => {
  it('明确使用同一套参考图像像素坐标，不伪装成测绘坐标', () => {
    expect(CAMPUS_SPATIAL_DATASET.coordinateSystem).toBe('NCGXY_REFERENCE_IMAGE_PIXEL')
    expect(CAMPUS_SPATIAL_DATASET.coordinateUnit).toBe('pixel')
    expect(CAMPUS_SPATIAL_DATASET.accuracyNote).toContain('非测绘成果')
  })

  it('将现有区域、道路和建筑输出为唯一 FeatureCollection', () => {
    const collection = buildCampusGeoJSON()
    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(
      CAMPUS_AREAS.length + CAMPUS_ROAD_CENTERLINES.length + CAMPUS_BUILDING_FOOTPRINTS.length,
    )
    const ids = collection.features.map(feature => feature.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(collection.features.filter(feature => feature.properties.featureType === 'building')).toHaveLength(CAMPUS_BUILDING_FOOTPRINTS.length)
    expect(collection.features.filter(feature => feature.properties.featureType === 'road')).toHaveLength(CAMPUS_ROAD_CENTERLINES.length)
  })

  it('所有面几何闭合，中央湖区洞区作为内环保留', () => {
    const collection = buildCampusGeoJSON()
    for (const feature of collection.features.filter(item => item.geometry.type === 'Polygon')) {
      for (const ring of feature.geometry.coordinates) {
        expect(ring.length).toBeGreaterThanOrEqual(4)
        expect(ring[0]).toEqual(ring[ring.length - 1])
      }
    }
    const lake = collection.features.find(feature => feature.id === 'central-lake')
    expect(lake.geometry.coordinates).toHaveLength(2)
  })

  it('所有要素均携带来源、置信度和核验状态', () => {
    for (const feature of buildCampusGeoJSON().features) {
      expect(feature.properties.source).toBeTruthy()
      expect(['low', 'medium', 'high']).toContain(feature.properties.confidence)
      expect(['verified', 'unverified']).toContain(feature.properties.verificationStatus)
    }
  })

  it('2D 与 2.5D 共用同一份派生图层，不再维护独立几何副本', () => {
    const collection = buildCampusGeoJSON()
    const layers = getCampusSpatialLayers(collection)
    expect(layers.areas).toHaveLength(CAMPUS_AREAS.length)
    expect(layers.roads).toHaveLength(CAMPUS_ROAD_CENTERLINES.length)
    expect(layers.buildings).toHaveLength(CAMPUS_BUILDING_FOOTPRINTS.length)
    expect(layers.roads[0].points).toEqual(collection.features.find(feature => feature.id === layers.roads[0].id).geometry.coordinates)
    expect(layers.buildings[0].polygon[0]).toEqual(collection.features.find(feature => feature.id === layers.buildings[0].id).geometry.coordinates[0][0])
  })


  it('统一数据通过坐标、拓扑、来源和属性质检', () => {
    const report = validateCampusGeoJSON()
    expect(report.valid).toBe(true)
    expect(report.errorCount).toBe(0)
    expect(report.featureCount).toBe(CAMPUS_AREAS.length + CAMPUS_ROAD_CENTERLINES.length + CAMPUS_BUILDING_FOOTPRINTS.length)
  })

  it('质检能识别越界坐标、重复 ID 和无效道路宽度', () => {
    const collection = buildCampusGeoJSON()
    const invalid = structuredClone(collection)
    invalid.features[0].geometry.coordinates[0][0] = [-1, 900]
    invalid.features[1].id = invalid.features[0].id
    const road = invalid.features.find(feature => feature.properties.featureType === 'road')
    road.properties.width = 0
    const report = validateCampusGeoJSON(invalid)
    expect(report.valid).toBe(false)
    expect(report.errors.map(error => error.code)).toContain('COORDINATE_OUT_OF_BOUNDS')
    expect(report.errors.map(error => error.code)).toContain('DUPLICATE_FEATURE_ID')
    expect(report.errors.map(error => error.code)).toContain('INVALID_ROAD_WIDTH')
  })

  it('道路输出为 LineString，建筑 footprint 输出为 Polygon', () => {
    const features = buildCampusGeoJSON().features
    expect(features.find(feature => feature.id === CAMPUS_ROAD_CENTERLINES[0].id).geometry.type).toBe('LineString')
    expect(features.find(feature => feature.id === CAMPUS_BUILDING_FOOTPRINTS[0].id).geometry.type).toBe('Polygon')
  })
})
