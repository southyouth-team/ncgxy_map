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
    static trimesh(vertices, indices) {
      return {
        vertices,
        indices,
        setFriction(value) { this.friction = value; return this },
        setRestitution(value) { this.restitution = value; return this },
        setSensor(value) { this.sensor = value; return this },
        setCollisionGroups(value) { this.collisionGroups = value; return this },
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

  it('registers static trimesh geometry for walkable model structures', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    const entry = runtime.createStaticTrimesh({
      id: 'stairs:mesh',
      ownerId: 'stairs-model',
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
      friction: 0.9,
    })
    expect(entry).toMatchObject({ kind: 'static-trimesh', vertexCount: 3, triangleCount: 1 })
    expect(calls.colliders[0].description.vertices).toBeInstanceOf(Float32Array)
    expect(calls.colliders[0].description.indices).toBeInstanceOf(Uint32Array)
    expect(calls.colliders[0].description.friction).toBe(0.9)
  })

  it('rejects malformed static trimesh vertex and index buffers', () => {
    const { RAPIER } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    expect(() => runtime.createStaticTrimesh({
      id: 'bad-mesh', vertices: [0, 0, 0], indices: [0, 1, 2],
    })).toThrow(/finite xyz vertices/)
    expect(() => runtime.createStaticTrimesh({
      id: 'fractional-index', vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1.5, 2],
    })).toThrow(/finite xyz vertices/)
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

  it('uses the shared traversal profile for capsule dimensions and controller limits', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    const profile = {
      height: 2,
      radius: 0.4,
      maxStepHeight: 0.22,
      jumpHeight: 1.1,
      jumpMaxDistance: 3,
      maxSlopeClimbAngleDegrees: 35,
      minSlopeSlideAngleDegrees: 25,
      minStepWidth: 0.3,
      snapToGroundDistance: 0.18,
      colliderOffset: 0.02,
    }
    const entry = runtime.createKinematicCharacter({
      id: 'profiled-player',
      traversalProfile: profile,
    })
    expect(entry.traversalProfile).toEqual(profile)
    expect(entry.dimensions).toMatchObject({ radius: 0.4, halfHeight: 0.6, height: 2 })
    expect(calls.controllers[0].setMaxSlopeClimbAngle).toHaveBeenCalledWith(35 * Math.PI / 180)
    expect(calls.controllers[0].setMinSlopeSlideAngle).toHaveBeenCalledWith(25 * Math.PI / 180)
    expect(calls.controllers[0].enableAutostep).toHaveBeenCalledWith(0.22, 0.3, false)
    expect(calls.controllers[0].enableSnapToGround).toHaveBeenCalledWith(0.18)
  })

  it('removes the character controller before its rigid body and supports teleporting', () => {
    const { RAPIER, calls } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER)
    const entry = runtime.createKinematicCharacter({ id: 'sandbox:player', ownerId: 'sandbox:player' })
    expect(runtime.setKinematicCharacterPosition('sandbox:player', { x: 4, y: 2, z: 6 })).toBe(true)
    expect(entry.body.setTranslation).toHaveBeenCalledWith({ x: 4, y: 2, z: 6 }, true)
    runtime.removeOwner('sandbox:player')
    expect(calls.controllersRemoved).toEqual([entry.controller])
    expect(calls.removed).toEqual([entry.body])
  })



  it('interpolates the render position between fixed physics steps', () => {
    const { RAPIER } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER, { fixedTimeStep: 1 / 60 })
    runtime.createKinematicCharacter({ id: 'interpolated-player' })
    runtime.setKinematicCharacterVelocity('interpolated-player', { x: 6, y: 0, z: 0 })

    runtime.step(1 / 60)
    runtime.step(1 / 120)

    const state = runtime.getKinematicCharacterState('interpolated-player')
    expect(state.translation.x).toBeCloseTo(0.1)
    expect(state.interpolationAlpha).toBeCloseTo(0.5)
    expect(state.interpolatedTranslation.x).toBeCloseTo(0.05)
  })

  it('reports actual fixed-step displacement separately from commanded velocity', () => {
    const { RAPIER } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER, { fixedTimeStep: 1 / 60 })
    runtime.createKinematicCharacter({ id: 'diagnostic-player' })
    runtime.setKinematicCharacterVelocity('diagnostic-player', { x: 3, y: 0, z: -2 })

    runtime.step(1 / 60)

    expect(runtime.getKinematicCharacterState('diagnostic-player')).toMatchObject({
      commandedVelocity: { x: 3, y: 0, z: -2 },
      actualVelocity: { x: 3, y: 0, z: -2 },
      lastStepMovement: { x: 0.05, y: 0, z: -2 / 60 },
      stepCount: 1,
    })
  })

  it('integrates character acceleration identically at different render frame rates', () => {
    const simulate = renderHz => {
      const { RAPIER } = createRapierMock()
      const runtime = new PhysicsRuntime(RAPIER, { fixedTimeStep: 1 / 60 })
      runtime.createKinematicCharacter({ id: 'fixed-step-player' })
      runtime.setKinematicCharacterVelocity('fixed-step-player', { x: 0, y: 10, z: 0 })
      runtime.setKinematicCharacterAcceleration('fixed-step-player', { x: 0, y: -24, z: 0 })
      for (let frame = 0; frame < renderHz; frame += 1) runtime.step(1 / renderHz)
      return runtime.getKinematicCharacterState('fixed-step-player')
    }

    const at30Hz = simulate(30)
    const at60Hz = simulate(60)
    const at120Hz = simulate(120)

    expect(at30Hz.stepCount).toBe(60)
    expect(at60Hz.stepCount).toBe(60)
    expect(at120Hz.stepCount).toBe(60)
    expect(at30Hz.velocity.y).toBeCloseTo(at60Hz.velocity.y)
    expect(at60Hz.velocity.y).toBeCloseTo(at120Hz.velocity.y)
  })

  it('consumes character velocity only on fixed physics steps', () => {
    const { RAPIER } = createRapierMock()
    const runtime = new PhysicsRuntime(RAPIER, { fixedTimeStep: 1 / 60 })
    runtime.createKinematicCharacter({
      id: 'sandbox:player',
      translation: { x: 0, y: 0, z: 0 },
    })
    runtime.setKinematicCharacterVelocity('sandbox:player', { x: 6, y: -2, z: 3 })
    expect(runtime.getKinematicCharacterState('sandbox:player')).toMatchObject({
      translation: { x: 0, y: 0, z: 0 },
      stepCount: 0,
    })
    runtime.step(1 / 120)
    expect(runtime.getKinematicCharacterState('sandbox:player').stepCount).toBe(0)
    runtime.step(1 / 120)
    expect(runtime.getKinematicCharacterState('sandbox:player')).toMatchObject({
      translation: { x: 0.1, y: -1 / 30, z: 0.05 },
      grounded: true,
      stepCount: 1,
    })
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
