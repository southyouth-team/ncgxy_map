import { describe, expect, it } from 'vitest'
import { buildCampusGeoJSON } from '../../../data/campus/campusGeoJSON.js'
import { createCampusSceneRenderData, validateCampusSceneRenderData } from './campusSceneData.js'

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
