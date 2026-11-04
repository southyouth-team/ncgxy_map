import { describe, expect, it } from 'vitest'
import { toCampusFeatureCollection, fromCampusFeatureCollection, createCampusFeatureSnapshot, restoreCampusFeatureSnapshot, upsertCampusFeature, updateCampusFeatureProperties, updateCampusFeatureGeometry, translateCampusFeatureGeometry, mergeCampusFeatureCollections, removeCampusFeatures } from './campusFeatureCollection.js'

describe('translateCampusFeatureGeometry', () => {
  it('translates every Polygon ring and preserves geometry metadata', () => {
    const geometry = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 0]],
        [[2, 2], [4, 2], [4, 4], [2, 2]],
      ],
    }
    expect(translateCampusFeatureGeometry(geometry, 5, -3)).toEqual({
      type: 'Polygon',
      coordinates: [
        [[5, -3], [15, -3], [15, 7], [5, -3]],
        [[7, -1], [9, -1], [9, 1], [7, -1]],
      ],
    })
    expect(geometry.coordinates[1][0]).toEqual([2, 2])
  })

  it('translates LineString, Point and MultiPolygon geometries', () => {
    expect(translateCampusFeatureGeometry({ type: 'LineString', coordinates: [[0, 1], [2, 3]] }, 2, 4).coordinates).toEqual([[2, 5], [4, 7]])
    expect(translateCampusFeatureGeometry({ type: 'Point', coordinates: [1, 2] }, -1, 3).coordinates).toEqual([0, 5])
    expect(translateCampusFeatureGeometry({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [0, 0]]]] }, 1, 1).coordinates).toEqual([[[[1, 1], [2, 1], [1, 1]]]])
  })

  it('rejects unsupported geometry and invalid offsets', () => {
    expect(() => translateCampusFeatureGeometry({ type: 'GeometryCollection', geometries: [] }, 1, 1)).toThrow('不支持平移几何类型')
    expect(() => translateCampusFeatureGeometry({ type: 'Point', coordinates: [0, 0] }, NaN, 1)).toThrow('几何平移参数无效')
  })
})

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


  it('round-trips inspector property patches through canonical features', () => {
    const source = {
      buildings: [{ id: 'inspector-building', label: '旧教学楼', template: '教学楼', footprint: [[0, 0], [10, 0], [10, 10]], floors: 2 }],
      roads: [],
      areas: [{ id: 'inspector-water', name: '旧水域', type: 'water', footprint: [[20, 20], [30, 20], [30, 30]] }],
      objects: [{ id: 'inspector-tree', type: 'tree', name: '旧树木', geometry: { type: 'Point', coordinates: [40, 40] }, properties: { rotation: 0, scale: 1 } }],
    }
    let collection = toCampusFeatureCollection(source)
    collection = updateCampusFeatureProperties(collection, 'inspector-building', { name: '新教学楼', floors: 5 })
    collection = updateCampusFeatureProperties(collection, 'inspector-water', { name: '新水域', areaType: 'water' })
    collection = updateCampusFeatureProperties(collection, 'inspector-tree', { name: '新树木', rotation: 90, scale: 1.5 })
    const restored = fromCampusFeatureCollection(collection)
    expect(restored.buildings[0]).toMatchObject({ label: '新教学楼', floors: 5 })
    expect(restored.areas[0]).toMatchObject({ name: '新水域', type: 'water' })
    expect(restored.objects[0]).toMatchObject({ name: '新树木', properties: { rotation: 90, scale: 1.5 } })
  })

  it('keeps geometry edits in the canonical collection across legacy editor projections', () => {
    const source = {
      buildings: [{ id: 'move-building', label: '教学楼', template: '教学楼', footprint: [[0, 0], [20, 0], [20, 20]], floors: 4, confidence: 'high', source: 'survey' }],
      roads: [{ id: 'move-road', name: '主干道', points: [[0, 30], [20, 30]], width: 8, confidence: 'medium', source: 'survey' }],
      areas: [{ id: 'move-water', name: '湖泊', type: 'water', footprint: [[30, 0], [50, 0], [50, 20]], holes: [[[35, 5], [40, 5], [40, 10]]], confidence: 'high', source: 'survey' }],
      objects: [{ id: 'move-tree', type: 'tree', name: '树木', geometry: { type: 'Point', coordinates: [60, 60] }, properties: { rotation: 25, scale: 1.4, confidence: 'medium' }, source: 'survey', qualityStatus: 'verified' }],
    }
    let canonical = toCampusFeatureCollection(source)
    canonical = updateCampusFeatureGeometry(canonical, 'move-building', { type: 'Polygon', coordinates: [[[2, 2], [22, 2], [22, 22], [2, 2]]] })
    canonical = updateCampusFeatureGeometry(canonical, 'move-road', { type: 'LineString', coordinates: [[1, 31], [21, 31]] })
    canonical = updateCampusFeatureGeometry(canonical, 'move-water', { type: 'Polygon', coordinates: [[[32, 2], [52, 2], [52, 22], [32, 2]], [[37, 7], [42, 7], [42, 12], [37, 7]]] })
    canonical = updateCampusFeatureGeometry(canonical, 'move-tree', { type: 'Point', coordinates: [62, 62] })

    const restored = fromCampusFeatureCollection(canonical)
    expect(restored.buildings[0]).toMatchObject({ id: 'move-building', floors: 4, confidence: 'high', source: 'survey' })
    expect(restored.roads[0]).toMatchObject({ id: 'move-road', width: 8, confidence: 'medium', source: 'survey' })
    expect(restored.areas[0]).toMatchObject({ id: 'move-water', type: 'water', confidence: 'high', source: 'survey' })
    expect(restored.areas[0].holes).toHaveLength(1)
    expect(restored.objects[0]).toMatchObject({ id: 'move-tree', geometry: { type: 'Point', coordinates: [62, 62] }, properties: { rotation: 25, scale: 1.4 }, qualityStatus: 'verified' })
    expect(canonical.features).toHaveLength(4)
  })

})

