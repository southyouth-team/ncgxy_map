import { describe, expect, it, vi } from 'vitest'
import { InputController } from './InputController.js'

function createController() {
  const cameraRig = {
    player: { x: 0, y: 1.7, z: 0 },
    updateThirdPersonDesired: vi.fn(),
    updateFirstPersonDesired: vi.fn(),
    thirdYaw: -Math.PI,
    firstYaw: 0,
  }
  const collisionWorld = {
    move: vi.fn((position, dx, dz) => ({ x: position.x + dx, z: position.z + dz })),
  }
  const controller = new InputController({}, {}, cameraRig, null, collisionWorld)
  controller.mode = 'thirdPerson'
  return { controller, cameraRig, collisionWorld }
}

describe('InputController movement intent', () => {
  it('keeps movement intent active while a directional key is held', () => {
    const { controller } = createController()
    expect(controller.hasMovementInput()).toBe(false)
    controller.keys.add('w')
    expect(controller.hasMovementInput()).toBe(true)
    controller.keys.delete('w')
    expect(controller.hasMovementInput()).toBe(false)
  })

  it('treats active navigation as movement intent and respects disabled movement', () => {
    const { controller } = createController()
    controller.setNavigationPath([{ x: 0, z: 0 }, { x: 0, z: 2 }])
    expect(controller.hasMovementInput()).toBe(true)
    controller.setMovementEnabled(false)
    expect(controller.hasMovementInput()).toBe(false)
  })

  it('does not report character movement intent in overview mode', () => {
    const { controller } = createController()
    controller.mode = 'overview'
    controller.keys.add('w')
    expect(controller.hasMovementInput()).toBe(false)
  })
})

describe('InputController combined movement and jump input', () => {
  it('accepts the first jump press during a transient airborne grounded snapshot', () => {
    const { controller } = createController()
    controller.grounded = false
    controller.coyoteTimeRemaining = 0.12
    controller.physicsRuntime = {
      getKinematicCharacterState: vi.fn(() => ({
        translation: { x: 0, y: 0, z: 0 },
        grounded: false,
        stepCount: 10,
      })),
    }
    controller.physicsCharacterId = 'sandbox:player'

    expect(controller.jumpPlayer()).toBe(true)
    expect(controller.jumpActive).toBe(false)
    expect(controller.jumpRequested).toBe(true)
    expect(controller.jumpBufferRemaining).toBeGreaterThan(0)
  })

  it('applies sprint movement and jump in the same update without reducing horizontal speed', () => {
    const { controller, cameraRig } = createController()
    const state = {
      translation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      stepCount: 0,
    }
    const setVelocity = vi.fn()
    controller.physicsRuntime = {
      getKinematicCharacterState: vi.fn(() => state),
      setKinematicCharacterVelocity: setVelocity,
      setKinematicCharacterAcceleration: vi.fn(),
    }
    controller.physicsCharacterId = 'sandbox:player'
    controller.keys.add('w')
    controller.keys.add('shift')

    expect(controller.jumpPlayer()).toBe(true)
    controller.update(1 / 60)
    expect(setVelocity).not.toHaveBeenCalled()
    controller.beforeFixedStep({ delta: 1 / 60 })

    expect(setVelocity).toHaveBeenCalledWith('sandbox:player', expect.objectContaining({
      x: 0,
      z: 18,
      y: expect.any(Number),
    }))
    expect(controller.jumpActive).toBe(true)
    expect(cameraRig.player.z).toBe(0)
  })
})

