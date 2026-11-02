import { describe, expect, it } from 'vitest'
import { createDraftGeometry } from './geometryDraft.js'

describe('createDraftGeometry', () => {
  it('creates a LineString without closing the path', () => {
    const points = [[0, 0], [10, 5], [20, 8]]
    expect(createDraftGeometry('LineString', points)).toEqual({
      type: 'LineString',
      coordinates: points,
    })
  })

  it('closes Polygon rings', () => {
    expect(createDraftGeometry('Polygon', [[0, 0], [10, 0], [10, 10]])).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]],
    })
  })

  it('does not duplicate an already closed polygon ring', () => {
    const ring = [[0, 0], [10, 0], [10, 10], [0, 0]]
    expect(createDraftGeometry('Polygon', ring).coordinates[0]).toEqual(ring)
  })

  it('rejects insufficient vertices', () => {
    expect(() => createDraftGeometry('LineString', [[0, 0]])).toThrow(/至少需要 2/)
    expect(() => createDraftGeometry('Polygon', [[0, 0], [1, 1]])).toThrow(/至少需要 3/)
  })

  it('rejects invalid coordinates and unsupported geometry types', () => {
    expect(() => createDraftGeometry('LineString', [[0, 0], [NaN, 1]])).toThrow(/有限数值/)
    expect(() => createDraftGeometry('Point', [[0, 0]])).toThrow(/仅支持/)
  })
})
