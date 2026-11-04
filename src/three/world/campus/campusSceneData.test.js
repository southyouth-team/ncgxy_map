import { describe, expect, it } from 'vitest'
import { buildCampusGeoJSON } from '../../../data/campus/campusGeoJSON.js'
import { createCampusSceneRenderData, validateCampusSceneRenderData, auditCampusSceneFeatureCoverage, validateCampusBuildingModels, auditCampusBuildingModelGeometry } from './campusSceneData.js'

describe('campus scene shared render adapter', () => {
  it('derives homepage and editor preview inputs from the same FeatureCollection', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'building-1', properties: { featureType: 'building', name: '教学楼', floors: 5, roofStyle: 'hip', roofRise: 2.4, entranceEdgeIndex: 1, windowDensity: 0.7, doorWidth: 1.8, source: 'survey-draft' }, geometry: { type: 'Polygon', coordinates: [[[0,0],[10,0],[10,8],[0,8],[0,0]]] } },
        { type: 'Feature', id: 'road-1', properties: { featureType: 'road', name: '主路', width: 8, laneCount: 2, surfaceMaterial: 'asphalt' }, geometry: { type: 'LineString', coordinates: [[0,0],[10,10]] } },
        { type: 'Feature', id: 'water-1', properties: { featureType: 'water', name: '湖泊', waterDepth: 'unknown', source: 'campus-plan-reference' }, geometry: { type: 'Polygon', coordinates: [[[20,20],[30,20],[30,30],[20,30],[20,20]]] } },
        { type: 'Feature', id: 'tree-1', properties: { featureType: 'object', objectType: 'tree', name: '树木', rotation: 30, scale: 1.5 }, geometry: { type: 'Point', coordinates: [5,6] } },
      ],
    }
    const result = createCampusSceneRenderData(collection)
    expect(result.featureCollection).toBe(collection)
    expect(result.layers.buildings[0].id).toBe('building-1')
    expect(result.previewDocument.buildings[0].footprint).toEqual(result.layers.buildings[0].polygon)
    expect(result.previewDocument.buildings[0].roofStyle).toBe('hip')
    expect(result.previewDocument.buildings[0].entranceEdgeIndex).toBe(1)
    expect(result.previewDocument.buildings[0].windowDensity).toBe(0.7)
    expect(result.previewDocument.buildings[0].doorWidth).toBe(1.8)
    expect(result.previewDocument.buildings[0].source).toBe('survey-draft')
    expect(result.previewDocument.roads[0].points).toEqual(result.layers.roads[0].points)
    expect(result.previewDocument.roads[0].laneCount).toBe(2)
    expect(result.previewDocument.roads[0].surfaceMaterial).toBe('asphalt')
    expect(result.previewDocument.areas[0].polygon).toEqual(result.layers.areas[0].polygon)
    expect(result.previewDocument.areas[0].waterDepth).toBe('unknown')
    expect(result.previewDocument.areas[0].source).toBe('campus-plan-reference')
    expect(result.previewDocument.objects[0].geometry.coordinates).toEqual(result.layers.objects[0].position)
    expect(result.previewDocument.objects[0].properties.rotation).toBe(30)
  })

  it('passes the automated source -> layer -> preview consistency audit for the full campus dataset', () => {
    const collection = buildCampusGeoJSON()
    const result = createCampusSceneRenderData(collection)
    const report = validateCampusSceneRenderData(collection, result)

    expect(report.valid).toBe(true)
    expect(report.errorCount).toBe(0)
    expect(report.summary.checkedCount).toBeGreaterThan(0)
    expect(report.summary.buildings).toBe(collection.features.filter(feature => feature.properties.featureType === 'building').length)
    expect(report.summary.roads).toBe(collection.features.filter(feature => feature.properties.featureType === 'road').length)
  })

  it('detects missing features, geometry drift and walkability divergence in a render projection', () => {
    const collection = buildCampusGeoJSON()
    const result = createCampusSceneRenderData(collection)
    const corrupted = structuredClone(result)
    corrupted.layers.objects.pop()
    corrupted.previewDocument.buildings[0].footprint[0][0] += 1
    corrupted.previewDocument.roads[0].walkable = !corrupted.previewDocument.roads[0].walkable

    const report = validateCampusSceneRenderData(collection, corrupted)
    expect(report.valid).toBe(false)
    expect(report.errors.map(error => error.code)).toContain('MISSING_FEATURE')
    expect(report.errors.map(error => error.code)).toContain('PREVIEW_GEOMETRY_MISMATCH')
    expect(report.errors.map(error => error.code)).toContain('WALKABILITY_MISMATCH')
  })
})


