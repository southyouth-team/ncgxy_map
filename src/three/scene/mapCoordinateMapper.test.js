import { describe, expect, it } from 'vitest'
import { createMapCoordinateMapper } from './mapCoordinateMapper.js'

describe('createMapCoordinateMapper', () => {
  it('maps map center to world origin and preserves aspect ratio', () => {
    const map = createMapCoordinateMapper({ canvas_width: 1000, canvas_height: 700 })
    expect(map([500, 350])).toEqual({ x: 0, z: 0 })
    expect(map([0, 0])).toEqual({ x: -75, z: -52.5 })
    expect(map([1000, 700])).toEqual({ x: 75, z: 52.5 })
  })

  it('supports explicit world width without claiming meter units', () => {
    const map = createMapCoordinateMapper({ canvasWidth: 640, canvasHeight: 480 }, { worldWidth: 128 })
    expect(map([640, 240])).toEqual({ x: 64, z: 0 })
  })

  it('rejects invalid map dimensions and coordinates', () => {
    expect(() => createMapCoordinateMapper({ canvas_width: 0, canvas_height: 480 })).toThrow()
    const map = createMapCoordinateMapper({ canvas_width: 640, canvas_height: 480 })
    expect(() => map([Number.NaN, 10])).toThrow()
  })
})
