/**
 * Rapier-backed character motor.
 * Owns locomotion state and submits commands only on fixed simulation ticks.
 */
export class CharacterMotor {
  constructor({ traversalProfile, gravity = 24, jumpBufferDuration = 0.22, coyoteTimeDuration = 0.18 } = {}) {
    if (!traversalProfile) throw new TypeError('CharacterMotor requires a traversal profile')
    this.traversalProfile = traversalProfile
    this.gravity = gravity
    this.jumpBufferDuration = jumpBufferDuration
    this.coyoteTimeDuration = coyoteTimeDuration
    this.physicsRuntime = null
    this.physicsCharacterId = null
    this.horizontalVelocity = { x: 0, z: 0 }
    this.verticalVelocity = 0
    this.grounded = true
    this.jumpActive = false
    this.jumpRequested = false
    this.jumpLaunched = false
    this.jumpWasAirborne = false
    this.jumpBufferRemaining = 0
    this.coyoteTimeRemaining = coyoteTimeDuration
    this.lastPhysicsStepCount = 0
    this.movementEnabled = true
    this.mode = 'thirdPerson'
  }

  setPhysicsRuntime(runtime, id = null) {
    this.physicsRuntime = runtime || null
    this.physicsCharacterId = id == null ? null : String(id)
  }

  reset({ grounded = true } = {}) {
    this.horizontalVelocity = { x: 0, z: 0 }
    this.verticalVelocity = 0
    this.grounded = grounded
    this.jumpActive = false
    this.jumpRequested = false
    this.jumpLaunched = false
    this.jumpWasAirborne = false
    this.jumpBufferRemaining = 0
    this.coyoteTimeRemaining = this.coyoteTimeDuration
  }

  moveWithPhysics(player, dx, dz, delta, { movementEnabled = true, mode = 'thirdPerson' } = {}) {
    if (!this.physicsRuntime || !this.physicsCharacterId) return null
    const dt = Math.max(0, Number(delta) || 0)
    const currentState = this.physicsRuntime.getKinematicCharacterState?.(this.physicsCharacterId)
    if (!currentState) return null
    this.movementEnabled = movementEnabled
    this.mode = mode
    this.horizontalVelocity = dt > 0 && movementEnabled
      ? { x: (Number(dx) || 0) / dt, z: (Number(dz) || 0) / dt }
      : { x: 0, z: 0 }
    const renderPosition = currentState.interpolatedTranslation || currentState.translation
    player.x = renderPosition.x
    player.y = renderPosition.y + this.traversalProfile.height
    player.z = renderPosition.z
    this.grounded = currentState.grounded === true
    this.lastPhysicsStepCount = currentState.stepCount
    return { ...currentState, physicsStepped: false }
  }

  beforeFixedStep({ delta }) {
    if (!this.physicsRuntime || !this.physicsCharacterId) return false
    const state = this.physicsRuntime.getKinematicCharacterState?.(this.physicsCharacterId)
    if (!state) return false

    const canMove = this.movementEnabled && (this.mode !== 'overview' || this.horizontalVelocity.x !== 0 || this.horizontalVelocity.z !== 0)
    const groundedBeforeStep = state.grounded === true
    if (groundedBeforeStep) {
      this.grounded = true
      this.coyoteTimeRemaining = this.coyoteTimeDuration
    } else {
      this.grounded = false
      this.coyoteTimeRemaining = Math.max(0, this.coyoteTimeRemaining - delta)
    }

    this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - delta)
    if (this.jumpBufferRemaining > 0 && !this.jumpActive
      && this.movementEnabled && this.mode !== 'overview'
      && (groundedBeforeStep || this.coyoteTimeRemaining > 0)) {
      this.verticalVelocity = Math.sqrt(2 * this.gravity * this.traversalProfile.jumpHeight)
      this.jumpActive = true
      this.jumpRequested = false
      this.jumpLaunched = true
      this.jumpWasAirborne = false
      this.jumpBufferRemaining = 0
      this.coyoteTimeRemaining = 0
      this.grounded = false
    } else if (groundedBeforeStep && !this.jumpActive) {
      this.verticalVelocity = -2
    }