describe('campus Three.js scene coverage audit', () => {
  it('confirms every normalized feature has a renderable scene node', () => {
    const layers = {
      buildings: [{ id: 'b1' }],
      roads: [{ id: 'r1' }],
      areas: [{ id: 'a1' }],
      objects: [{ id: 'o1' }],
    }
    const nodes = [
      { userData: { featureId: 'b1', featureCategory: 'buildings' }, isMesh: true, geometry: {}, material: {} },
      { userData: { featureId: 'r1', featureCategory: 'roads' }, isMesh: true, geometry: {}, material: {} },
      { userData: { featureId: 'a1', featureCategory: 'areas' }, isMesh: true, geometry: {}, material: {} },
      { userData: { featureId: 'o1', featureCategory: 'objects' }, isMesh: true, geometry: {}, material: {} },
    ]
    const scene = { traverse(callback) { nodes.forEach(callback) } }
    const report = auditCampusSceneFeatureCoverage(layers, scene)
    expect(report.valid).toBe(true)
    expect(report.errorCount).toBe(0)
    expect(report.summary.buildings).toEqual({ expected: 1, rendered: 1 })
  })

  it('detects missing, non-renderable and unexpected scene features', () => {
    const layers = {
      buildings: [{ id: 'b1' }, { id: 'b2' }],
      roads: [],
      areas: [],
      objects: [],
    }
    const nodes = [
      { userData: { featureId: 'b1', featureCategory: 'buildings' } },
      { userData: { featureId: 'extra', featureCategory: 'buildings' }, isMesh: true, geometry: {}, material: {} },
    ]
    const scene = { traverse(callback) { nodes.forEach(callback) } }
    const report = auditCampusSceneFeatureCoverage(layers, scene)
    expect(report.valid).toBe(false)
    expect(report.errors.map(error => error.code)).toContain('SCENE_FEATURE_NOT_RENDERABLE')
    expect(report.errors.map(error => error.code)).toContain('SCENE_FEATURE_MISSING')
    expect(report.errors.map(error => error.code)).toContain('SCENE_FEATURE_UNEXPECTED')
  })

  it('detects meshes without geometry or material', () => {
    const layers = { buildings: [], roads: [], areas: [], objects: [{ id: 'o1' }] }
    const scene = {
      traverse(callback) {
        callback({ userData: { featureId: 'o1', featureCategory: 'objects' }, isMesh: true, geometry: null, material: null })
      },
    }
    const report = auditCampusSceneFeatureCoverage(layers, scene)
    expect(report.errors.map(error => error.code)).toContain('SCENE_FEATURE_MATERIAL_MISSING')
  })
})


