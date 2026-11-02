import { describe, expect, it } from 'vitest'
import { roadToPolygon, calculateWorkspaceBounds } from './campusEditorDocument.js'

describe('roadToPolygon', () => {
  it('creates a surface with two sides for a straight road', () => {
    const polygon = roadToPolygon([[0, 0], [100, 0]], 12)
    expect(polygon).toHaveLength(4)
    expect(polygon[0][1]).toBe(6)
    expect(polygon[polygon.length - 1][1]).toBe(-6)
  })

  it('samples curved centerlines into a denser surface polygon', () => {
    const polygon = roadToPolygon([[0, 0], [50, 30], [100, 0]], 10)
    expect(polygon.length).toBeGreaterThan(10)
    expect(polygon.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true)
  })

  it('rejects invalid roads', () => {
    expect(roadToPolygon([[0, 0]], 10)).toEqual([])
    expect(roadToPolygon([[0, 0], [10, 0]], 0)).toEqual([])
  })
})


describe('roadNetworkToMultiPolygon', () => {
  it('unions crossing road surfaces into one connected polygon', async () => {
    const { roadNetworkToMultiPolygon } = await import('./campusEditorDocument.js')
    const result = roadNetworkToMultiPolygon([
      { id: 'horizontal', width: 10, points: [[0, 0], [100, 0]] },
      { id: 'vertical', width: 10, points: [[50, -50], [50, 50]] },
    ])
    expect(result).toHaveLength(1)
    expect(result[0][0].length).toBeGreaterThan(4)
  })

  it('keeps disconnected road segments as separate polygons', async () => {
    const { roadNetworkToMultiPolygon } = await import('./campusEditorDocument.js')
    const result = roadNetworkToMultiPolygon([
      { id: 'west', width: 8, points: [[0, 0], [20, 0]] },
      { id: 'east', width: 8, points: [[80, 0], [100, 0]] },
    ])
    expect(result).toHaveLength(2)
  })
})


describe('calculateWorkspaceBounds', () => {
  it('keeps the reference map and expands for objects outside its original extent', () => {
    const bounds = calculateWorkspaceBounds({
      buildings: [{ footprint: [[-245, 120], [-195, 120], [-195, 160], [-245, 160]] }],
      roads: [{ points: [[700, 500], [920, 540]] }],
    })
    expect(bounds.minX).toBeLessThan(-245)
    expect(bounds.maxX).toBeGreaterThan(920)
    expect(bounds.maxY).toBeGreaterThan(540)
    expect(bounds.width).toBeGreaterThan(640)
    expect(bounds.height).toBeGreaterThan(480)
  })

  it('does not mutate geometry while calculating padded, grid-aligned bounds', () => {
    const footprint = [[12, 18], [42, 18], [42, 48]]
    const before = JSON.stringify(footprint)
    const bounds = calculateWorkspaceBounds({ buildings: [{ footprint }], padding: 50, gridStep: 25 })
    expect(bounds.minX % 25).toBe(0)
    expect(bounds.minY % 25).toBe(0)
    expect(JSON.stringify(footprint)).toBe(before)
  })
})
