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
