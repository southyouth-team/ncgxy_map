import { describe, expect, it } from 'vitest'
import { CollisionWorld } from './CollisionWorld.js'

describe('CollisionWorld', () => {
  const world = () => new CollisionWorld(
    { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    [{ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }],
    0.5,
  )

  it('blocks movement through building bounds', () => {
    const result = world().move({ x: -3, z: 0 }, 2, 0)
    expect(result.x).toBe(-2.5)
    expect(result.blockedX).toBe(true)
  })

  it('slides along a wall when diagonal movement is partially blocked', () => {
    const result = world().move({ x: -3, z: -3 }, 2, 2)
    expect(result.x).toBe(-2.5)
    expect(result.z).toBe(-1)
    expect(result.blockedX).toBe(true)
    expect(result.blockedZ).toBe(false)
  })

  it('keeps the player inside the walkable boundary', () => {
    const result = world().move({ x: 9.8, z: 0 }, 2, 0)
    expect(result.x).toBe(9.5)
  })

  it('ignores invalid obstacle bounds', () => {
    const collision = new CollisionWorld(
      { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      [{ minX: 2, maxX: 1, minZ: 0, maxZ: 1 }],
    )
    expect(collision.obstacles).toHaveLength(0)
  })
})