describe('InputController physics synchronization', () => {
  it('syncs the visual player after a physics step without consuming jump step tracking', () => {
    const { controller, cameraRig } = createController()
    controller.physicsRuntime = {
      getKinematicCharacterState: vi.fn(() => ({
        translation: { x: 2.5, y: 0.4, z: -3 },
        grounded: false,
        stepCount: 12,
      })),
    }
    controller.physicsCharacterId = 'sandbox:player'
    controller.lastPhysicsStepCount = 11

    expect(controller.syncPlayerFromPhysicsState()).toBe(true)
    expect(cameraRig.player).toEqual({ x: 2.5, y: 2.1, z: -3 })
    expect(controller.grounded).toBe(false)
    expect(controller.lastPhysicsStepCount).toBe(11)
  })
})
describe('InputController navigation path', () => {
  it('moves along a supplied path using the collision world', () => {
    const { controller, cameraRig, collisionWorld } = createController()
    expect(controller.setNavigationPath([{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 2, z: 2 }])).toBe(true)

    controller.update(0.1)

    expect(collisionWorld.move).toHaveBeenCalledWith(cameraRig.player, 0, 0.55)
    expect(cameraRig.player).toMatchObject({ x: 0, z: 0.55 })
    expect(cameraRig.updateThirdPersonDesired).toHaveBeenCalledOnce()
  })

  it('reports completion only after the final navigation waypoint is reached', () => {
    const { controller, cameraRig } = createController()
    controller.setNavigationPath([{ x: 0, z: 0 }, { x: 0, z: 0.1 }])

    controller.update(0.1)

    expect(controller.navigationPath).toBeNull()
    expect(controller.consumeNavigationPathCompletion()).toBe(true)
    expect(controller.consumeNavigationPathCompletion()).toBe(false)
    expect(cameraRig.player).toMatchObject({ x: 0, z: 0 })
  })

  it('does not report completion when navigation is cancelled by manual input', () => {
    const { controller } = createController()
    controller.setNavigationPath([{ x: 0, z: 0 }, { x: 0, z: 3 }])
    controller.keys.add('d')

    controller.update(0.1)

    expect(controller.consumeNavigationPathCompletion()).toBe(false)
  })

  it('cancels auto movement when a manual direction key is pressed', () => {
    const { controller, cameraRig, collisionWorld } = createController()
    controller.setNavigationPath([{ x: 0, z: 0 }, { x: 0, z: 3 }])
    controller.keys.add('d')

    controller.update(0.1)

    expect(collisionWorld.move).toHaveBeenCalledOnce()
    expect(cameraRig.player.x).not.toBe(0)
    expect(controller.navigationPath).toBeNull()
  })

  it('stops the route when collision prevents forward progress', () => {
    const { controller, collisionWorld } = createController()
    collisionWorld.move.mockReturnValue({ x: 0, z: 0 })
    controller.setNavigationPath([{ x: 0, z: 0 }, { x: 0, z: 2 }])

    controller.update(0.1)

    expect(controller.navigationPath).toBeNull()
    expect(controller.consumeNavigationPathCompletion()).toBe(false)
  })
})

