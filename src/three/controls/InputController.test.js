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

  function groundedController(hits) {
    const THREE = { Vector3, Raycaster, Matrix3 }
    const rig = { player: { x: 2, y: 1.7, z: 3 } }
    const collision = { supportSurfaces: [{ supportsStanding: true, meshes: [{ matrixWorld: {} }] }] }
    const controller = new InputController(THREE, {}, rig, null, collision)
    controller.groundRaycaster.hits = hits
    return { controller, rig }
  }

  it('sets player eye height from the nearest declared mesh top', () => {
    const { controller, rig } = groundedController([{
      face: { normal: normal(1) }, object: { matrixWorld: {} },
      point: { x: 2, y: 2.4, z: 3 },
    }])
    expect(controller.resolvePlayerGroundHeight(rig.player)).toBeCloseTo(4.1)
    expect(controller.groundRaycaster.far).toBe(3)
  })

  it('ignores surfaces steeper than the configured walkable slope', () => {
    const { controller, rig } = groundedController([{
      face: { normal: normal(0.2) }, object: { matrixWorld: {} },
      point: { x: 2, y: 2.4, z: 3 },
    }])
    expect(controller.resolvePlayerGroundHeight(rig.player)).toBe(1.7)
  })

  it('keeps the default ground height when no declared mesh is under the player', () => {
    const { controller, rig } = groundedController([])
    expect(controller.resolvePlayerGroundHeight(rig.player)).toBe(1.7)
  })
})
