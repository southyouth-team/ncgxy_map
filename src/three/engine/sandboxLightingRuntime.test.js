import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyWorldStateBindings } from './worldStateRuntime.js'
import { applySandboxLightingState } from './sandboxLightingRuntime.js'
import { executeSandboxInteractionAction } from './sandboxActionRuntime.js'
import { findNearestSandboxInteraction } from './sandboxInteractionRuntime.js'

describe('applySandboxLightingState', () => {
  it('updates actual Three.js light intensity while generic state runtime leaves lights to Lighting Runtime', () => {
    const root = new THREE.Group()
    const light = new THREE.PointLight('#ffd98a', 2.2, 11, 1.8)
    light.userData.componentId = 'ceiling-point-light'
    light.userData.stateBinding = {
      key: 'enabled',
      property: 'intensity',
      enabledValue: 2.2,
      disabledValue: 0,
    }
    root.add(light)

    expect(applyWorldStateBindings(root, { enabled: false })).toBe(0)
    expect(light.intensity).toBe(2.2)
    expect(applySandboxLightingState(root, { enabled: false })).toBe(1)
    expect(light.intensity).toBe(0)
    expect(applySandboxLightingState(root, { enabled: true })).toBe(1)
    expect(light.intensity).toBe(2.2)
  })

  it('ignores missing state keys and invalid light intensities', () => {
    const root = new THREE.Group()
    const light = new THREE.PointLight('#ffffff', 1)
    light.userData.stateBinding = { key: 'enabled', property: 'intensity', enabledValue: Number.NaN }
    root.add(light)

    expect(applySandboxLightingState(root, {})).toBe(0)
    expect(applySandboxLightingState(root, { enabled: true })).toBe(0)
    expect(light.intensity).toBe(1)
  })
  it('closes proximity interaction through target state to the real light and bulb', () => {
    const lamp = new THREE.Group()
    lamp.userData.worldState = { enabled: true }
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.2),
      new THREE.MeshStandardMaterial({ emissive: '#ffffff', emissiveIntensity: 1.4 }),
    )
    bulb.userData.stateBinding = { key: 'enabled', property: 'emissiveIntensity', enabledValue: 1.4, disabledValue: 0 }
    const light = new THREE.PointLight('#ffd98a', 2.2, 11, 1.8)
    light.userData.componentId = 'demo-point-light'
    light.userData.stateBinding = { key: 'enabled', property: 'intensity', enabledValue: 2.2, disabledValue: 0 }
    lamp.add(bulb, light)

    const switchRoot = new THREE.Group()
    const button = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), new THREE.MeshBasicMaterial())
    button.userData.componentId = 'wall-switch-button'
    button.userData.interactionConfig = {
      action: 'toggle',
      targetId: 'lamp-instance',
      stateKey: 'enabled',
      radius: 4.8,
    }
    switchRoot.add(button)
    const models = new Map([['switch-instance', switchRoot], ['lamp-instance', lamp]])

    const pressSwitch = () => {
      const nearby = findNearestSandboxInteraction(THREE, models, { x: 0, z: 0 })
      expect(nearby?.targetPartId).toBe('wall-switch-button')
      const target = models.get(nearby.config.targetId)
      const action = executeSandboxInteractionAction({ model: target, config: nearby.config })
      expect(action.ok).toBe(true)
      target.userData.worldState = { ...target.userData.worldState, ...action.statePatch }
      applyWorldStateBindings(target, target.userData.worldState)
      applySandboxLightingState(target, target.userData.worldState)
    }

    pressSwitch()
    expect(lamp.userData.worldState.enabled).toBe(false)
    expect(light.intensity).toBe(0)
    expect(bulb.material.emissiveIntensity).toBe(0)

    pressSwitch()
    expect(lamp.userData.worldState.enabled).toBe(true)
    expect(light.intensity).toBe(2.2)
    expect(bulb.material.emissiveIntensity).toBe(1.4)
  })

})
