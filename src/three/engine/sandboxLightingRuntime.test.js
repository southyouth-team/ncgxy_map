import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyWorldStateBindings } from './worldStateRuntime.js'
import { applySandboxLightingState } from './sandboxLightingRuntime.js'

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
})
