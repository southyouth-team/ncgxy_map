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
    expect(result.x).toBe(-1)
    expect(result.z).toBe(-2.5)
    expect(result.blockedX).toBe(false)
    expect(result.blockedZ).toBe(true)
  })

  it('recovers a player spawned inside a building collision box', () => {
    const collision = world()
    const recovered = collision.resolvePosition({ x: 0, z: 0 })
    expect(collision.isBlocked(recovered.x, recovered.z)).toBe(false)
  })

  it('chooses the longer valid slide direction around a corner', () => {
    const collision = new CollisionWorld(
      { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      [{ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }],
      0.5,
    )
    const result = collision.move({ x: -3, z: -3 }, 2, 1)
    expect(result.x).toBe(-1)
    expect(result.z).toBe(-2.5)
  })
  it('keeps the player inside the walkable boundary', () => {
    const result = world().move({ x: 9.8, z: 0 }, 2, 0)
    expect(result.x).toBe(9.5)
  })

  it('accepts building obstacles loaded after the scene becomes interactive', () => {
    const collision = new CollisionWorld({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 })
    expect(collision.addObstacle({ minX: -1, maxX: 1, minZ: -1, maxZ: 1 })).toBe(true)
    expect(collision.move({ x: -2, z: 0 }, 2, 0).x).toBe(-1.75)
  })

  it('uses circular collision for trees, benches and lamps without blocking square corners', () => {
    const collision = new CollisionWorld({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [], 0.5)
    expect(collision.addCircleObstacle({ x: 0, z: 0, radius: 1 })).toBe(true)
    expect(collision.isBlocked(1.4, 1.4)).toBe(false)
    expect(collision.isBlocked(1.4, 0)).toBe(true)
    expect(collision.addCircleObstacle({ x: 0, z: 0, radius: -1 })).toBe(false)
  })

  it('rejects invalid dynamic obstacles', () => {
    const collision = new CollisionWorld({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 })
    expect(collision.addObstacle({ minX: 2, maxX: 1, minZ: 0, maxZ: 1 })).toBe(false)
    expect(collision.obstacles).toHaveLength(0)
  })

  it('prevents tunneling through a thin building during a fast movement step', () => {
    const collision = new CollisionWorld(
      { minX: -12, maxX: 12, minZ: -5, maxZ: 5 },
      [{ minX: -0.2, maxX: 0.2, minZ: -2, maxZ: 2 }],
      0.5,
    )
    const result = collision.move({ x: -8, z: 0 }, 16, 0)
    expect(result.x).toBeLessThanOrEqual(-0.7)
    expect(collision.isBlocked(result.x, result.z)).toBe(false)
  })

  it('blocks lake water while preserving the island hole as walkable', () => {
    const collision = new CollisionWorld(
      { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
      [],
      0.5,
    )
    expect(collision.addPolygonObstacle({
      outer: [[-8, -8], [8, -8], [8, 8], [-8, 8]],
      holes: [[[-2, -2], [2, -2], [2, 2], [-2, 2]]],
    })).toBe(true)
    expect(collision.isBlocked(5, 0)).toBe(true)
    expect(collision.isBlocked(0, 0)).toBe(false)
    expect(collision.isBlocked(2.2, 0)).toBe(true)
    expect(collision.isBlocked(9, 0)).toBe(false)
  })

  it('keeps a player on the island when walking toward lake water', () => {
    const collision = new CollisionWorld(
      { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
      [],
      0.5,
    )
    collision.addPolygonObstacle({
      outer: [[-8, -8], [8, -8], [8, 8], [-8, 8]],
      holes: [[[-2, -2], [2, -2], [2, 2], [-2, 2]]],
    })
    const result = collision.move({ x: 0, z: 0 }, 5, 0)
    expect(result.x).toBeLessThanOrEqual(1.5)
    expect(collision.isBlocked(result.x, result.z)).toBe(false)
  })

  it('uses a concave building footprint instead of blocking its bounding-box corners', () => {
    const collision = new CollisionWorld({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [], 0.25)
    expect(collision.addPolygonObstacle({
      outer: [[-4, -4], [4, -4], [4, -2], [-1, -2], [-1, 4], [-4, 4]],
    })).toBe(true)
    expect(collision.isBlocked(2, 2)).toBe(false)
    expect(collision.isBlocked(-2, 2)).toBe(true)
    expect(collision.isBlocked(2, -3)).toBe(true)
  })

  it('keeps a generated doorway open while blocking adjacent wall segments', () => {
    const collision = new CollisionWorld({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, [], 0.35)
    const wall = (x1, x2) => collision.addPolygonObstacle({
      outer: [[x1, 2], [x2, 2], [x2, 2.3], [x1, 2.3]],
    })
    expect(wall(-4, -0.7)).toBe(true)
    expect(wall(0.7, 4)).toBe(true)
    expect(collision.isBlocked(0, 2.15)).toBe(false)
    expect(collision.isBlocked(-2, 2.15)).toBe(true)
    expect(collision.isBlocked(2, 2.15)).toBe(true)
  })

  it('rejects invalid polygon obstacles', () => {
    const collision = new CollisionWorld({ minX: -5, maxX: 5, minZ: -5, maxZ: 5 })
    expect(collision.addPolygonObstacle({ outer: [[0, 0], [1, 1]] })).toBe(false)
    expect(collision.obstacles).toHaveLength(0)
  })

  it('ignores invalid obstacle bounds', () => {
    const collision = new CollisionWorld(
      { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      [{ minX: 2, maxX: 1, minZ: 0, maxZ: 1 }],
    )
    expect(collision.obstacles).toHaveLength(0)
  })
})