    this.physicsRuntime.setKinematicCharacterVelocity(this.physicsCharacterId, {
      x: canMove ? this.horizontalVelocity.x : 0,
      y: this.verticalVelocity,
      z: canMove ? this.horizontalVelocity.z : 0,
    })
    this.physicsRuntime.setKinematicCharacterAcceleration?.(this.physicsCharacterId, {
      x: 0,
      y: (this.jumpActive || !groundedBeforeStep) ? -this.gravity : 0,
      z: 0,
    })
    return true
  }

  afterFixedStep() {
    if (!this.physicsRuntime || !this.physicsCharacterId) return false
    const state = this.physicsRuntime.getKinematicCharacterState?.(this.physicsCharacterId)
    if (!state) return false
    const wasAirborne = this.jumpWasAirborne
    this.grounded = state.grounded === true
    this.verticalVelocity = Number(state.velocity?.y) || 0
    if (!this.grounded && this.jumpLaunched) this.jumpWasAirborne = true
    if (this.grounded && this.jumpActive && (wasAirborne || this.jumpWasAirborne)) {
      this.jumpActive = false
      this.jumpRequested = false
      this.jumpLaunched = false
      this.jumpWasAirborne = false
      this.verticalVelocity = -2
    }
    this.lastPhysicsStepCount = state.stepCount
    return true
  }

  tryStartBufferedJump(grounded = this.grounded, { movementEnabled = true, mode = 'thirdPerson' } = {}) {
    if (this.jumpBufferRemaining <= 0 || this.jumpActive || !movementEnabled || mode === 'overview') return false
    if (!grounded && this.coyoteTimeRemaining <= 0) return false
    this.verticalVelocity = Math.sqrt(2 * this.gravity * this.traversalProfile.jumpHeight)
    this.jumpActive = true
    this.jumpRequested = Boolean(this.physicsRuntime)
    this.jumpLaunched = !this.physicsRuntime
    this.jumpWasAirborne = false
    this.jumpBufferRemaining = 0
    this.coyoteTimeRemaining = 0
    this.grounded = false
    return true
  }

  updateJumpInputWindow(delta, grounded = this.grounded, options = {}) {
    // Legacy non-Rapier path only. Rapier-backed timers advance in beforeFixedStep.
    if (this.physicsRuntime) return false
    const dt = Math.max(0, Math.min(Number(delta) || 0, 0.1))
    this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - dt)
    this.coyoteTimeRemaining = grounded
      ? this.coyoteTimeDuration
      : Math.max(0, this.coyoteTimeRemaining - dt)
    return this.tryStartBufferedJump(grounded, options)
  }

  jumpPlayer({ movementEnabled = true, mode = 'thirdPerson' } = {}) {
    if (!movementEnabled || mode === 'overview' || this.jumpActive) return false
    this.jumpBufferRemaining = this.jumpBufferDuration
    this.jumpRequested = Boolean(this.physicsRuntime)
    if (!this.physicsRuntime) {
      const physicsState = null
      if (physicsState?.grounded === true) this.grounded = true
      this.tryStartBufferedJump(this.grounded, { movementEnabled, mode })
    }
    return true
  }

  syncPlayerFromPhysicsState(player) {
    if (!this.physicsRuntime || !this.physicsCharacterId || !player) return false
    const state = this.physicsRuntime.getKinematicCharacterState?.(this.physicsCharacterId)
    if (!state?.translation) return false
    const renderPosition = state.interpolatedTranslation || state.translation
    player.x = renderPosition.x
    player.y = renderPosition.y + this.traversalProfile.height
    player.z = renderPosition.z
    this.grounded = state.grounded === true
    return true
  }
}
