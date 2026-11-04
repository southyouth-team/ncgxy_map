import { describe, expect, it } from 'vitest'
import { toCampusFeatureCollection, fromCampusFeatureCollection, createCampusFeatureSnapshot, restoreCampusFeatureSnapshot, upsertCampusFeature, updateCampusFeatureProperties, updateCampusFeatureGeometry, removeCampusFeatures } from './campusFeatureCollection.js'

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
      properties: { featureType: 'object', objectType: 'tree', rotation: 30, scale: 1.2 },
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
    expect(result.features[0].properties.qualityStatus).toBe('unverified')
    expect(result.features[0].properties.confidence).toBe('medium')
    expect(result.features[0].properties.verificationStatus).toBe('unverified')
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


  it('keeps confidence and verification status independent in both adapter directions', () => {
    const source = {
      buildings: [{
        id: 'quality-building',
        label: '待核验教学楼',
        footprint: [[10, 10], [30, 10], [30, 25]],
        confidence: 'high',
        qualityStatus: 'unverified',
        verificationStatus: 'unverified',
      }],
      roads: [{
        id: 'quality-road',
        name: '已核验道路',
        points: [[0, 20], [20, 30]],
        width: 8,
        confidence: 'medium',
        qualityStatus: 'verified',
        verificationStatus: 'verified',
      }],
      areas: [{
        id: 'quality-water',
        name: '待核验水域',
        type: 'water',
        footprint: [[40, 40], [60, 40], [60, 60]],
        confidence: 'low',
        qualityStatus: 'unverified',
        verificationStatus: 'unverified',
      }],
    }

    const collection = toCampusFeatureCollection(source)
    expect(collection.features.map(feature => feature.properties)).toEqual(expect.arrayContaining([
      expect.objectContaining({ featureType: 'building', confidence: 'high', qualityStatus: 'unverified', verificationStatus: 'unverified' }),
      expect.objectContaining({ featureType: 'road', confidence: 'medium', qualityStatus: 'verified', verificationStatus: 'verified' }),
      expect.objectContaining({ featureType: 'water', confidence: 'low', qualityStatus: 'unverified', verificationStatus: 'unverified' }),
    ]))

    const restored = fromCampusFeatureCollection(collection)
    expect(restored.buildings[0]).toMatchObject({ confidence: 'high', qualityStatus: 'unverified', verificationStatus: 'unverified' })
    expect(restored.roads[0]).toMatchObject({ confidence: 'medium', qualityStatus: 'verified', verificationStatus: 'verified' })
    expect(restored.areas[0]).toMatchObject({ confidence: 'low', qualityStatus: 'unverified', verificationStatus: 'unverified' })
  })

  it('preserves deleted base-feature IDs through FeatureCollection adapters', () => {
    const source = { buildings: [], roads: [], areas: [], objects: [], deletedFeatureIds: ['campus-tree-001', 'campus-bench-002'] }
    const collection = toCampusFeatureCollection(source)
    expect(collection.deletedFeatureIds).toEqual(['campus-tree-001', 'campus-bench-002'])
    expect(fromCampusFeatureCollection(collection).deletedFeatureIds).toEqual(source.deletedFeatureIds)
  })
  it('restores point-object confidence without treating it as qualityStatus', () => {
    const collection = toCampusFeatureCollection({
      objects: [{
        id: 'quality-tree',
        type: 'tree',
        name: '待核验树木',
        geometry: { type: 'Point', coordinates: [12, 18] },
        properties: {
          confidence: 'low',
          verificationStatus: 'unverified',
          rotation: 25,
          scale: 1.2,
        },
        source: 'legacy-scene-decoration',
        qualityStatus: 'unverified',
      }],
    })
    const restored = fromCampusFeatureCollection(collection)
    expect(restored.objects[0]).toMatchObject({
      id: 'quality-tree',
      type: 'tree',
      qualityStatus: 'unverified',
      properties: {
        confidence: 'low',
        verificationStatus: 'unverified',
        rotation: 25,
        scale: 1.2,
      },
    })
  })



  it('stores undo/redo history as one canonical FeatureCollection snapshot', () => {
    const document = {
      buildings: [{ id: 'history-building', label: '教学楼', footprint: [[0, 0], [20, 0], [20, 20], [0, 20]], floors: 4, confidence: 'high' }],
      roads: [{ id: 'history-road', points: [[0, 0], [30, 30]], width: 9, confidence: 'medium' }],
      areas: [{ id: 'history-water', name: '水域', type: 'water', footprint: [[40, 40], [60, 40], [60, 60]], confidence: 'low' }],
      objects: [{ id: 'history-tree', type: 'tree', name: '树木', geometry: { type: 'Point', coordinates: [70, 80] }, properties: { rotation: 15, scale: 1.2 }, qualityStatus: 'unverified' }],
      deletedFeatureIds: ['legacy-gate-01'],
    }
    const snapshot = createCampusFeatureSnapshot(document)
    expect(snapshot.type).toBe('CampusFeatureSnapshot')
    expect(snapshot.version).toBe(1)
    expect(snapshot.featureCollection.features).toHaveLength(4)
    expect(snapshot.featureCollection.deletedFeatureIds).toEqual(['legacy-gate-01'])

    const restored = restoreCampusFeatureSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(restored.buildings[0]).toMatchObject({ id: 'history-building', floors: 4, confidence: 'high' })
    expect(restored.roads[0]).toMatchObject({ id: 'history-road', width: 9, confidence: 'medium' })
    expect(restored.areas[0]).toMatchObject({ id: 'history-water', type: 'water', confidence: 'low' })
    expect(restored.objects[0]).toMatchObject({ id: 'history-tree', properties: { rotation: 15, scale: 1.2 } })
    expect(restored.deletedFeatureIds).toEqual(['legacy-gate-01'])
  })

  it('rejects unsupported canonical history snapshot versions', () => {
    expect(() => restoreCampusFeatureSnapshot({ type: 'CampusFeatureSnapshot', version: 99 })).toThrow('不支持的校园空间历史快照版本')
  })


  it('mutates canonical features immutably by stable ID', () => {
    const original = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'building-1', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }, properties: { featureType: 'building', name: '旧名称', floors: 2 } }],
      deletedFeatureIds: ['tree-1'],
    }
    const renamed = updateCampusFeatureProperties(original, 'building-1', { name: '新名称', floors: 3 })
    expect(renamed.features[0].properties).toMatchObject({ name: '新名称', floors: 3 })
    expect(original.features[0].properties).toMatchObject({ name: '旧名称', floors: 2 })
    const moved = updateCampusFeatureGeometry(renamed, 'building-1', { type: 'Polygon', coordinates: [[[1, 1], [11, 1], [11, 11], [1, 1]]] })
    expect(moved.features[0].geometry.coordinates[0][0]).toEqual([1, 1])
    expect(moved.features[0].properties.name).toBe('新名称')

    const added = upsertCampusFeature(moved, { type: 'Feature', id: 'tree-1', geometry: { type: 'Point', coordinates: [5, 5] }, properties: { featureType: 'object' } })
    expect(added.features).toHaveLength(2)
    expect(added.deletedFeatureIds).toEqual([])
    const removed = removeCampusFeatures(added, ['building-1', 'tree-1'], { recordDeleted: true })
    expect(removed.features).toHaveLength(0)
    expect(removed.deletedFeatureIds).toEqual(['building-1', 'tree-1'])
    expect(original.features).toHaveLength(1)
    expect(original.deletedFeatureIds).toEqual(['tree-1'])
  })

  it('rejects missing IDs and updates to unknown features', () => {
    const collection = { type: 'FeatureCollection', features: [], deletedFeatureIds: [] }
    expect(() => upsertCampusFeature(collection, { geometry: { type: 'Point', coordinates: [0, 0] } })).toThrow('Feature 必须包含稳定 ID 和 geometry')
    expect(() => updateCampusFeatureProperties(collection, 'missing', { name: 'x' })).toThrow('找不到空间要素：missing')
    expect(() => updateCampusFeatureGeometry(collection, 'missing', { type: 'Point', coordinates: [0, 0] })).toThrow('找不到空间要素：missing')
  })

})