describe('campus GLB building asset audit', () => {
  function createModel(buildingId) {
    const mesh = {
      isMesh: true,
      geometry: {
        boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 12, z: 6 } },
        attributes: { position: { count: 36 } },
      },
      material: {},
    }
    return {
      name: buildingId,
      userData: { buildingId },
      traverse(callback) { callback(this); callback(mesh) },
    }
  }

  it('accepts GLB models with known IDs, geometry and material', () => {
    const report = validateCampusBuildingModels([createModel('building-1')], ['building-1'])
    expect(report.valid).toBe(true)
    expect(report.summary.modelCount).toBe(1)
    expect(report.summary.meshCount).toBe(1)
    expect(report.summary.triangleCount).toBe(12)
  })

  it('detects unknown and duplicate building models', () => {
    const report = validateCampusBuildingModels(
      [createModel('unknown'), createModel('unknown')],
      ['building-1'],
    )
    expect(report.errors.map(error => error.code)).toContain('GLB_BUILDING_ID_UNKNOWN')
    expect(report.errors.map(error => error.code)).toContain('GLB_BUILDING_ID_DUPLICATE')
  })

  it('detects empty models and missing mesh resources', () => {
    const empty = { name: 'empty', userData: { buildingId: 'empty' }, traverse(callback) { callback(this) } }
    const broken = {
      name: 'broken',
      userData: { buildingId: 'broken' },
      traverse(callback) {
        callback(this)
        callback({ isMesh: true, geometry: null, material: null })
      },
    }
    const report = validateCampusBuildingModels([empty, broken], ['empty', 'broken'])
    expect(report.errors.map(error => error.code)).toContain('GLB_MESH_MISSING')
    expect(report.errors.map(error => error.code)).toContain('GLB_MESH_RESOURCE_MISSING')
    expect(report.errors.map(error => error.code)).toContain('GLB_BOUNDS_INVALID')
  })
})


describe('campus GLB building geometry audit', () => {
  const toWorld = (x, y) => ({ x, z: -y })
  const building = { id: 'b1', polygon: [[0,0],[10,0],[10,8],[0,8]], height: 12 }
  function record(overrides = {}) {
    return {
      buildingId: 'b1',
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 12, minZ: -8, maxZ: 0 },
      transform: { x: 5, y: 0, z: -4, rotationY: 0 },
      ...overrides,
    }
  }
  it('accepts a model aligned with the canonical footprint and height', () => {
    const report = auditCampusBuildingModelGeometry([building], [record()], toWorld)
    expect(report.valid).toBe(true)
    expect(report.summary.checkedCount).toBe(1)
    expect(report.results[0].status).toBe('checked')
    expect(report.results[0].heightStatus).toBe('matched')
  })
  it('detects world-position drift and footprint size mismatch', () => {
    const moved = record({ bounds: { minX: 8, maxX: 18, minY: 0, maxY: 12, minZ: -8, maxZ: 0 } })
    const report = auditCampusBuildingModelGeometry([building], [moved], toWorld)
    expect(report.errors.map(error => error.code)).toContain('GLB_FOOTPRINT_CENTER_OFFSET')
    expect(report.errors.map(error => error.code)).toContain('GLB_FOOTPRINT_WIDTH_MISMATCH')
  })
  it('detects height drift only when canonical source height exists', () => {
    const tall = record({ bounds: { minX: 0, maxX: 10, minY: 0, maxY: 30, minZ: -8, maxZ: 0 } })
    const report = auditCampusBuildingModelGeometry([building], [tall], toWorld)
    expect(report.errors.map(error => error.code)).toContain('GLB_BUILDING_HEIGHT_MISMATCH')
    const withoutHeight = auditCampusBuildingModelGeometry([{ ...building, height: undefined }], [tall], toWorld)
    expect(withoutHeight.results[0].heightStatus).toBe('not_comparable')
    expect(withoutHeight.errors.map(error => error.code)).not.toContain('GLB_BUILDING_HEIGHT_MISMATCH')
  })
  it('marks missing models as not_loaded rather than as errors', () => {
    const report = auditCampusBuildingModelGeometry([building], [], toWorld)
    expect(report.valid).toBe(true)
    expect(report.summary.notLoadedCount).toBe(1)
    expect(report.results[0].status).toBe('not_loaded')
  })
  it('reports model IDs without a canonical footprint', () => {
    const report = auditCampusBuildingModelGeometry([], [record()], toWorld)
    expect(report.errors.map(error => error.code)).toContain('GLB_GEOMETRY_UNKNOWN_BUILDING')
  })
})
