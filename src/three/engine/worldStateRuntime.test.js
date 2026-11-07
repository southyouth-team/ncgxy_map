import { describe, expect, it } from 'vitest'
import { applyEnvironmentBindings, applyWorldStateBindings } from './worldStateRuntime.js'

function makeRoot(objects) {
  return {
    traverse(callback) {
      objects.forEach(callback)
    },
  }
}

describe('applyWorldStateBindings', () => {
  it('toggles visibility for bound runtime objects', () => {
    const light = { visible: true, userData: { stateBinding: { key: 'enabled', property: 'visible' } } }
    const root = makeRoot([light])

    expect(applyWorldStateBindings(root, { enabled: false })).toBe(1)
    expect(light.visible).toBe(false)
    expect(applyWorldStateBindings(root, { enabled: true })).toBe(1)
    expect(light.visible).toBe(true)
  })

  it('maps boolean state to light intensity', () => {
    const light = {
      intensity: 2.2,
      userData: { stateBinding: { key: 'enabled', property: 'intensity', enabledValue: 2.2 } },
    }

    applyWorldStateBindings(makeRoot([light]), { enabled: false })
    expect(light.intensity).toBe(0)
    applyWorldStateBindings(makeRoot([light]), { enabled: true })
    expect(light.intensity).toBe(2.2)
  })

  it('maps boolean state to emissive intensity for one or many materials', () => {
    const mesh = {
      material: [{ emissiveIntensity: 1.4 }, { emissiveIntensity: 0.8 }],
      userData: { stateBinding: { key: 'enabled', property: 'emissiveIntensity', enabledValue: 1.4 } },
    }

    applyWorldStateBindings(makeRoot([mesh]), { enabled: false })
    expect(mesh.material.map(material => material.emissiveIntensity)).toEqual([0, 0])
    applyWorldStateBindings(makeRoot([mesh]), { enabled: true })
    expect(mesh.material.map(material => material.emissiveIntensity)).toEqual([1.4, 1.4])
  })

  it('ignores missing state values and unsupported bindings', () => {
    const object = {
      visible: true,
      userData: { stateBinding: { key: 'active', property: 'unsupported' } },
    }

    expect(applyWorldStateBindings(makeRoot([object]), {})).toBe(0)
    expect(applyWorldStateBindings(makeRoot([object]), { active: false })).toBe(0)
    expect(object.visible).toBe(true)
  })
})


describe('applyEnvironmentBindings', () => {
  it('applies global environment values to AI-declared component bindings', () => {
    const light = {
      intensity: 2.4,
      userData: { componentId: 'ceiling-light' },
    }
    const root = makeRoot([light])
    root.userData = {
      proceduralModelEnvironmentBindings: [{
        targetPartId: 'ceiling-light',
        variable: 'lighting.artificial.enabled',
        property: 'intensity',
        enabledValue: 2.4,
        disabledValue: 0,
        defaultValue: true,
      }],
    }

    expect(applyEnvironmentBindings(root, { 'lighting.artificial.enabled': false })).toBe(1)
    expect(light.intensity).toBe(0)
    expect(applyEnvironmentBindings(root, { 'lighting.artificial.enabled': true })).toBe(1)
    expect(light.intensity).toBe(2.4)
  })

  it('gives explicit per-model overrides precedence over global values', () => {
    const light = { visible: true, userData: { componentId: 'room-light' } }
    const root = makeRoot([light])
    root.userData = {
      proceduralModelEnvironmentBindings: [{
        targetPartId: 'room-light',
        variable: 'lighting.artificial.enabled',
        property: 'visible',
      }],
      environmentOverrides: { 'lighting.artificial.enabled': true },
    }

    applyEnvironmentBindings(root, { 'lighting.artificial.enabled': false })
    expect(light.visible).toBe(true)
    root.userData.environmentOverrides['lighting.artificial.enabled'] = false
    applyEnvironmentBindings(root, { 'lighting.artificial.enabled': true })
    expect(light.visible).toBe(false)
  })

  it('ignores unknown targets and unsupported runtime properties', () => {
    const object = { visible: true, userData: { componentId: 'part-a' } }
    const root = makeRoot([object])
    root.userData = {
      proceduralModelEnvironmentBindings: [
        { targetPartId: 'missing', variable: 'lighting.artificial.enabled', property: 'visible' },
        { targetPartId: 'part-a', variable: 'lighting.artificial.enabled', property: 'executeCode' },
      ],
    }
    expect(applyEnvironmentBindings(root, { 'lighting.artificial.enabled': false })).toBe(0)
    expect(object.visible).toBe(true)
  })
})
