import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { findNearestSandboxInteraction } from './sandboxInteractionRuntime.js'

describe('findNearestSandboxInteraction', () => {
  it('resolves a part-level door interaction to its owning sandbox model', () => {
    const model = new THREE.Group()
    model.name = 'Cabin'
    model.position.set(10, 0, 5)
    model.userData.interactionRadius = 5
    const door = new THREE.Group()
    door.name = 'Front Door'
    door.userData.componentId = 'front-door'
    door.userData.interactionConfig = {
      action: 'toggle-state',
      stateKey: 'doorOpen',
      radius: 2.5,
      prompt: '靠近门，按 E 开门或关门',
    }
    door.position.set(1, 0, 0)
    model.add(door)

    const result = findNearestSandboxInteraction(THREE, new Map([['sandbox_1', model]]), { x: 11.5, z: 5 })

    expect(result).toMatchObject({
      id: 'sandbox_1',
      name: 'Front Door',
      modelName: 'Cabin',
      targetPartId: 'front-door',
      config: { action: 'toggle-state', stateKey: 'doorOpen' },
    })
  })

  it('preserves legacy model-root interaction fallback', () => {
    const model = new THREE.Group()
    model.name = 'Lamp Switch'
    model.position.set(2, 0, 3)
    model.userData.interactionRadius = 3

    const result = findNearestSandboxInteraction(THREE, new Map([['sandbox_2', model]]), { x: 3, z: 3 })

    expect(result).toMatchObject({ id: 'sandbox_2', name: 'Lamp Switch', targetPartId: null, config: {} })
  })

  it('does not return an interaction outside its declared radius', () => {
    const model = new THREE.Group()
    const part = new THREE.Group()
    part.userData.componentId = 'door'
    part.userData.interactionConfig = { action: 'toggle-state', stateKey: 'doorOpen', radius: 1 }
    model.add(part)

    expect(findNearestSandboxInteraction(THREE, new Map([['sandbox_3', model]]), { x: 2, z: 0 })).toBeNull()
  })
})
