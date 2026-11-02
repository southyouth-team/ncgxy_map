import { describe, expect, it } from 'vitest'
import { createSceneObjectFromFeature, mapFeatureGeometryToWorld } from './featureSceneAdapter.js'

describe('GIS feature scene adapter', () => {
  it('creates a scene reference without copying geometry or planar transform', () => {
    const feature = {
      id: '101', name: '一号教学楼', layerId: '10',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 8], [0, 0]]] },
    }
    const object = createSceneObjectFromFeature(feature, { featureType: 'building', templateId: 'academic-building' })
    expect(object).toMatchObject({
      type: 'building', featureId: '101', name: '一号教学楼',
      layerId: '10', templateId: 'academic-building',
    })
    expect(object).not.toHaveProperty('geometry')
    expect(object).not.toHaveProperty('transform.position')
  })

  it('maps nested GeoJSON coordinates to the Three.js XZ ground plane', () => {
    const feature = {
      geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [5, 6], [1, 2]]] },
    }
    const geometry = mapFeatureGeometryToWorld(feature, ([x, y]) => ({ x: x * 2, z: -y * 2 }))
    expect(geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[2, -4], [6, -8], [10, -12], [2, -4]]],
    })
  })

  it('preserves geometry type and maps line strings', () => {
    const feature = { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 2]] } }
    expect(mapFeatureGeometryToWorld(feature, ([x, y]) => ({ x, z: y }))).toEqual({
      type: 'LineString', coordinates: [[0, 0], [1, 2]],
    })
  })

  it('rejects missing feature ids, unsupported layer types and invalid mappers', () => {
    expect(() => createSceneObjectFromFeature({}, { featureType: 'building' })).toThrow('必须包含 id')
    expect(() => createSceneObjectFromFeature({ id: '1' }, { featureType: 'unknown' })).toThrow('无法映射')
    expect(() => mapFeatureGeometryToWorld({ geometry: { type: 'Point', coordinates: [1, 2] } })).toThrow('必须提供')
    expect(() => mapFeatureGeometryToWorld(
      { geometry: { type: 'Point', coordinates: [1, 2] } },
      () => ({ x: NaN, z: 0 }),
    )).toThrow('必须返回有限数值')
  })
})
