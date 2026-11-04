import { describe, expect, it } from 'vitest'
import { CAMPUS_AREAS, CAMPUS_BUILDING_FOOTPRINTS, CAMPUS_ROAD_CENTERLINES } from './campusLayout.js'
import { buildCampusGeoJSON, getCampusSpatialLayers, validateCampusGeoJSON, CAMPUS_SPATIAL_DATASET } from './campusGeoJSON.js'
import { CAMPUS_GATES, CAMPUS_POIS, CAMPUS_SITE_AREAS, CAMPUS_BUILDING_METADATA, buildCampusRoadGraph } from './campusInventory.js'
import { toCampusFeatureCollection } from '../../editor/campusFeatureCollection.js'

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
      CAMPUS_AREAS.length + CAMPUS_ROAD_CENTERLINES.length + CAMPUS_BUILDING_FOOTPRINTS.length + 1 + CAMPUS_GATES.length,
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
    expect(layers.boundary).toBeTruthy()
    expect(layers.gates).toHaveLength(CAMPUS_GATES.length)
    expect(layers.areas).toHaveLength(CAMPUS_AREAS.length)
    expect(layers.roads).toHaveLength(CAMPUS_ROAD_CENTERLINES.length)
    expect(layers.buildings).toHaveLength(CAMPUS_BUILDING_FOOTPRINTS.length)
    expect(layers.roads[0].points).toEqual(collection.features.find(feature => feature.id === layers.roads[0].id).geometry.coordinates)
    expect(layers.buildings[0].polygon[0]).toEqual(collection.features.find(feature => feature.id === layers.buildings[0].id).geometry.coordinates[0][0])
  })



  it('将编辑器保存的 FeatureCollection 直接归一化为校园渲染图层', () => {
    const edited = toCampusFeatureCollection({
      buildings: [{ id: 'edit-building', label: '新教学楼', footprint: [[10, 10], [30, 10], [30, 25]], floors: 6, confidence: 'medium' }],
      roads: [{ id: 'edit-road', name: '新支路', points: [[0, 20], [20, 30]], width: 9, confidence: 'high' }],
      areas: [{ id: 'edit-water', name: '景观水池', type: 'water', footprint: [[40, 40], [60, 40], [60, 60]], confidence: 'medium' }],
      objects: [{ id: 'edit-tree', type: 'tree', name: '香樟树', geometry: { type: 'Point', coordinates: [70, 80] }, properties: { rotation: 45, scale: 1.4 } }],
    })
    const layers = getCampusSpatialLayers(edited)
    expect(layers.buildings[0]).toMatchObject({ id: 'edit-building', label: '新教学楼', floors: 6 })
    expect(layers.roads[0]).toMatchObject({ id: 'edit-road', name: '新支路', width: 9 })
    expect(layers.areas[0]).toMatchObject({ id: 'edit-water', name: '景观水池', type: 'water' })
    expect(layers.objects[0]).toMatchObject({ id: 'edit-tree', type: 'tree', position: [70, 80], rotation: 45, scale: 1.4 })
  })


  it('统一数据通过坐标、拓扑、来源和属性质检', () => {
    const report = validateCampusGeoJSON()
    expect(report.valid).toBe(true)
    expect(report.errorCount).toBe(0)
    expect(report.featureCount).toBe(CAMPUS_AREAS.length + CAMPUS_ROAD_CENTERLINES.length + CAMPUS_BUILDING_FOOTPRINTS.length + 1 + CAMPUS_GATES.length)
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


  it('质检能识别自交面和要素类型不匹配', () => {
    const invalid = structuredClone(buildCampusGeoJSON())
    const polygon = invalid.features.find(feature => feature.geometry.type === 'Polygon')
    polygon.geometry.coordinates = [[[100, 100], [120, 120], [100, 120], [120, 100], [100, 100]]]
    const road = invalid.features.find(feature => feature.properties.featureType === 'road')
    road.geometry.type = 'Polygon'
    road.geometry.coordinates = [[[200, 200], [220, 200], [220, 220], [200, 220], [200, 200]]]
    const report = validateCampusGeoJSON(invalid)
    expect(report.errors.map(error => error.code)).toContain('SELF_INTERSECTING_POLYGON_RING')
    expect(report.errors.map(error => error.code)).toContain('GEOMETRY_TYPE_MISMATCH')
  })


  it('输出校园边界与东门、南门 Point 要素，并保留低置信度标记', () => {
    const collection = buildCampusGeoJSON()
    const boundary = collection.features.find(feature => feature.properties.featureType === 'boundary')
    expect(boundary.geometry.type).toBe('Polygon')
    expect(boundary.properties.boundaryStatus).toBe('reference-outline-not-surveyed')
    for (const gate of CAMPUS_GATES) {
      const feature = collection.features.find(item => item.id === gate.id)
      expect(feature.geometry.type).toBe('Point')
      expect(feature.properties.verificationStatus).toBe('unverified')
    }
  })

  it('绿地和广场进入场地台账，未完成定位的记录保持待核验', () => {
    expect(CAMPUS_SITE_AREAS.map(area => area.category)).toContain('green-space')
    expect(CAMPUS_SITE_AREAS.map(area => area.category)).toContain('plaza')
    expect(CAMPUS_SITE_AREAS.every(area => area.geometry === null)).toBe(true)
  })

  it('POI 名称可追溯，未定位对象不得伪造坐标或建筑关联', () => {
    expect(CAMPUS_POIS.length).toBeGreaterThanOrEqual(8)
    expect(CAMPUS_POIS.every(poi => poi.nameStatus === 'source-confirmed')).toBe(true)
    expect(CAMPUS_POIS.every(poi => poi.position === null && poi.buildingId === null && poi.locationStatus === 'pending')).toBe(true)
  })

  it('现有建筑 footprint 全部具备待核验元数据，不伪造正式楼栋名称', () => {
    expect(Object.keys(CAMPUS_BUILDING_METADATA)).toHaveLength(CAMPUS_BUILDING_FOOTPRINTS.length)
    for (const metadata of Object.values(CAMPUS_BUILDING_METADATA)) {
      expect(metadata.canonicalName).toBeNull()
      expect(metadata.buildingNumber).toBeNull()
      expect(metadata.identityStatus).toBe('pending')
      expect(metadata.footprintStatus).toBe('approximate')
    }
  })

  it('道路中心线可以派生连通图，边记录来源道路与长度', () => {
    const graph = buildCampusRoadGraph()
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.edges.length).toBeGreaterThan(0)
    expect(graph.edges.every(edge => edge.length > 0 && edge.roadId && edge.from && edge.to)).toBe(true)
    expect(graph.status).toBe('approximate-needs-field-verification')
    expect(graph.gateLinks.map(link => link.gateId).sort()).toEqual(CAMPUS_GATES.map(gate => gate.id).sort())
  })

  it('道路输出为 LineString，建筑 footprint 输出为 Polygon', () => {
    const features = buildCampusGeoJSON().features
    expect(features.find(feature => feature.id === CAMPUS_ROAD_CENTERLINES[0].id).geometry.type).toBe('LineString')
    expect(features.find(feature => feature.id === CAMPUS_BUILDING_FOOTPRINTS[0].id).geometry.type).toBe('Polygon')
  })
})
