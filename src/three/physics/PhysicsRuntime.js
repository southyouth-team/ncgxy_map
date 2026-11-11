/**
 * Sandbox-owned Rapier 3D physics runtime.
 *
 * Rendering objects remain owned by Three.js. This module owns physics state,
 * fixed-step simulation, and physics-body lifecycle only.
 */
import { normalizeCharacterTraversalProfile } from './CharacterTraversalProfile.js'

export class PhysicsRuntime {
  constructor(RAPIER, options = {}) {
    if (!RAPIER?.World || !RAPIER?.RigidBodyDesc || !RAPIER?.ColliderDesc) {
      throw new TypeError('PhysicsRuntime requires an initialized Rapier 3D module')
    }

    this.RAPIER = RAPIER
    this.fixedTimeStep = this.#positiveNumber(options.fixedTimeStep, 1 / 60)
    this.maxSubSteps = Math.max(1, Math.floor(this.#positiveNumber(options.maxSubSteps, 5)))
    this.maxFrameDelta = this.#positiveNumber(options.maxFrameDelta, 0.1)
    this.accumulator = 0
    this.droppedTime = 0
    this.stepCount = 0
    this.disposed = false
    this.bodies = new Map()
    this.world = new RAPIER.World(options.gravity || { x: 0, y: -9.81, z: 0 })
    this.world.timestep = this.fixedTimeStep
  }

  static async create(options = {}) {
    const imported = options.RAPIER
      ? null
      : await import('@dimforge/rapier3d-compat')
    const RAPIER = options.RAPIER || imported?.default || imported
    if (typeof RAPIER?.init === 'function') await RAPIER.init()
    return new PhysicsRuntime(RAPIER, options)
  }

  #positiveNumber(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : fallback
  }

  #assertActive() {
    if (this.disposed || !this.world) throw new Error('PhysicsRuntime has been disposed')
  }