describe('InputController first-person controls', () => {
  it('prevents browser scrolling and moves forward relative to first-person yaw', () => {
    const { controller, cameraRig, collisionWorld } = createController()
    controller.setMode('firstPerson')
    const preventDefault = vi.fn()

    controller.onKeyDown({ key: 'w', target: { tagName: 'CANVAS' }, preventDefault })
    controller.update(0.1)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(collisionWorld.move).toHaveBeenCalledWith(cameraRig.player, 0, 0.9)
    expect(cameraRig.player).toMatchObject({ x: 0, z: 0.9 })
    expect(cameraRig.updateFirstPersonDesired).toHaveBeenCalledOnce()
  })

  it('does not capture movement keys while the user is editing a form field', () => {
    const { controller } = createController()
    controller.setMode('firstPerson')
    const preventDefault = vi.fn()

    controller.onKeyDown({ key: 'w', target: { tagName: 'INPUT' }, preventDefault })

    expect(controller.keys.has('w')).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('clears held movement keys when the browser window loses focus', () => {
    const { controller } = createController()
    controller.keys.add('w')
    controller.onWindowBlur()

    expect(controller.keys.size).toBe(0)
  })

  it('wakes the render loop for the first Space press and starts jump immediately', () => {
    const { controller } = createController()
    const wakeRenderLoop = vi.fn()
    const preventDefault = vi.fn()
    controller.onMovementInput = wakeRenderLoop

    controller.onKeyDown({
      key: ' ',
      code: 'Space',
      repeat: false,
      target: { tagName: 'CANVAS' },
      preventDefault,
    })

    expect(controller.jumpActive).toBe(true)
    expect(wakeRenderLoop).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not lose a held movement key when unrelated keyup events arrive', () => {
    const { controller } = createController()
    controller.onKeyDown({
      key: 'w', code: 'KeyW', target: { tagName: 'CANVAS' }, preventDefault: vi.fn(),
    })
    controller.onKeyUp({ key: ' ', code: 'Space' })

    expect(controller.keys.has('w')).toBe(true)
  })

  it('normalizes physical key codes so keydown and keyup cannot disagree on letter casing', () => {
    const { controller } = createController()
    const preventDefault = vi.fn()

    controller.onKeyDown({ key: 'W', code: 'KeyW', target: { tagName: 'CANVAS' }, preventDefault })
    expect(controller.keys.has('w')).toBe(true)
    controller.onKeyUp({ key: 'w', code: 'KeyW' })
    expect(controller.keys.has('w')).toBe(false)

    controller.onKeyDown({ key: 'Shift', code: 'ShiftLeft', target: { tagName: 'CANVAS' }, preventDefault })
    expect(controller.keys.has('shift')).toBe(true)
    controller.onKeyUp({ key: 'Shift', code: 'ShiftLeft' })
    expect(controller.keys.has('shift')).toBe(false)
  })

  it('normalizes virtual controls and clears buffered jump input on focus loss', () => {
    const { controller } = createController()
    expect(controller.setVirtualKey('ArrowUp', true)).toBe(true)
    expect(controller.keys.has('arrowup')).toBe(true)
    controller.jumpBufferRemaining = 0.1

    controller.onWindowBlur()

    expect(controller.keys.size).toBe(0)
    expect(controller.jumpBufferRemaining).toBe(0)
  })
})


describe('InputController model support surface grounding', () => {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z) }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this }
  }
  class Raycaster {
    set(origin, direction) { this.origin = origin; this.direction = direction }
    intersectObjects() { return this.hits || [] }
  }
  class Matrix3 { getNormalMatrix() { return this } }
  const normal = (y = 1) => ({
    clone: () => ({
      applyMatrix3() { return this },
      normalize() { this.y = y; return this },
      y,
    }),
  })

  function groundedController(hits, playerY = 1.7) {
    const THREE = { Vector3, Raycaster, Matrix3 }
    const rig = { player: { x: 2, y: playerY, z: 3 } }
    const collision = { supportSurfaces: [{ supportsStanding: true, meshes: [{ matrixWorld: {} }] }] }
    const controller = new InputController(THREE, {}, rig, null, collision)
    controller.groundRaycaster.hits = hits
    return { controller, rig }
  }

  it('probes from above the player so elevated support meshes are detectable', () => {
    const { controller, rig } = groundedController([{
      face: { normal: normal(1) }, object: { matrixWorld: {} },
      point: { x: 2, y: 2.4, z: 3 },
    }], 4.1)
    expect(controller.resolvePlayerGroundHeight(rig.player)).toBeCloseTo(4.1)
    expect(controller.groundRayOrigin.y).toBeCloseTo(64.1)
    expect(controller.groundRaycaster.far).toBe(120)
  })

  it('ignores an unreachable upper floor and selects the lower reachable ground', () => {
    const { controller, rig } = groundedController([
      { face: { normal: normal(1) }, object: { matrixWorld: {} }, point: { x: 2, y: 3, z: 3 } },
      { face: { normal: normal(1) }, object: { matrixWorld: {} }, point: { x: 2, y: 0.3, z: 3 } },
    ])
    expect(controller.getPlayerSupportHit(rig.player)?.point.y).toBeCloseTo(0.3)
  })

  it('ignores surfaces steeper than the configured walkable slope', () => {
    const { controller, rig } = groundedController([{
      face: { normal: normal(0.2) }, object: { matrixWorld: {} },
      point: { x: 2, y: 2.4, z: 3 },
    }], 4.1)
    expect(controller.resolvePlayerGroundHeight(rig.player)).toBe(4.1)
  })

  it('keeps the default ground height when no declared mesh is under the player', () => {
    const { controller, rig } = groundedController([])
    expect(controller.resolvePlayerGroundHeight(rig.player)).toBe(1.7)
  })
})