describe('mergeCampusFeatureCollections', () => {
  it('lets saved features override baseline IDs and tombstones remove baseline features', () => {
    const base = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'gate-east', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { featureType: 'gate', name: '东门' } },
        { type: 'Feature', id: 'road-main', geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] }, properties: { featureType: 'road', width: 8 } },
      ],
    }
    const edited = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'road-main', geometry: { type: 'LineString', coordinates: [[0, 1], [10, 1]] }, properties: { featureType: 'road', width: 12 } },
        { type: 'Feature', id: 'future-object', geometry: { type: 'Point', coordinates: [5, 5] }, properties: { featureType: 'future-facility', vendor: 'future-schema' } },
      ],
      deletedFeatureIds: ['gate-east'],
    }
    const merged = mergeCampusFeatureCollections(base, edited)
    expect(merged.features.map(feature => feature.id)).toEqual(['road-main', 'future-object'])
    expect(merged.features[0].geometry.coordinates).toEqual([[0, 1], [10, 1]])
    expect(merged.features[1].properties.vendor).toBe('future-schema')
    expect(merged.deletedFeatureIds).toEqual(['gate-east'])
    expect(base.features).toHaveLength(2)
  })

  it('rejects invalid FeatureCollections', () => {
    expect(() => mergeCampusFeatureCollections({}, { type: 'FeatureCollection', features: [] })).toThrow('基础校园 FeatureCollection 无效')
  })
})

describe('restoreCampusFeatureSnapshot', () => {
  it('preserves unknown features in the canonical collection while projecting supported editor features', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'known-tree', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { featureType: 'object', objectType: 'tree' } },
        { type: 'Feature', id: 'future-fixture', geometry: { type: 'Point', coordinates: [3, 4] }, properties: { featureType: 'future-fixture', vendorData: { keep: true } } },
      ],
      deletedFeatureIds: ['old-gate'],
    }
    const restored = restoreCampusFeatureSnapshot(createCampusFeatureSnapshot({ featureCollection: collection }))
    expect(restored.objects).toHaveLength(2)
    expect(restored.featureCollection.features).toHaveLength(2)
    expect(restored.featureCollection.features[1].properties.vendorData).toEqual({ keep: true })
    expect(restored.featureCollection.deletedFeatureIds).toEqual(['old-gate'])
  })
})