  step(frameDeltaSeconds, { beforeFixedStep, afterFixedStep } = {}) {
    this.#assertActive()
    const delta = Number(frameDeltaSeconds)
    if (!Number.isFinite(delta) || delta <= 0) {
      return { steps: 0, alpha: this.accumulator / this.fixedTimeStep, droppedTime: 0 }
    }

    const acceptedDelta = Math.min(delta, this.maxFrameDelta)
    let droppedTime = Math.max(0, delta - acceptedDelta)
    this.accumulator += acceptedDelta
    let steps = 0

    while (this.accumulator + Number.EPSILON >= this.fixedTimeStep && steps < this.maxSubSteps) {
      const nextStep = this.stepCount + 1
      beforeFixedStep?.({ delta: this.fixedTimeStep, stepCount: nextStep, runtime: this })
      for (const entry of this.bodies.values()) {
        if (entry.kind !== 'kinematic-character') continue
        const current = entry.body.translation()
        entry.previousStepPosition = { x: current.x, y: current.y, z: current.z }
        const desired = entry.desiredVelocity
        const acceleration = entry.desiredAcceleration
        desired.x += acceleration.x * this.fixedTimeStep
        desired.y += acceleration.y * this.fixedTimeStep
        desired.z += acceleration.z * this.fixedTimeStep
        entry.controller.computeColliderMovement(entry.collider, {
          x: desired.x * this.fixedTimeStep,
          y: desired.y * this.fixedTimeStep,
          z: desired.z * this.fixedTimeStep,
        })
        const corrected = entry.controller.computedMovement()
        // 记录本步碰撞接触：地面接触（|ny|≈1）与墙面接触分离，供卡顿诊断区分
        // "被墙挡住"与"输入/电机没有给出位移"。
        let contactCount = 0
        let wallContactCount = 0
        if (typeof entry.controller.numComputedCollisions === 'function') {
          contactCount = entry.controller.numComputedCollisions() || 0
          for (let collisionIndex = 0; collisionIndex < contactCount; collisionIndex += 1) {
            const collision = entry.controller.computedCollision?.(collisionIndex)
            const normalY = Math.abs(Number(collision?.normal1?.y ?? collision?.normal2?.y ?? 1))
            if (Number.isFinite(normalY) && normalY < 0.5) wallContactCount += 1
          }
        }
        entry.contactCount = contactCount
        entry.wallContactCount = wallContactCount
        entry.body.setNextKinematicTranslation({
          x: current.x + corrected.x,
          y: current.y + corrected.y,
          z: current.z + corrected.z,
        })
        // Rapier computes this from the requested/corrected character movement before world.step().
        // Publish it only after world.step() so readers observe a completed fixed-step snapshot.
        entry.pendingGrounded = entry.controller.computedGrounded()
      }
      this.world.step()
      this.stepCount += 1
      for (const entry of this.bodies.values()) {
        if (entry.kind !== 'kinematic-character') continue
        entry.grounded = entry.pendingGrounded === true
        entry.groundedStepCount = this.stepCount
        const position = entry.body.translation()
        const previous = entry.previousStepPosition || position
        entry.position = { x: position.x, y: position.y, z: position.z }
        entry.lastStepMovement = {
          x: position.x - previous.x,
          y: position.y - previous.y,
          z: position.z - previous.z,
        }
        entry.actualVelocity = {
          x: entry.lastStepMovement.x / this.fixedTimeStep,
          y: entry.lastStepMovement.y / this.fixedTimeStep,
          z: entry.lastStepMovement.z / this.fixedTimeStep,
        }
      }
      this.accumulator -= this.fixedTimeStep
      steps += 1
      afterFixedStep?.({ delta: this.fixedTimeStep, stepCount: this.stepCount, runtime: this })
    }

    // Avoid an unbounded catch-up spiral after a stalled or backgrounded tab.
    if (this.accumulator >= this.fixedTimeStep) {
      const retained = this.accumulator % this.fixedTimeStep
      droppedTime += this.accumulator - retained
      this.accumulator = retained
    }

    this.droppedTime += droppedTime
    return {
      steps,
      alpha: this.accumulator / this.fixedTimeStep,
      droppedTime,
    }
  }

  createStaticBox(options = {}) {
    this.#assertActive()
    const id = String(options.id || '')
    if (!id) throw new TypeError('Static collider requires a stable id')
    if (this.bodies.has(id)) throw new Error('Physics body id already exists: ' + id)

    const translation = options.translation || { x: 0, y: 0, z: 0 }
    const halfExtents = options.halfExtents || { x: 0.5, y: 0.5, z: 0.5 }
    const values = [
      translation.x, translation.y, translation.z,
      halfExtents.x, halfExtents.y, halfExtents.z,
    ].map(Number)
    if (!values.every(Number.isFinite) || values.slice(3).some(value => value <= 0)) {
      throw new TypeError('Static box translation and half extents must be finite; half extents must be positive')
    }

    const bodyDesc = this.RAPIER.RigidBodyDesc.fixed()
      .setTranslation(values[0], values[1], values[2])
    if (options.rotation) {
      bodyDesc.setRotation({
        x: Number(options.rotation.x) || 0,
        y: Number(options.rotation.y) || 0,
        z: Number(options.rotation.z) || 0,
        w: Number.isFinite(Number(options.rotation.w)) ? Number(options.rotation.w) : 1,
      })
    }

    const colliderDesc = this.RAPIER.ColliderDesc.cuboid(values[3], values[4], values[5])
    if (Number.isFinite(Number(options.friction))) colliderDesc.setFriction(Number(options.friction))
    if (Number.isFinite(Number(options.restitution))) colliderDesc.setRestitution(Number(options.restitution))
    if (options.sensor === true) colliderDesc.setSensor(true)
    if (options.collisionGroups != null) colliderDesc.setCollisionGroups(options.collisionGroups)

    const body = this.world.createRigidBody(bodyDesc)
    try {
      const collider = this.world.createCollider(colliderDesc, body)
      const entry = {
        id,
        ownerId: options.ownerId == null ? null : String(options.ownerId),
        body,
        collider,
        kind: 'static-box',
      }
      this.bodies.set(id, entry)
      return entry
    } catch (error) {
      this.world.removeRigidBody(body)
      throw error
    }
  }

