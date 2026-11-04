import { describe, expect, it } from 'vitest'
import { toCampusFeatureCollection } from './campusFeatureCollection.js'

describe('toCampusFeatureCollection', () => {
  it('normalizes buildings, roads, areas and point objects into one feature collection', () => {
    const result = toCampusFeatureCollection({
      buildings: [{ id: 'b1', label: '教学楼', footprint: [[0, 0], [20, 0], [20, 10]], floors: 5 }],
      roads: [{ id: 'r1', points: [[0, 5], [20, 5]], width: 8 }],
      areas: [{ id: 'a1', name: '湖泊', type: 'water', footprint: [[2, 2], [8, 2], [8, 8]] }],
      objects: [{ id: 'o1', type: 'tree', name: '香樟', geometry: { type: 'Point', coordinates: [4, 6] }, properties: { rotation: 30, scale: 1.2 } }],
    })

    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(4)
    expect(result.features.map(feature => feature.id)).toEqual(['b1', 'r1', 'a1', 'o1'])
    expect(result.features[0].geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [20, 0], [20, 10], [0, 0]]],
    })
    expect(result.features[1]).toMatchObject({
      geometry: { type: 'LineString', coordinates: [[0, 5], [20, 5]] },
      properties: { featureType: 'road', width: 8 },
    })
    expect(result.features[2].properties.featureType).toBe('water')
    expect(result.features[3]).toMatchObject({
      geometry: { type: 'Point', coordinates: [4, 6] },
      properties: { featureType: 'tree', objectType: 'tree', rotation: 30, scale: 1.2 },
    })
  })

  it('closes polygon rings and preserves holes and quality metadata', () => {
    const result = toCampusFeatureCollection({
      areas: [{
        id: 'pond', name: '水池', type: 'water',
        footprint: [[0, 0], [10, 0], [10, 10], [0, 10]],
        holes: [[[2, 2], [4, 2], [4, 4]]],
        confidence: 'medium',
      }],
    })
    expect(result.features[0].geometry.coordinates).toEqual([
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[2, 2], [4, 2], [4, 4], [2, 2]],
    ])
    expect(result.features[0].properties.qualityStatus).toBe('medium')
  })

  it('skips malformed legacy records instead of emitting invalid GeoJSON', () => {
    const result = toCampusFeatureCollection({
      buildings: [{ id: 'invalid', footprint: [[0, 0], [1, 1]] }],
      roads: [{ id: 'invalid-road', points: [[0, 0]], width: 5 }],
      objects: [{ id: 'invalid-object', geometry: { type: 'Polygon', coordinates: [] } }],
    })
    expect(result.features).toEqual([])
  })
  it('round-trips supported feature types through the legacy editor adapter', async () => {
    const { fromCampusFeatureCollection } = await import('./campusFeatureCollection.js')
    const source = {
      buildings: [{ id: 'b', label: '教学楼', footprint: [[0, 0], [10, 0], [10, 8]], floors: 4 }],
      roads: [{ id: 'r', points: [[0, 0], [10, 10]], width: 6 }],
      areas: [{ id: 'a', name: '草坪', type: 'vegetation', footprint: [[0, 0], [5, 0], [5, 5]] }],
      objects: [{ id: 't', type: 'tree', name: '树木', geometry: { type: 'Point', coordinates: [3, 4] }, properties: { scale: 1.5 } }],
    }
    const restored = fromCampusFeatureCollection(toCampusFeatureCollection(source))
    expect(restored.buildings[0]).toMatchObject({ id: 'b', label: '教学楼', floors: 4 })
    expect(restored.roads[0]).toMatchObject({ id: 'r', width: 6, points: [[0, 0], [10, 10]] })
    expect(restored.areas[0]).toMatchObject({ id: 'a', name: '草坪', type: 'vegetation', polygon: [[0, 0], [5, 0], [5, 5]] })
    expect(restored.objects[0]).toMatchObject({ id: 't', type: 'tree', properties: { scale: 1.5 } })
  })

  it('preserves deleted base-feature IDs through FeatureCollection adapters', () => {
    const source = { buildings: [], roads: [], areas: [], objects: [], deletedFeatureIds: ['campus-tree-001', 'campus-bench-002'] }
    const collection = toCampusFeatureCollection(source)
    expect(collection.deletedFeatureIds).toEqual(['campus-tree-001', 'campus-bench-002'])
    expect(fromCampusFeatureCollection(collection).deletedFeatureIds).toEqual(source.deletedFeatureIds)
  })

})