describe('InputController gravity and traversal semantics', () => {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z) }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this }
  }
  class Raycaster {
    set(origin, direction) { this.origin = origin; this.direction = direction }
    intersectObjects() { return this.hits || [] }
  }
  class Matrix3 { getNormalMatrix() { return this } }
  const makeHit = (y) => ({
    face: { normal: { clone: () => ({ applyMatrix3() { return this }, normalize() { this.y = 1; return this }, y: 1 }) } },
    object: { matrixWorld: {} },
    point: { x: 0, y, z: 0 },
  })
  function setup(playerY = 1.7, hit = null) {
    const THREE = { Vector3, Raycaster, Matrix3 }
    const player = { x: 0, y: playerY, z: 0 }
    const rig = { player }
    const surface = { supportsStanding: true, walkable: true, meshes: [{}] }
    const collision = { supportSurfaces: [surface] }
    const controller = new InputController(THREE, {}, rig, null, collision)
    controller.groundRaycaster.hits = hit ? [hit] : []
    return { controller, player, surface }
  }

  it('does not teleport the player onto a platform higher than the step limit', () => {
    const { controller, player } = setup(1.7, makeHit(2.4))
    controller.updateVerticalMotion(player, 0.05, { walking: true })
    expect(player.y).toBeCloseTo(1.7)
    expect(player.y).not.toBeCloseTo(4.1)
    expect(controller.grounded).toBe(true)
  })

  it('applies gravity while airborne and lands on the default world ground', () => {
    const { controller, player } = setup(3, null)
    controller.grounded = false
    controller.verticalVelocity = -4
    for (let index = 0; index < 100; index += 1) controller.updateVerticalMotion(player, 0.05)
    expect(player.y).toBeCloseTo(1.7)
    expect(controller.verticalVelocity).toBe(0)
    expect(controller.grounded).toBe(true)
  })

  it('lands on a declared support surface after falling onto it', () => {
    const { controller, player } = setup(4.5, makeHit(2.4))
    controller.grounded = false
    controller.verticalVelocity = -8
    for (let index = 0; index < 20 && !controller.grounded; index += 1) {
      controller.updateVerticalMotion(player, 0.05)
    }
    expect(player.y).toBeCloseTo(4.1)
    expect(controller.grounded).toBe(true)
  })

  it('allows walking only on walkable surfaces while retaining standing support', () => {
    const { controller, surface } = setup(4.1, makeHit(2.4))
    surface.walkable = false
    surface.supportsStanding = true
    expect(controller.getPlayerSupportHit(controller.cameraRig.player, { walking: true })).toBeNull()
    expect(controller.getPlayerSupportHit(controller.cameraRig.player, { walking: false })).not.toBeNull()
  })
})


describe('InputController step traversal', () => {
  const hitAt = y => ({ point: { y } })
  function controllerWithSupports(currentSupport, nextWalkable, nextStanding) {
    const controller = new InputController({}, {}, { player: { x: 0, y: 2.7, z: 0 } }, null, {})
    controller.grounded = true
    controller.getPlayerSupportHit = vi.fn((player, { walking = false } = {}) => {
      if (player.x === 0) return currentSupport
      return walking ? nextWalkable : nextStanding
    })
    return controller
  }

  it('allows moving up a walkable stair tread within the step-height limit', () => {
    const controller = controllerWithSupports(hitAt(1), hitAt(1.3), hitAt(1.3))
    expect(controller.resolveHorizontalPosition({ x: 0, y: 2.7, z: 0 }, { x: 1, z: 0 }))
      .toMatchObject({ x: 1, z: 0 })
  })

  it('blocks a step higher than the configured maximum', () => {
    const controller = controllerWithSupports(hitAt(1), hitAt(1.6), hitAt(1.6))
    expect(controller.resolveHorizontalPosition({ x: 0, y: 2.7, z: 0 }, { x: 1, z: 0 }))
      .toMatchObject({ x: 0, z: 0 })
  })

  it('allows leaving a platform edge so gravity can take over', () => {
    const controller = controllerWithSupports(hitAt(1), null, null)
    expect(controller.resolveHorizontalPosition({ x: 0, y: 2.7, z: 0 }, { x: 1, z: 0 }))
      .toMatchObject({ x: 1, z: 0 })
  })

  it('does not allow walking onto a surface that only supports standing', () => {
    const controller = controllerWithSupports(hitAt(1), null, hitAt(1))
    expect(controller.resolveHorizontalPosition({ x: 0, y: 2.7, z: 0 }, { x: 1, z: 0 }))
      .toMatchObject({ x: 0, z: 0 })
  })
})


