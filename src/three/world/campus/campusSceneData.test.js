import { describe, expect, it } from 'vitest'
import { createCampusSceneRenderData } from './campusSceneData.js'

describe('campus scene shared render adapter', () => {
  it('derives homepage and editor preview inputs from the same FeatureCollection', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'building-1', properties: { featureType: 'building', name: '教学楼', floors: 5 }, geometry: { type: 'Polygon', coordinates: [[[0,0],[10,0],[10,8],[0,8],[0,0]]] } },
        { type: 'Feature', id: 'road-1', properties: { featureType: 'road', name: '主路', width: 8 }, geometry: { type: 'LineString', coordinates: [[0,0],[10,10]] } },
        { type: 'Feature', id: 'water-1', properties: { featureType: 'water', name: '湖泊' }, geometry: { type: 'Polygon', coordinates: [[[20,20],[30,20],[30,30],[20,30],[20,20]]] } },
        { type: 'Feature', id: 'tree-1', properties: { featureType: 'object', objectType: 'tree', name: '树木', rotation: 30, scale: 1.5 }, geometry: { type: 'Point', coordinates: [5,6] } },
      ],
    }
    const result = createCampusSceneRenderData(collection)
    expect(result.featureCollection).toBe(collection)
    expect(result.layers.buildings[0].id).toBe('building-1')
    expect(result.previewDocument.buildings[0].footprint).toEqual(result.layers.buildings[0].polygon)
    expect(result.previewDocument.roads[0].points).toEqual(result.layers.roads[0].points)
    expect(result.previewDocument.areas[0].polygon).toEqual(result.layers.areas[0].polygon)
    expect(result.previewDocument.objects[0].geometry.coordinates).toEqual(result.layers.objects[0].position)
    expect(result.previewDocument.objects[0].properties.rotation).toBe(30)
  })
})
