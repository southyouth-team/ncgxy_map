/**
 * Rapier-backed character motor.
 * Owns jump/vertical locomotion state and translates horizontal movement intent
 * into kinematic character commands. Input devices and visual presentation stay outside.
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
    this.verticalVelocity = 0
    this.grounded = true
    this.jumpActive = false
    this.jumpRequested = false
    this.jumpLaunched = false
    this.jumpWasAirborne = false
    this.jumpBufferRemaining = 0
    this.coyoteTimeRemaining = coyoteTimeDuration
    this.lastPhysicsStepCount = 0
  }

  setPhysicsRuntime(runtime, id = null) {
    this.physicsRuntime = runtime || null
    this.physicsCharacterId = id == null ? null : String(id)
  }

  reset({ grounded = true } = {}) {
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
    const dt = Math.max(0, Math.min(Number(delta) || 0, 0.05))
    if (!dt) return null
    const previousStepCount = this.lastPhysicsStepCount
    const currentState = this.physicsRuntime.getKinematicCharacterState?.(this.physicsCharacterId)
    if (!currentState) return null
    this.updateJumpInputWindow(dt, currentState.grounded, { movementEnabled, mode })
    const launchPending = this.jumpRequested
    if (this.jumpActive && this.jumpLaunched && currentState.grounded && this.jumpWasAirborne
      && currentState.stepCount > previousStepCount) {
      this.jumpActive = false
      this.jumpLaunched = false
      this.jumpWasAirborne = false
      this.verticalVelocity = 0
    }
    if (!currentState.grounded && Number.isFinite(currentState.velocity?.y)) {
      this.verticalVelocity = currentState.velocity.y
    } else if (currentState.grounded && !this.jumpActive && !launchPending) {
      this.verticalVelocity = 0
    }
    const horizontalX = (Number(dx) || 0) / dt
    const horizontalZ = (Number(dz) || 0) / dt
    const verticalSpeed = this.jumpActive ? this.verticalVelocity : (currentState.grounded ? -2 : this.verticalVelocity)
    this.physicsRuntime.setKinematicCharacterVelocity(this.physicsCharacterId, {
      x: movementEnabled ? horizontalX : 0,
      y: verticalSpeed,
      z: movementEnabled ? horizontalZ : 0,
    })
    this.physicsRuntime.setKinematicCharacterAcceleration?.(this.physicsCharacterId, {
      x: 0,
      y: (this.jumpActive || !currentState.grounded) ? -this.gravity : 0,
      z: 0,
    })
    if (launchPending) {
      this.jumpRequested = false
      this.jumpLaunched = true
    }
    const state = this.physicsRuntime.getKinematicCharacterState(this.physicsCharacterId)
    player.x = state.translation.x
    player.y = state.translation.y + this.traversalProfile.height
    player.z = state.translation.z
    this.grounded = state.grounded === true
    if (this.jumpActive && this.jumpLaunched && !this.grounded) this.jumpWasAirborne = true
    this.lastPhysicsStepCount = state.stepCount
    if (this.jumpActive && this.jumpLaunched && this.grounded && this.jumpWasAirborne && state.stepCount > previousStepCount) {
      this.jumpActive = false
      this.jumpLaunched = false
      this.jumpWasAirborne = false
      this.verticalVelocity = 0
    } else if (this.grounded && !this.jumpActive && this.verticalVelocity < 0) {
      this.verticalVelocity = 0
    }
    return { ...state, physicsStepped: state.stepCount > previousStepCount }
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
    const dt = Math.max(0, Math.min(Number(delta) || 0, 0.1))
    this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - dt)
    this.coyoteTimeRemaining = grounded
      ? this.coyoteTimeDuration
      : Math.max(0, this.coyoteTimeRemaining - dt)
    return this.tryStartBufferedJump(grounded, options)
  }

  jumpPlayer({ movementEnabled = true, mode = 'thirdPerson' } = {}) {
    if (!movementEnabled || mode === 'overview' || this.jumpActive) return false
    const physicsState = this.physicsRuntime?.getKinematicCharacterState?.(this.physicsCharacterId)
    if (physicsState?.grounded === true) {
      this.grounded = true
      this.coyoteTimeRemaining = this.coyoteTimeDuration
    }
    this.jumpBufferRemaining = this.jumpBufferDuration
    this.tryStartBufferedJump(this.grounded, { movementEnabled, mode })
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
