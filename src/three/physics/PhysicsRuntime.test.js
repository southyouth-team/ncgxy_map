import { describe, expect, it, vi } from 'vitest'
import { PhysicsRuntime } from './PhysicsRuntime.js'

function createRapierMock() {
  const calls = { steps: 0, removed: [], controllersRemoved: [], freed: 0, colliders: [], controllers: [] }
  class World {
    constructor(gravity) { this.gravity = gravity; this.timestep = 0 }
    step() { calls.steps += 1 }
    createRigidBody(description) {
      const position = { ...(description.translation || { x: 0, y: 0, z: 0 }) }
      return {
        description,
        translation: () => ({ ...position }),
        setTranslation: vi.fn(value => Object.assign(position, value)),
        setNextKinematicTranslation: vi.fn(value => Object.assign(position, value)),
        setRotation: vi.fn(),
      }
    }
    createCharacterController(offset) {
      const controller = {
        offset,
        computed: { x: 0, y: 0, z: 0 },
        computeColliderMovement: vi.fn((collider, desired) => { controller.computed = desired }),
        computedMovement: () => controller.computed,
        computedGrounded: () => true,
        numComputedCollisions: () => 0,
        setUp: vi.fn(),
        setSlideEnabled: vi.fn(),
        setMaxSlopeClimbAngle: vi.fn(),
        setMinSlopeSlideAngle: vi.fn(),
        enableAutostep: vi.fn(),
        enableSnapToGround: vi.fn(),
      }
      calls.controllers.push(controller)
      return controller
    }
    removeCharacterController(controller) { calls.controllersRemoved.push(controller) }
    createCollider(description, body) {
      const collider = { description, body }
      calls.colliders.push(collider)
      return collider
    }
    removeRigidBody(body) { calls.removed.push(body) }
    free() { calls.freed += 1 }
  }
  class RigidBodyDesc {
    static kinematicPositionBased() {
      return {
        setTranslation(x, y, z) { this.translation = { x, y, z }; return this },
      }
    }
    static fixed() {
      return {
        setTranslation(x, y, z) { this.translation = { x, y, z }; return this },
        setRotation(rotation) { this.rotation = rotation; return this },
      }
    }
  }
  class ColliderDesc {
    static capsule(halfHeight, radius) {
      return {
        halfHeight,
        radius,
        setTranslation(x, y, z) { this.translation = { x, y, z }; return this },
      }
    }
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



  it('creates a kinematic capsule character with slope, autostep, and snap settings', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    const entry = runtime.createKinematicCharacter({
      id: 'sandbox:player',
      ownerId: 'sandbox:player',
      translation: { x: 2, y: 0, z: 3 },
      radius: 0.35,
      halfHeight: 0.5,
      maxStepHeight: 0.45,
      minStepWidth: 0.2,
    })
    expect(entry.kind).toBe('kinematic-character')
    expect(entry.collider.description).toMatchObject({
      halfHeight: 0.5,
      radius: 0.35,
      translation: { x: 0, y: 0.85, z: 0 },
    })
    expect(calls.controllers[0].enableAutostep).toHaveBeenCalledWith(0.45, 0.2, false)
    expect(calls.controllers[0].enableSnapToGround).toHaveBeenCalledWith(0.25)
  })

  it('computes collision-corrected movement and applies the next kinematic position', () => {
    const { RAPIER } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    const entry = runtime.createKinematicCharacter({
      id: 'sandbox:player',
      translation: { x: 2, y: 0, z: 3 },
    })
    entry.controller.computed = { x: 0.5, y: -0.1, z: 1 }
    const result = runtime.moveKinematicCharacter('sandbox:player', { x: 1, y: -0.2, z: 1 })
    expect(entry.controller.computeColliderMovement).toHaveBeenCalledWith(entry.collider, { x: 1, y: -0.2, z: 1 })
    expect(result).toMatchObject({
      translation: { x: 2.5, y: -0.1, z: 4 },
      movement: { x: 0.5, y: -0.1, z: 1 },
      grounded: true,
    })
    expect(entry.body.setNextKinematicTranslation).toHaveBeenCalledWith({ x: 2.5, y: -0.1, z: 4 })
  })

  it('removes the character controller before its rigid body and supports teleporting', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    const entry = runtime.createKinematicCharacter({ id: 'sandbox:player' })
    expect(runtime.setKinematicCharacterPosition('sandbox:player', { x: 4, y: 2, z: 6 })).toBe(true)
    expect(entry.body.setTranslation).toHaveBeenCalledWith({ x: 4, y: 2, z: 6 }, true)
    runtime.removeOwner('sandbox:player')
    expect(calls.controllersRemoved).toEqual([entry.controller])
    expect(calls.removed).toEqual([entry.body])
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