describe('InputController vertical camera synchronization', () => {
  it('updates the camera while the player falls without horizontal input', () => {
    const { controller, cameraRig } = createController()
    controller.mode = 'thirdPerson'
    cameraRig.player.y = 4
    controller.grounded = false
    controller.verticalVelocity = -4

    controller.update(0.05)

    expect(cameraRig.player.y).toBeLessThan(4)
    expect(cameraRig.updateThirdPersonDesired).toHaveBeenCalledOnce()
  })

  it('does not update the camera every idle frame while grounded', () => {
    const { controller, cameraRig } = createController()
    controller.grounded = true

    controller.update(0.05)

    expect(cameraRig.updateThirdPersonDesired).not.toHaveBeenCalled()
  })
})


describe('InputController fixed player dimensions', () => {
  it('keeps the canonical collider and eye height when visual dimensions are requested', () => {
    const { controller, cameraRig, collisionWorld } = createController()
    collisionWorld.setRadius = vi.fn()
    const result = controller.setPlayerDimensions({ eyeHeight: 1.9, colliderRadius: 0.32 })
    expect(result).toEqual({ eyeHeight: 1.7, colliderRadius: 0.55 })
    expect(cameraRig.player.y).toBe(1.7)
    expect(controller.traversalProfile).toMatchObject({ height: 1.7, radius: 0.55 })
    expect(collisionWorld.setRadius).not.toHaveBeenCalled()
  })

  it('applies the canonical collider radius when the active collision world changes', () => {
    const { controller } = createController()
    const nextWorld = { setRadius: vi.fn() }
    controller.collisionWorld = nextWorld
    expect(nextWorld.setRadius).toHaveBeenCalledWith(0.55)
  })
})