  createStaticTrimesh(options = {}) {
    this.#assertActive()
    const id = String(options.id || '')
    if (!id) throw new TypeError('Static trimesh collider requires a stable id')
    if (this.bodies.has(id)) throw new Error('Physics body id already exists: ' + id)

    const rawVertices = Array.from(options.vertices || [])
    const rawIndices = Array.from(options.indices || [])
    if (rawVertices.length < 9 || rawVertices.length % 3 !== 0
      || rawIndices.length < 3 || rawIndices.length % 3 !== 0
      || !rawVertices.every(value => Number.isFinite(Number(value)))
      || !rawIndices.every(index => Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) < rawVertices.length / 3)) {
      throw new TypeError('Static trimesh requires finite xyz vertices and valid triangle indices')
    }
    const vertices = options.vertices instanceof Float32Array
      ? options.vertices
      : new Float32Array(rawVertices)
    const indices = options.indices instanceof Uint32Array
      ? options.indices
      : new Uint32Array(rawIndices)
    if (typeof this.RAPIER.ColliderDesc.trimesh !== 'function') {
      throw new TypeError('Rapier runtime does not support static trimesh colliders')
    }

    const translation = options.translation || { x: 0, y: 0, z: 0 }
    const position = [translation.x, translation.y, translation.z].map(Number)
    if (!position.every(Number.isFinite)) throw new TypeError('Static trimesh translation must be finite')
    const bodyDesc = this.RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position[0], position[1], position[2])
    const colliderDesc = this.RAPIER.ColliderDesc.trimesh(vertices, indices)
    if (Number.isFinite(Number(options.friction))) colliderDesc.setFriction?.(Number(options.friction))
    if (Number.isFinite(Number(options.restitution))) colliderDesc.setRestitution?.(Number(options.restitution))
    if (options.sensor === true) colliderDesc.setSensor?.(true)
    if (options.collisionGroups != null) colliderDesc.setCollisionGroups?.(options.collisionGroups)

    const body = this.world.createRigidBody(bodyDesc)
    try {
      const collider = this.world.createCollider(colliderDesc, body)
      const entry = {
        id,
        ownerId: options.ownerId == null ? null : String(options.ownerId),
        body,
        collider,
        kind: 'static-trimesh',
        vertexCount: vertices.length / 3,
        triangleCount: indices.length / 3,
      }
      this.bodies.set(id, entry)
      return entry
    } catch (error) {
      this.world.removeRigidBody(body)
      throw error
    }
  }

  createKinematicCharacter(options = {}) {
    this.#assertActive()
    const id = String(options.id || '')
    if (!id) throw new TypeError('Kinematic character requires a stable id')
    if (this.bodies.has(id)) throw new Error('Physics body id already exists: ' + id)

    const traversalProfile = normalizeCharacterTraversalProfile(options.traversalProfile || {
      radius: options.radius,
      height: options.height || (Number(options.halfHeight) > 0 && Number(options.radius) > 0
        ? Number(options.halfHeight) * 2 + Number(options.radius) * 2
        : undefined),
      maxStepHeight: options.maxStepHeight,
      maxSlopeClimbAngleDegrees: Number.isFinite(Number(options.maxSlopeClimbAngle))
        ? Number(options.maxSlopeClimbAngle) * 180 / Math.PI : undefined,
      minSlopeSlideAngleDegrees: Number.isFinite(Number(options.minSlopeSlideAngle))
        ? Number(options.minSlopeSlideAngle) * 180 / Math.PI : undefined,
      minStepWidth: options.minStepWidth,
      snapToGroundDistance: options.snapToGroundDistance,
      colliderOffset: options.offset,
    })
    const radius = traversalProfile.radius
    const halfHeight = Math.max(0.01, (traversalProfile.height - radius * 2) / 2)
    const offset = traversalProfile.colliderOffset
    const translation = options.translation || { x: 0, y: 0, z: 0 }
    const position = [translation.x, translation.y, translation.z].map(Number)
    if (!position.every(Number.isFinite)) throw new TypeError('Kinematic character translation must be finite')

    const bodyDesc = this.RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position[0], position[1], position[2])
    const body = this.world.createRigidBody(bodyDesc)
    let collider = null
    let controller = null
    try {
      const colliderDesc = this.RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setTranslation(0, halfHeight + radius, 0)
      collider = this.world.createCollider(colliderDesc, body)
      controller = this.world.createCharacterController(offset)
      controller.setUp?.({ x: 0, y: 1, z: 0 })
      controller.setSlideEnabled?.(true)
      controller.setMaxSlopeClimbAngle?.(traversalProfile.maxSlopeClimbAngleDegrees * Math.PI / 180)
      controller.setMinSlopeSlideAngle?.(traversalProfile.minSlopeSlideAngleDegrees * Math.PI / 180)
      controller.enableAutostep?.(
        traversalProfile.maxStepHeight,
        traversalProfile.minStepWidth,
        false,
      )
      controller.enableSnapToGround?.(traversalProfile.snapToGroundDistance)
      const entry = {
        id,
        ownerId: options.ownerId == null ? null : String(options.ownerId),
        body,
        collider,
        controller,
        kind: 'kinematic-character',
        dimensions: { radius, halfHeight, height: traversalProfile.height },
        traversalProfile,
        desiredVelocity: { x: 0, y: 0, z: 0 },
        desiredAcceleration: { x: 0, y: 0, z: 0 },
        actualVelocity: { x: 0, y: 0, z: 0 },
        lastStepMovement: { x: 0, y: 0, z: 0 },
        previousStepPosition: { x: position[0], y: position[1], z: position[2] },
        // Grounded is the last completed character-controller movement result, not a raw contact-manifold query.
        grounded: true,
        pendingGrounded: true,
        contactCount: 0,
        wallContactCount: 0,
        position: { x: position[0], y: position[1], z: position[2] },
      }
      this.bodies.set(id, entry)
      return entry
    } catch (error) {
      if (controller) this.world.removeCharacterController?.(controller)
      if (body) this.world.removeRigidBody(body)
      throw error
    }
  }

  setKinematicCharacterVelocity(id, velocity = {}) {
    this.#assertActive()
    const entry = this.bodies.get(String(id))
    if (!entry || entry.kind !== 'kinematic-character') return false
    const values = [velocity.x, velocity.y, velocity.z].map(Number)
    if (!values.every(Number.isFinite)) throw new TypeError('Character velocity must be finite')
    entry.desiredVelocity = { x: values[0], y: values[1], z: values[2] }
    return true
  }

  setKinematicCharacterAcceleration(id, acceleration = {}) {
    this.#assertActive()
    const entry = this.bodies.get(String(id))
    if (!entry || entry.kind !== 'kinematic-character') return false
    const values = [acceleration.x ?? 0, acceleration.y ?? 0, acceleration.z ?? 0].map(Number)
    if (!values.every(Number.isFinite)) throw new TypeError('Character acceleration must be finite')
    entry.desiredAcceleration = { x: values[0], y: values[1], z: values[2] }
    return true
  }

  getKinematicCharacterState(id) {
    const entry = this.bodies.get(String(id))
    if (!entry || entry.kind !== 'kinematic-character') return null
    const translation = entry.position || entry.body.translation()
    return {
      translation: { x: translation.x, y: translation.y, z: translation.z },
      // Render-only interpolation smooths fixed-step motion without changing collision state.
      interpolatedTranslation: (() => {
        const previous = entry.previousStepPosition || translation
        const alpha = Math.max(0, Math.min(1, this.accumulator / this.fixedTimeStep))
        return {
          x: previous.x + (translation.x - previous.x) * alpha,
          y: previous.y + (translation.y - previous.y) * alpha,
          z: previous.z + (translation.z - previous.z) * alpha,
        }
      })(),
      interpolationAlpha: Math.max(0, Math.min(1, this.accumulator / this.fixedTimeStep)),
      // velocity remains the commanded Rapier velocity for compatibility.
      velocity: { ...entry.desiredVelocity },
      commandedVelocity: { ...entry.desiredVelocity },
      actualVelocity: { ...entry.actualVelocity },
      lastStepMovement: { ...entry.lastStepMovement },
      grounded: entry.grounded === true,
      contactCount: entry.contactCount || 0,
      wallContactCount: entry.wallContactCount || 0,
      stepCount: this.stepCount,
    }
  }

  setKinematicCharacterPosition(id, translation = {}) {
    this.#assertActive()
    const entry = this.bodies.get(String(id))
    if (!entry || entry.kind !== 'kinematic-character') return false
    const values = [translation.x, translation.y, translation.z].map(Number)
    if (!values.every(Number.isFinite)) throw new TypeError('Character position must be finite')
    entry.body.setTranslation({ x: values[0], y: values[1], z: values[2] }, true)
    entry.body.setNextKinematicTranslation?.({ x: values[0], y: values[1], z: values[2] })
    entry.position = { x: values[0], y: values[1], z: values[2] }
    entry.previousStepPosition = { ...entry.position }
    entry.lastStepMovement = { x: 0, y: 0, z: 0 }
    entry.actualVelocity = { x: 0, y: 0, z: 0 }
    entry.desiredVelocity = { x: 0, y: 0, z: 0 }
    entry.desiredAcceleration = { x: 0, y: 0, z: 0 }
    entry.grounded = true
    entry.pendingGrounded = true
    entry.contactCount = 0
    entry.wallContactCount = 0
    return true
  }

  setBodyTransform(id, transform = {}) {
    this.#assertActive()
    const entry = this.bodies.get(String(id))
    if (!entry) return false

    const translation = transform.translation
    const rotation = transform.rotation
    if (translation) {
      const values = [translation.x, translation.y, translation.z].map(Number)
      if (!values.every(Number.isFinite)) throw new TypeError('Body translation must be finite')
      entry.body.setTranslation({ x: values[0], y: values[1], z: values[2] }, true)
    }
    if (rotation) {
      const values = [rotation.x, rotation.y, rotation.z, rotation.w].map(Number)
      if (!values.every(Number.isFinite)) throw new TypeError('Body rotation must be finite')
      entry.body.setRotation({ x: values[0], y: values[1], z: values[2], w: values[3] }, true)
    }
    return true
  }

  removeBody(id) {
    this.#assertActive()
    const key = String(id)
    const entry = this.bodies.get(key)
    if (!entry) return false
    if (entry.controller) this.world.removeCharacterController?.(entry.controller)
    this.world.removeRigidBody(entry.body)
    this.bodies.delete(key)
    return true
  }

  removeOwner(ownerId) {
    this.#assertActive()
    if (ownerId == null) return 0
    const key = String(ownerId)
    const ids = [...this.bodies.values()]
      .filter(entry => entry.ownerId === key)
      .map(entry => entry.id)
    for (const id of ids) this.removeBody(id)
    return ids.length
  }

  getBody(id) {
    return this.bodies.get(String(id)) || null
  }

  dispose() {
    if (this.disposed) return
    for (const entry of this.bodies.values()) {
      if (entry.controller) this.world?.removeCharacterController?.(entry.controller)
    }
    this.bodies.clear()
    this.world?.free?.()
    this.world = null
    this.accumulator = 0
    this.stepCount = 0
    this.disposed = true
  }
}
