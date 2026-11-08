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
  it('uses stable instance and component IDs instead of display or Mesh names', () => {
    const model = new THREE.Group()
    model.name = 'display-name-is-not-an-id'
    model.position.set(3, 0, 4)
    const button = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), new THREE.MeshBasicMaterial())
    button.name = 'Mesh_001'
    button.userData.componentId = 'wall-switch-button'
    button.userData.interactionConfig = {
      action: 'toggle',
      targetId: 'lamp-instance-9',
      stateKey: 'enabled',
      radius: 4.8,
    }
    model.add(button)

    const models = new Map([['switch-instance-1', model]])
    const nearest = findNearestSandboxInteraction(THREE, models, { x: 3, z: 4 })
    expect(nearest).toMatchObject({
      id: 'switch-instance-1',
      targetPartId: 'wall-switch-button',
      config: { targetId: 'lamp-instance-9', stateKey: 'enabled' },
    })
    expect(findNearestSandboxInteraction(THREE, models, { x: 30, z: 40 })).toBeNull()
  })

  it('preserves a stable cross-object target relation in Object3D saves', () => {
    const model = new THREE.Group()
    const button = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), new THREE.MeshBasicMaterial())
    button.userData.componentId = 'wall-switch-button'
    button.userData.interactionConfig = { action: 'toggle', targetId: 'lamp-instance-9', stateKey: 'enabled' }
    model.add(button)

    const restored = new THREE.ObjectLoader().parse(model.toJSON())
    let restoredButton = null
    restored.traverse(object => {
      if (object.userData?.componentId === 'wall-switch-button') restoredButton = object
    })
    expect(restoredButton?.userData?.interactionConfig?.targetId).toBe('lamp-instance-9')
    expect(restoredButton?.userData?.interactionConfig?.stateKey).toBe('enabled')
  })

})
