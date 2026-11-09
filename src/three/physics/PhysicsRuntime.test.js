import { describe, expect, it, vi } from 'vitest'
import { PhysicsRuntime } from './PhysicsRuntime.js'

function createRapierMock() {
  const calls = { steps: 0, removed: [], freed: 0, colliders: [] }
  class World {
    constructor(gravity) { this.gravity = gravity; this.timestep = 0 }
    step() { calls.steps += 1 }
    createRigidBody(description) {
      return {
        description,
        setTranslation: vi.fn(),
        setRotation: vi.fn(),
      }
    }
    createCollider(description, body) {
      const collider = { description, body }
      calls.colliders.push(collider)
      return collider
    }
    removeRigidBody(body) { calls.removed.push(body) }
    free() { calls.freed += 1 }
  }
  class RigidBodyDesc {
    static fixed() {
      return {
        setTranslation(x, y, z) { this.translation = { x, y, z }; return this },
        setRotation(rotation) { this.rotation = rotation; return this },
      }
    }
  }
  class ColliderDesc {
    static cuboid(x, y, z) {
      return {
        halfExtents: { x, y, z },
        setFriction(value) { this.friction = value; return this },
        setRestitution(value) { this.restitution = value; return this },
        setSensor(value) { this.sensor = value; return this },
        setCollisionGroups(value) { this.collisionGroups = value; return this },
      }
    }
  }
  return { RAPIER: { World, RigidBodyDesc, ColliderDesc }, calls }
}

describe('PhysicsRuntime', () => {
  it('advances Rapier only in fixed simulation steps', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER, { fixedTimeStep: 1 / 60 })
    expect(runtime.step(1 / 120).steps).toBe(0)
    expect(runtime.step(1 / 120).steps).toBe(1)
    expect(calls.steps).toBe(1)
  })

  it('caps catch-up work and accounts for discarded frame time', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER, {
      fixedTimeStep: 1 / 60,
      maxSubSteps: 2,
      maxFrameDelta: 1,
    })
    const result = runtime.step(0.2)
    expect(result.steps).toBe(2)
    expect(result.droppedTime).toBeGreaterThan(0)
    expect(calls.steps).toBe(2)
  })

  it('registers stable static box bodies and updates their transforms', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    const entry = runtime.createStaticBox({
      id: 'building:wall:west',
      ownerId: 'building-1',
      translation: { x: 1, y: 2, z: 3 },
      halfExtents: { x: 2, y: 1, z: 0.2 },
      friction: 0.8,
    })
    expect(entry.kind).toBe('static-box')
    expect(calls.colliders[0].description.halfExtents).toEqual({ x: 2, y: 1, z: 0.2 })
    expect(runtime.setBodyTransform(entry.id, { translation: { x: 4, y: 5, z: 6 } })).toBe(true)
    expect(entry.body.setTranslation).toHaveBeenCalledWith({ x: 4, y: 5, z: 6 }, true)
  })

  it('removes all bodies owned by a model instance', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    runtime.createStaticBox({ id: 'model-a:wall-1', ownerId: 'model-a' })
    runtime.createStaticBox({ id: 'model-a:wall-2', ownerId: 'model-a' })
    runtime.createStaticBox({ id: 'model-b:wall-1', ownerId: 'model-b' })
    expect(runtime.removeOwner('model-a')).toBe(2)
    expect(runtime.bodies.size).toBe(1)
    expect(calls.removed).toHaveLength(2)
  })

  it('rejects duplicate ids and invalid collider dimensions', () => {
    const { RAPIER } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    runtime.createStaticBox({ id: 'wall-1' })
    expect(() => runtime.createStaticBox({ id: 'wall-1' })).toThrow('already exists')
    expect(() => runtime.createStaticBox({ id: 'bad-wall', halfExtents: { x: 1, y: 0, z: 1 } })).toThrow('half extents')
  })

  it('disposes the world once and rejects subsequent simulation', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    runtime.dispose()
    runtime.dispose()
    expect(calls.freed).toBe(1)
    expect(() => runtime.step(1 / 60)).toThrow('disposed')
  })
})