describe('InputController Rapier character movement', () => {
  function attachPhysics(controller, player) {
    const calls = { created: [], velocities: [], accelerations: [], teleported: [], removed: [] }
    let feet = { x: player.x, y: player.y - controller.playerEyeHeight, z: player.z }
    let grounded = true
    let verticalVelocity = 0
    let stepCount = 0
    const runtime = {
      removeBody: id => calls.removed.push(id),
      createKinematicCharacter: options => {
        calls.created.push(options)
        feet = { ...options.translation }
        return { id: options.id }
      },
      setKinematicCharacterVelocity: (id, velocity) => calls.velocities.push({ id, velocity }),
      setKinematicCharacterAcceleration: (id, acceleration) => calls.accelerations.push({ id, acceleration }),
      getKinematicCharacterState: () => ({
        translation: { ...feet },
        velocity: { x: 0, y: verticalVelocity, z: 0 },
        grounded,
        stepCount,
      }),
      setKinematicCharacterPosition: (id, position) => {
        calls.teleported.push({ id, position })
        feet = { ...position }
        return true
      },
    }
    controller.setPhysicsRuntime(runtime)
    return {
      runtime,
      calls,
      setState(nextState = {}) {
        if (nextState.grounded !== undefined) grounded = nextState.grounded
        if (nextState.verticalVelocity !== undefined) verticalVelocity = nextState.verticalVelocity
        if (nextState.stepCount !== undefined) stepCount = nextState.stepCount
      },
    }
  }

  it('creates a capsule character at the player feet using the configured dimensions', () => {
    const { controller, cameraRig } = createController()
    const { calls } = attachPhysics(controller, cameraRig.player)
    expect(calls.created).toHaveLength(1)
    expect(calls.created[0]).toMatchObject({
      id: 'sandbox:player',
      ownerId: 'sandbox:player',
      translation: { x: 0, y: 0, z: 0 },
      traversalProfile: expect.objectContaining({ radius: 0.55, height: 1.7 }),
    })
  })

  it('routes manual movement and gravity through the Rapier character controller', () => {
    const { controller, cameraRig, collisionWorld } = createController()
    const { calls } = attachPhysics(controller, cameraRig.player)
    controller.keys.add('w')

    controller.update(0.05)

    expect(calls.velocities).toHaveLength(1)
    expect(calls.velocities[0].velocity.x).toBeCloseTo(0)
    expect(calls.velocities[0].velocity.y).toBeCloseTo(-2)
    expect(calls.velocities[0].velocity.z).toBeCloseTo(9)
    expect(cameraRig.player).toMatchObject({ x: 0, y: 1.7, z: 0 })
    expect(collisionWorld.move).not.toHaveBeenCalled()
    expect(cameraRig.updateThirdPersonDesired).toHaveBeenCalledOnce()
  })

  it('does not end a buffered Rapier jump while the first post-launch physics step is still grounded', () => {
    const { controller, cameraRig } = createController()
    const { setState } = attachPhysics(controller, cameraRig.player)

    expect(controller.jumpPlayer()).toBe(true)
    expect(controller.jumpActive).toBe(false)
    controller.beforeFixedStep({ delta: 1 / 60 })
    controller.afterFixedStep({ delta: 1 / 60 })

    // The first physics step can still report grounded while the launch velocity
    // has only just been queued. This must not be mistaken for a completed jump.
    setState({ grounded: true, verticalVelocity: 6, stepCount: 1 })
    controller.moveWithPhysics(cameraRig.player, 0, 0, 1 / 60)
    controller.afterFixedStep({ delta: 1 / 60 })
    expect(controller.jumpActive).toBe(true)
    expect(controller.jumpWasAirborne).toBe(false)

    setState({ grounded: false, verticalVelocity: 5.5, stepCount: 2 })
    controller.moveWithPhysics(cameraRig.player, 0, 0, 1 / 60)
    controller.afterFixedStep({ delta: 1 / 60 })
    expect(controller.jumpActive).toBe(true)
    expect(controller.jumpWasAirborne).toBe(true)

    setState({ grounded: true, verticalVelocity: -1, stepCount: 3 })
    controller.moveWithPhysics(cameraRig.player, 0, 0, 1 / 60)
    controller.afterFixedStep({ delta: 1 / 60 })
    expect(controller.jumpActive).toBe(false)
    expect(controller.jumpWasAirborne).toBe(false)
  })

  it('uses fixed-step acceleration for airborne gravity instead of render-frame integration', () => {
    const { controller, cameraRig } = createController()
    const { calls, setState } = attachPhysics(controller, cameraRig.player)
    setState({ grounded: false, verticalVelocity: -1 })

    controller.update(0.05)
    expect(calls.velocities).toHaveLength(0)
    controller.beforeFixedStep({ delta: 1 / 60 })

    expect(controller.verticalVelocity).toBe(-1)
    expect(calls.accelerations.at(-1).acceleration).toEqual({ x: 0, y: -24, z: 0 })
    expect(calls.velocities.at(-1).velocity.y).toBe(-1)
  })

  it('moves navigation paths through Rapier instead of the legacy XZ solver', () => {
    const { controller, cameraRig, collisionWorld } = createController()
    const { calls } = attachPhysics(controller, cameraRig.player)
    controller.setNavigationPath([{ x: 0, z: 0 }, { x: 0, z: 2 }])

    controller.update(0.05)

    expect(calls.velocities).toHaveLength(1)
    expect(calls.velocities[0].velocity.z).toBeCloseTo(5.5)
    expect(collisionWorld.move).not.toHaveBeenCalled()
    expect(cameraRig.player.z).toBeCloseTo(0)
  })



  it('clears queued Rapier movement when player controls are disabled', () => {
    const { controller, cameraRig } = createController()
    const { calls } = attachPhysics(controller, cameraRig.player)
    controller.setMovementEnabled(false)
    expect(calls.velocities.at(-1)).toEqual({
      id: 'sandbox:player',
      velocity: { x: 0, y: 0, z: 0 },
    })
  })

  it('synchronizes teleports and dimension changes with the Rapier capsule', () => {
    const { controller, cameraRig } = createController()
    cameraRig.player.set = function (x, y, z) { Object.assign(this, { x, y, z }) }
    const { calls } = attachPhysics(controller, cameraRig.player)
    controller.teleportPlayer({ x: 4, y: 3.2, z: 6 })
    expect(calls.teleported.at(-1).id).toBe('sandbox:player')
    expect(calls.teleported.at(-1).position.x).toBeCloseTo(4)
    expect(calls.teleported.at(-1).position.y).toBeCloseTo(1.5)
    expect(calls.teleported.at(-1).position.z).toBeCloseTo(6)

    controller.setPlayerDimensions({ eyeHeight: 1.9, colliderRadius: 0.32 })
    expect(calls.created).toHaveLength(1)
    expect(controller.traversalProfile).toMatchObject({ radius: 0.55, height: 1.7 })
    expect(cameraRig.player.y).toBeCloseTo(3.2)
  })
})


