/**
 * Sandbox-owned Rapier 3D physics runtime.
 *
 * Rendering objects remain owned by Three.js. This module owns physics state,
 * fixed-step simulation, and physics-body lifecycle only.
 */
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

  step(frameDeltaSeconds) {
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
      for (const entry of this.bodies.values()) {
        if (entry.kind !== 'kinematic-character') continue
        const current = entry.body.translation()
        const desired = entry.desiredVelocity
        entry.controller.computeColliderMovement(entry.collider, {
          x: desired.x * this.fixedTimeStep,
          y: desired.y * this.fixedTimeStep,
          z: desired.z * this.fixedTimeStep,
        })
        const corrected = entry.controller.computedMovement()
        entry.body.setNextKinematicTranslation({
          x: current.x + corrected.x,
          y: current.y + corrected.y,
          z: current.z + corrected.z,
        })
        entry.pendingGrounded = entry.controller.computedGrounded()
      }
      this.world.step()
      this.stepCount += 1
      for (const entry of this.bodies.values()) {
        if (entry.kind !== 'kinematic-character') continue
        entry.grounded = entry.pendingGrounded === true
        entry.position = entry.body.translation()
      }
      this.accumulator -= this.fixedTimeStep
      steps += 1
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

  createKinematicCharacter(options = {}) {
    this.#assertActive()
    const id = String(options.id || '')
    if (!id) throw new TypeError('Kinematic character requires a stable id')
    if (this.bodies.has(id)) throw new Error('Physics body id already exists: ' + id)

    const radius = this.#positiveNumber(options.radius, 0.35)
    const halfHeight = Math.max(0.01, Number(options.halfHeight) || 0.5)
    const offset = this.#positiveNumber(options.offset, 0.01)
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
      controller.setMaxSlopeClimbAngle?.(Number(options.maxSlopeClimbAngle) || (50 * Math.PI / 180))
      controller.setMinSlopeSlideAngle?.(Number(options.minSlopeSlideAngle) || (30 * Math.PI / 180))
      controller.enableAutostep?.(
        this.#positiveNumber(options.maxStepHeight, 0.45),
        this.#positiveNumber(options.minStepWidth, 0.2),
        false,
      )
      controller.enableSnapToGround?.(this.#positiveNumber(options.snapToGroundDistance, 0.25))
      const entry = {
        id,
        ownerId: options.ownerId == null ? null : String(options.ownerId),
        body,
        collider,
        controller,
        kind: 'kinematic-character',
        dimensions: { radius, halfHeight },
        desiredVelocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        pendingGrounded: true,
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

  getKinematicCharacterState(id) {
    const entry = this.bodies.get(String(id))
    if (!entry || entry.kind !== 'kinematic-character') return null
    const translation = entry.position || entry.body.translation()
    return {
      translation: { x: translation.x, y: translation.y, z: translation.z },
      grounded: entry.grounded === true,
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
    entry.desiredVelocity = { x: 0, y: 0, z: 0 }
    entry.grounded = true
    entry.pendingGrounded = true
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
