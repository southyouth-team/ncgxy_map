import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { executeSandboxInteractionAction } from './sandboxActionRuntime.js'

describe('executeSandboxInteractionAction', () => {
  it('keeps toggle-state compatibility', () => {
    const model = new THREE.Group()
    model.userData.worldState = { doorOpen: false }
    expect(executeSandboxInteractionAction({ model, config: { action: 'toggle-state', stateKey: 'doorOpen' } }))
      .toMatchObject({ ok: true, action: 'toggle', stateKey: 'doorOpen', statePatch: { doorOpen: true } })
  })
  it('sets an explicit instance state value', () => {
    const model = new THREE.Group()
    expect(executeSandboxInteractionAction({ model, config: { action: 'set', stateKey: 'powered', value: true } }).statePatch)
      .toEqual({ powered: true })
  })
  it('rotates only the declared stable target part using local radians', () => {
    const model = new THREE.Group(), hinge = new THREE.Group()
    hinge.userData.componentId = 'hinge'; model.add(hinge)
    const result = executeSandboxInteractionAction({ model, sourcePartId: 'hinge', config: { action: 'rotate', rotation: { y: -Math.PI / 2 } } })
    expect(result.ok).toBe(true); expect(hinge.rotation.y).toBeCloseTo(-Math.PI / 2)
  })
  it('translates the source part by a local-space offset', () => {
    const model = new THREE.Group(), drawer = new THREE.Group()
    drawer.userData.componentId = 'drawer'; model.add(drawer)
    executeSandboxInteractionAction({ model, sourcePartId: 'drawer', config: { action: 'translate', offset: { x: 0.25, z: -0.5 } } })
    expect(drawer.position.toArray()).toEqual([0.25, 0, -0.5])
  })
  it('supports an explicit target part in the same model', () => {
    const model = new THREE.Group(), button = new THREE.Group(), lamp = new THREE.Group()
    button.userData.componentId = 'button'; lamp.userData.componentId = 'lamp'; model.add(button, lamp)
    const result = executeSandboxInteractionAction({ model, sourcePartId: 'button', config: { action: 'rotate', targetPartId: 'lamp', rotation: { y: 0.5 } } })
    expect(result.ok).toBe(true); expect(lamp.rotation.y).toBeCloseTo(0.5); expect(button.rotation.y).toBe(0)
  })
  it('rejects unknown actions and non-finite vectors without mutation', () => {
    const model = new THREE.Group(), part = new THREE.Group()
    part.userData.componentId = 'part'; model.add(part)
    expect(executeSandboxInteractionAction({ model, config: { action: 'explode' } }).ok).toBe(false)
    expect(executeSandboxInteractionAction({ model, sourcePartId: 'part', config: { action: 'translate', offset: { x: Number.NaN } } }).ok).toBe(false)
    expect(part.position.x).toBe(0)
  })
  it('rejects non-primitive or non-finite set values', () => {
    const model = new THREE.Group()
    expect(executeSandboxInteractionAction({ model, config: { action: 'set', stateKey: 'payload', value: { unsafe: true } } }).reason)
      .toBe('invalid-state-value')
    expect(executeSandboxInteractionAction({ model, config: { action: 'set', stateKey: 'amount', value: Number.POSITIVE_INFINITY } }).reason)
      .toBe('invalid-state-value')
  })
  it('accepts enter only when the model declares the requested interior entry point', () => {
    const model = new THREE.Group()
    model.userData.proceduralModelCapabilityManifest = { capabilities: { interior: { entryPoints: [{ id: 'ground-floor', targetPartId: 'spawn' }] } } }
    expect(executeSandboxInteractionAction({ model, config: { action: 'enter', entryPointId: 'ground-floor' } }))
      .toMatchObject({ ok: true, action: 'enter', entryPointId: 'ground-floor' })
    expect(executeSandboxInteractionAction({ model, config: { action: 'enter', entryPointId: 'unknown' } }).ok).toBe(false)
  })
  it('routes exit to the engine transition handler', () => {
    const model = new THREE.Group()
    expect(executeSandboxInteractionAction({ model, config: { action: 'exit' } }))
      .toMatchObject({ ok: true, action: 'exit' })
  })
  it('rejects missing targets and state keys', () => {
    const model = new THREE.Group()
    expect(executeSandboxInteractionAction({ model, sourcePartId: 'missing', config: { action: 'rotate', rotation: { y: 1 } } }).reason).toBe('target-part-not-found')
    expect(executeSandboxInteractionAction({ model, config: { action: 'toggle' } }).reason).toBe('invalid-state-key')
  })
})