describe('InputController jump and stuck reset', () => {
  it('starts a jump with the shared profile and rejects a second jump while airborne', () => {
    const { controller, cameraRig } = createController()
    expect(controller.jumpPlayer()).toBe(true)
    expect(controller.verticalVelocity).toBeCloseTo(Math.sqrt(2 * controller.gravity * controller.traversalProfile.jumpHeight))
    expect(controller.jumpPlayer()).toBe(false)
    controller.updateVerticalMotion(cameraRig.player, 0.05)
    expect(cameraRig.player.y).toBeGreaterThan(controller.playerEyeHeight)
    for (let step = 0; step < 80; step += 1) controller.updateVerticalMotion(cameraRig.player, 0.05)
    expect(controller.grounded).toBe(true)
    expect(controller.jumpPlayer()).toBe(true)
  })

  it('buffers a jump briefly until the character becomes grounded', () => {
    const { controller } = createController()
    controller.grounded = false
    controller.coyoteTimeRemaining = 0

    expect(controller.jumpPlayer()).toBe(true)
    expect(controller.jumpActive).toBe(false)
    expect(controller.jumpBufferRemaining).toBeGreaterThan(0)

    controller.updateJumpInputWindow(0.016, true)

    expect(controller.jumpActive).toBe(true)
    expect(controller.jumpBufferRemaining).toBe(0)
  })

  it('allows a jump during the short coyote-time window after leaving a ledge', () => {
    const { controller } = createController()
    controller.grounded = false
    controller.coyoteTimeRemaining = 0.08

    expect(controller.jumpPlayer()).toBe(true)
    expect(controller.jumpActive).toBe(true)
    expect(controller.coyoteTimeRemaining).toBe(0)
  })

  it('uses Space to jump and R to return to the recorded spawn point', () => {
    const { controller, cameraRig } = createController()
    cameraRig.player.set = function (x, y, z) { Object.assign(this, { x, y, z }) }
    controller.spawnPosition = { x: 3, y: 1.7, z: -4 }
    const jumpPreventDefault = vi.fn()
    controller.onKeyDown({ key: ' ', code: 'Space', target: { tagName: 'CANVAS' }, preventDefault: jumpPreventDefault })
    expect(jumpPreventDefault).toHaveBeenCalledOnce()
    expect(controller.jumpActive).toBe(true)
    const preventDefault = vi.fn()
    controller.onKeyDown({ key: 'r', target: { tagName: 'CANVAS' }, preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(cameraRig.player).toMatchObject({ x: 3, y: 1.7, z: -4 })
    expect(controller.jumpActive).toBe(false)
    expect(controller.verticalVelocity).toBe(0)
    expect(controller.navigationPath).toBeNull()
  })
})
