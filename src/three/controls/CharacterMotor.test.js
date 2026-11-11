import { describe, expect, it, vi } from 'vitest'
import { CharacterMotor } from './CharacterMotor.js'

const traversalProfile = Object.freeze({ height: 1.7, jumpHeight: 1.25 })

function createMotor() {
  const state = {
    translation: { x: 0, y: 0, z: 0 },
    interpolatedTranslation: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    commandedVelocity: { x: 0, y: 0, z: 0 },
    actualVelocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    stepCount: 0,
  }
  const physicsRuntime = {
    getKinematicCharacterState: vi.fn(() => state),
    setKinematicCharacterVelocity: vi.fn(),
    setKinematicCharacterAcceleration: vi.fn(),
  }
  const motor = new CharacterMotor({ traversalProfile })
  motor.setPhysicsRuntime(physicsRuntime, 'sandbox:player')
  return { motor, physicsRuntime, state }
}

describe('CharacterMotor', () => {
  it('owns jump state and queues a jump command without depending on DOM input', () => {
    const { motor } = createMotor()
    expect(motor.jumpPlayer()).toBe(true)
    expect(motor.jumpActive).toBe(false)
    expect(motor.jumpRequested).toBe(true)
    expect(motor.jumpBufferRemaining).toBe(motor.jumpBufferDuration)
    motor.beforeFixedStep({ delta: 1 / 60 })
    expect(motor.jumpActive).toBe(true)
  })

  it('submits horizontal movement and vertical jump velocity together', () => {
    const { motor, physicsRuntime, state } = createMotor()
    motor.jumpPlayer()
    motor.moveWithPhysics({ x: 0, y: 1.7, z: 0 }, 0, 0.3, 1 / 60)
    motor.beforeFixedStep({ delta: 1 / 60 })

    expect(physicsRuntime.setKinematicCharacterVelocity).toHaveBeenCalledWith(
      'sandbox:player',
      expect.objectContaining({ x: 0, z: 18, y: expect.any(Number) }),
    )
    expect(state.translation).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('accepts explicit overview free-camera movement intent', () => {
    const { motor, physicsRuntime } = createMotor()
    motor.moveWithPhysics({ x: 0, y: 1.7, z: 0 }, 0, 0.3, 1 / 60, { mode: 'overview' })
    motor.beforeFixedStep({ delta: 1 / 60 })
    expect(physicsRuntime.setKinematicCharacterVelocity).toHaveBeenCalledWith(
      'sandbox:player',
      expect.objectContaining({ x: 0, z: 18 }),
    )
  })

  it('syncs presentation coordinates from the interpolated physics snapshot', () => {
    const { motor, state } = createMotor()
    state.interpolatedTranslation = { x: 2, y: 0.4, z: -3 }
    const player = { x: 0, y: 1.7, z: 0 }
    expect(motor.syncPlayerFromPhysicsState(player)).toBe(true)
    expect(player).toEqual({ x: 2, y: 2.1, z: -3 })
  })

  it('clears jump state on reset', () => {
    const { motor } = createMotor()
    motor.jumpPlayer()
    motor.reset()
    expect(motor.jumpActive).toBe(false)
    expect(motor.jumpRequested).toBe(false)
    expect(motor.jumpBufferRemaining).toBe(0)
    expect(motor.grounded).toBe(true)
  })
  it('advances jump buffering only when fixed simulation ticks are consumed', () => {
    const { motor } = createMotor()
    motor.jumpPlayer()
    const initial = motor.jumpBufferRemaining
    // Render frames that do not produce a physics tick do not touch Motor timers.
    expect(motor.jumpBufferRemaining).toBe(initial)
    motor.beforeFixedStep({ delta: 1 / 60 })
    expect(motor.jumpBufferRemaining).toBeCloseTo(initial - 1 / 60)
  })

  it('keeps a short jump press queued until the next fixed tick', () => {
    const { motor, physicsRuntime } = createMotor()
    motor.jumpPlayer()
    expect(physicsRuntime.setKinematicCharacterVelocity).not.toHaveBeenCalled()
    motor.beforeFixedStep({ delta: 1 / 60 })
    expect(physicsRuntime.setKinematicCharacterVelocity).toHaveBeenCalledTimes(1)
    expect(motor.jumpLaunched).toBe(true)
  })

  it.each([60, 120, 144])('keeps Coyote Time independent of %i Hz render cadence', renderHz => {
    const { motor, state } = createMotor()
    state.grounded = false
    motor.grounded = false
    const fixedDelta = 1 / 60
    const renderDelta = 1 / renderHz
    let accumulator = 0
    let elapsed = 0
    while (elapsed < 1 - 1e-9) {
      accumulator += renderDelta
      while (accumulator + Number.EPSILON >= fixedDelta) {
        motor.beforeFixedStep({ delta: fixedDelta })
        accumulator -= fixedDelta
      }
      elapsed += renderDelta
    }
    expect(motor.coyoteTimeRemaining).toBe(0)
    expect(motor.lastPhysicsStepCount).toBe(0)
  })


  it('uses collision-corrected vertical velocity instead of commanded velocity', () => {
    const { motor, state } = createMotor()
    motor.jumpActive = true
    motor.jumpLaunched = true
    motor.jumpWasAirborne = true
    state.grounded = false
    state.commandedVelocity.y = 8
    state.velocity.y = 8
    state.actualVelocity.y = 0

    motor.afterFixedStep()

    expect(motor.verticalVelocity).toBe(0)
    expect(motor.jumpActive).toBe(true)
  })

  it('keeps grounded vertical velocity at zero so Rapier does not jam on flat ground', () => {
    const { motor, physicsRuntime } = createMotor()
    // 实测（tools/repro-fix-sweep.mjs）：着地时持续 vy=-2 会让 Rapier 角色控制器
    // 在平坦静态盒/ trimesh 地面上周期性把水平修正清零（每 0.3~0.7s 停顿一步）；
    // vy=0 时四种地面形态全部零停顿，贴地由 snap-to-ground 负责。
    motor.beforeFixedStep({ delta: 1 / 60 })

    expect(physicsRuntime.setKinematicCharacterVelocity).toHaveBeenCalledWith(
      'sandbox:player',
      expect.objectContaining({ y: 0 }),
    )
    expect(physicsRuntime.setKinematicCharacterAcceleration).toHaveBeenCalledWith(
      'sandbox:player',
      expect.objectContaining({ y: 0 }),
    )
  })

  it('keeps gravity active while airborne', () => {
    const { motor, physicsRuntime, state } = createMotor()
    state.grounded = false
    motor.grounded = false

    motor.beforeFixedStep({ delta: 1 / 60 })

    expect(physicsRuntime.setKinematicCharacterAcceleration).toHaveBeenCalledWith(
      'sandbox:player',
      expect.objectContaining({ y: -motor.gravity }),
    )
  })

  it('reconciles landing only after the completed physics step reports grounded', () => {
    const { motor, state } = createMotor()
    motor.jumpActive = true
    motor.jumpLaunched = true
    motor.jumpWasAirborne = true
    state.grounded = true
    state.commandedVelocity.y = -4
    state.actualVelocity.y = 0

    motor.afterFixedStep()

    expect(motor.grounded).toBe(true)
    expect(motor.jumpActive).toBe(false)
    expect(motor.jumpLaunched).toBe(false)
    expect(motor.verticalVelocity).toBe(0)
  })

})
