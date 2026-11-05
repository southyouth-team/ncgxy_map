import { describe, expect, it } from 'vitest'
import { addPolygonOutlinePoint, polygonOutlineArea, removePolygonOutlinePoint, updatePolygonOutlinePoint, validatePolygonOutline } from './polygonOutline.js'

const triangle = [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]]

describe('polygon outline editing', () => {
  it('updates a vertex while preserving a valid outline', () => {
    const result = updatePolygonOutlinePoint(triangle, 2, 1, 0.4)
    expect(result[2]).toEqual([0, 0.4])
    expect(triangle[2]).toEqual([0, 0.5])
  })
  it('inserts a midpoint on the longest edge', () => {
    const result = addPolygonOutlinePoint(triangle)
    expect(result).toHaveLength(4)
    expect(result).toContainEqual([0, -0.5])
    expect(Math.abs(polygonOutlineArea(result))).toBeGreaterThan(0)
  })
  it('removes the last point but keeps at least three non-degenerate vertices', () => {
    const result = removePolygonOutlinePoint([...triangle, [0.2, 0.1]])
    expect(result).toHaveLength(3)
    expect(() => removePolygonOutlinePoint(triangle)).toThrow('至少保留 3 个点')
  })
  it('rejects out-of-range and degenerate outlines', () => {
    expect(() => validatePolygonOutline([[0, 0], [0.5, 0], [1, 0.5]])).toThrow('二维坐标')
    expect(() => updatePolygonOutlinePoint(triangle, 0, 0, 0.8)).toThrow('二维坐标')
    expect(() => validatePolygonOutline([[0, 0], [0.2, 0.2], [0.4, 0.4]])).toThrow('面积不能为零')
  })
  it('enforces the 32-point upper bound', () => {
    const points = Array.from({ length: 32 }, (_, index) => {
      const angle = index / 32 * Math.PI * 2
      return [Math.cos(angle) * 0.45, Math.sin(angle) * 0.45]
    })
    expect(() => addPolygonOutlinePoint(points)).toThrow('上限')
  })
})
