import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createModelAnimationRuntime,
  createSandboxEnvironmentSnapshot,
} from './modelAnimationRuntime.js'

function createModel(source, id = 'model-1') {
  const root = new THREE.Group()
  const target = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  target.name = 'animated-target'
  root.add(target)
  root.userData.proceduralModelSource = source
  root.userData.sandboxModelId = id
  root.userData.proceduralModelParameterValues = { amplitude: 0.2 }
  root.userData.worldState = { enabled: true }
  return root
}

const TRANSFORM_SOURCE = /* js */`
  export function createModelAnimation(THREE, model, context) {
    const target = model.getObjectByName('animated-target')
    model.userData.initialContext = context
    return {
      update(frame) {
        target.rotation.y = frame.time + frame.environment.wind.speed
        model.userData.lastFrame = frame
      },
      dispose() {
        model.userData.disposeCount = (model.userData.disposeCount || 0) + 1
      },
    }
  }
`

describe('createSandboxEnvironmentSnapshot', () => {
  it('normalizes and freezes the existing sandbox environment', () => {
    const snapshot = createSandboxEnvironmentSnapshot({
      time: 22,
      weather: 'rain',
      wind: 2,
      windDirection: { x: 3, z: 4 },
      artificialLightingEnabled: false,
    })

    expect(snapshot).toEqual({
      time: { hour: 22, period: 'night' },
      weather: { type: 'rain', rainIntensity: 1 },
      wind: { speed: 1, direction: { x: 0.6, z: 0.8 } },
      lighting: { artificialEnabled: false },
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.wind)).toBe(true)
    expect(Object.isFrozen(snapshot.wind.direction)).toBe(true)
  })

  it('preserves the previous wind direction for partial and invalid updates', () => {
    const previous = createSandboxEnvironmentSnapshot({
      wind: 0.2,
      windDirection: { x: 0, z: 2 },
    })

    const partial = createSandboxEnvironmentSnapshot({ wind: 0.8 }, previous)
    const invalid = createSandboxEnvironmentSnapshot({
      windDirection: { x: 0, z: 0 },
    }, previous)

    expect(partial.wind.direction).toEqual({ x: 0, z: 1 })
    expect(invalid.wind.direction).toEqual({ x: 0, z: 1 })
    expect(Number.isFinite(invalid.wind.direction.x)).toBe(true)
    expect(Number.isFinite(invalid.wind.direction.z)).toBe(true)
  })

  it('uses finite defaults and survives an idempotent snapshot pass', () => {
    const snapshot = createSandboxEnvironmentSnapshot({
      time: Number.NaN,
      weather: 'storm',
      wind: Number.NaN,
      windDirection: { x: 0, z: 0 },
    })

    expect(snapshot.time).toEqual({ hour: 14, period: 'day' })
    expect(snapshot.weather).toEqual({ type: 'clear', rainIntensity: 0 })
    expect(snapshot.wind).toEqual({ speed: 0, direction: { x: 1, z: 0 } })
    expect(createSandboxEnvironmentSnapshot(snapshot)).toEqual(snapshot)
  })
})

describe('createModelAnimationRuntime', () => {
  it('recreates AI behavior from source and supplies current values every frame', async () => {
    const runtime = createModelAnimationRuntime()
    const model = createModel(TRANSFORM_SOURCE)
    const initialEnvironment = createSandboxEnvironmentSnapshot({ wind: 0.1, time: 10 })

    await runtime.register('model-1', model, initialEnvironment)
    expect(model.userData.initialContext.environment).toBe(initialEnvironment)

    model.userData.proceduralModelParameterValues.amplitude = 0.8
    model.userData.worldState.enabled = false
    const environment = createSandboxEnvironmentSnapshot({ wind: 0.65, weather: 'rain' })
    runtime.update(2, 1 / 60, environment)

    const target = model.getObjectByName('animated-target')
    expect(target.rotation.y).toBeCloseTo(2.65)
    expect(model.userData.lastFrame).toMatchObject({
      time: 2,
      deltaTime: 1 / 60,
      modelId: 'model-1',
      parameters: { amplitude: 0.8 },
      worldState: { enabled: false },
      environment,
    })
    expect(model.userData.lastFrame.parameters).not.toBe(model.userData.proceduralModelParameterValues)
    expect(model.userData.lastFrame.worldState).not.toBe(model.userData.worldState)
    expect(Object.isFrozen(model.userData.lastFrame.parameters)).toBe(true)
    expect(runtime.hasActiveAnimations()).toBe(true)

    runtime.dispose()
    expect(model.userData.disposeCount).toBe(1)
  })

  it('keeps models without an animation export inert', async () => {
    const runtime = createModelAnimationRuntime()
    const model = createModel('export function createModel() { return null }')

    await runtime.register('model-1', model)
    runtime.update(1, 1 / 60, {})

    expect(runtime.hasActiveAnimations()).toBe(false)
    expect(model.userData.lastFrame).toBeUndefined()
    runtime.dispose()
  })

  it('isolates creation and update failures without disabling peer models', async () => {
    const errors = []
    const runtime = createModelAnimationRuntime({ onError: (error, detail) => errors.push({ error, detail }) })
    const healthy = createModel(TRANSFORM_SOURCE, 'healthy')
    const badCreation = createModel(`export function createModelAnimation() { throw new Error('creation failed') }`, 'bad-creation')
    const badUpdate = createModel(`
      export function createModelAnimation(THREE, model) {
        return { update() { throw new Error('update failed') }, dispose() { model.userData.disposed = true } }
      }
    `, 'bad-update')

    await runtime.register('healthy', healthy)
    await runtime.register('bad-creation', badCreation)
    await runtime.register('bad-update', badUpdate)
    runtime.update(1, 1 / 60, {})
    runtime.update(2, 1 / 60, {})

    expect(healthy.userData.lastFrame.time).toBe(2)
    expect(badUpdate.userData.disposed).toBe(true)
    expect(errors.filter(item => item.detail.phase === 'create')).toHaveLength(1)
    expect(errors.filter(item => item.detail.phase === 'update')).toHaveLength(1)
    expect(errors.find(item => item.detail.phase === 'update').error.message).toBe('update failed')
    expect(runtime.hasActiveAnimations()).toBe(true)
    runtime.dispose()
  })

  it('disposes an asynchronous controller when its model is removed before creation finishes', async () => {
    const runtime = createModelAnimationRuntime()
    let release
    let markStarted
    const started = new Promise(resolve => { markStarted = resolve })
    const model = createModel(`
      export async function createModelAnimation(THREE, model) {
        await model.userData.animationGate()
        return { update() {}, dispose() { model.userData.disposed = true } }
      }
    `)
    model.userData.animationGate = () => {
      markStarted()
      return new Promise(resolve => { release = resolve })
    }

    const pending = runtime.register('model-1', model)
    await started
    runtime.remove('model-1')
    release()
    await pending

    expect(model.userData.disposed).toBe(true)
    expect(runtime.hasActiveAnimations()).toBe(false)
    runtime.dispose()
  })

  it('does not let a stale async registration dispose or overwrite its replacement', async () => {
    const runtime = createModelAnimationRuntime()
    let release
    let markStarted
    const started = new Promise(resolve => { markStarted = resolve })
    const oldModel = createModel(`
      export async function createModelAnimation(THREE, model) {
        await model.userData.animationGate()
        return { update() {}, dispose() { model.userData.staleDisposed = true } }
      }
    `, 'old')
    oldModel.userData.animationGate = () => {
      markStarted()
      return new Promise(resolve => { release = resolve })
    }
    const replacement = createModel(TRANSFORM_SOURCE, 'replacement')

    const oldPending = runtime.register('same-id', oldModel)
    await started
    await runtime.register('same-id', replacement)
    release()
    await oldPending
    runtime.update(3, 1 / 60, {})

    expect(oldModel.userData.staleDisposed).toBe(true)
    expect(replacement.userData.lastFrame.time).toBe(3)
    expect(replacement.userData.disposeCount).toBeUndefined()
    runtime.dispose()
    expect(replacement.userData.disposeCount).toBe(1)
  })

  it('serializes the pre-animation scene with current instance transform and host state', async () => {
    const runtime = createModelAnimationRuntime()
    const model = createModel(/* js */`
      export function createModelAnimation(THREE, model) {
        const particles = new THREE.Points(
          new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0], 3)),
          new THREE.PointsMaterial(),
        )
        particles.name = 'generated-particles'
        model.add(particles)
        const target = model.getObjectByName('animated-target')
        return { update(frame) { target.rotation.y = frame.time } }
      }
    `)
    await runtime.register('model-1', model)
    runtime.update(2.5, 1 / 60, {})
    model.position.set(4, 1, -3)
    model.rotation.y = 0.4
    model.scale.set(2, 2, 2)
    model.userData.worldState = { enabled: false }
    model.userData.proceduralModelParameterValues = { amplitude: 0.9 }
    model.userData.proceduralModelConfig = { updatedAt: 'after-registration' }
    model.userData.proceduralModelCapabilityControlDocument = {
      overrides: [{ capabilityId: 'spatial.collider.main.blocksMovement' }],
    }
    model.userData.lastFrame = { time: 2.5 }

    const serialized = runtime.serializeModel('model-1')
    const restored = new THREE.ObjectLoader().parse(serialized)

    expect(restored.getObjectByName('generated-particles')).toBeUndefined()
    expect(restored.getObjectByName('animated-target').rotation.y).toBe(0)
    expect(restored.position.toArray()).toEqual([4, 1, -3])
    expect(restored.rotation.y).toBeCloseTo(0.4)
    expect(restored.scale.toArray()).toEqual([2, 2, 2])
    expect(restored.userData.worldState).toEqual({ enabled: false })
    expect(restored.userData.proceduralModelParameterValues).toEqual({ amplitude: 0.9 })
    expect(restored.userData.proceduralModelConfig).toEqual({ updatedAt: 'after-registration' })
    expect(restored.userData.proceduralModelCapabilityControlDocument.overrides).toHaveLength(1)
    expect(restored.userData.lastFrame).toBeUndefined()
    expect(restored.userData.proceduralModelSource).toBe(model.userData.proceduralModelSource)
    runtime.dispose()
  })

  it('can serialize a stable baseline while asynchronous controller creation is pending', async () => {
    const runtime = createModelAnimationRuntime()
    let release
    let markStarted
    const started = new Promise(resolve => { markStarted = resolve })
    const model = createModel(/* js */`
      export async function createModelAnimation(THREE, model) {
        await model.userData.animationGate()
        const particles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial())
        particles.name = 'late-particles'
        model.add(particles)
        return { update() {} }
      }
    `)
    model.userData.animationGate = () => {
      markStarted()
      return new Promise(resolve => { release = resolve })
    }

    const pending = runtime.register('model-1', model)
    await started
    const pendingSave = runtime.serializeModel('model-1')
    expect(pendingSave.object.children.some(child => child.name === 'late-particles')).toBe(false)
    release()
    await pending

    const activeSave = runtime.serializeModel('model-1')
    expect(activeSave.object.children.some(child => child.name === 'late-particles')).toBe(false)
    expect(model.getObjectByName('late-particles')).toBeTruthy()
    runtime.dispose()
  })

  it.each(['collider', 'support surface'])('rejects an animated ancestor of a static %s', async kind => {
    const errors = []
    const runtime = createModelAnimationRuntime({ onError: (error, detail) => errors.push({ error, detail }) })
    const model = createModel(/* js */`
      export function createModelAnimation(THREE, model) {
        model.userData.animationCreated = true
        return { update() {} }
      }
    `)
    const target = model.getObjectByName('animated-target')
    target.userData.componentId = 'moving-assembly'
    const solid = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    solid.userData.componentId = 'solid-child'
    target.add(solid)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: {
        visual: { animations: [{ id: 'motion', targetPartId: 'moving-assembly' }] },
        spatial: kind === 'collider'
          ? { colliders: [{ id: 'solid', targetPartId: 'solid-child', shape: 'box' }] }
          : { surfaces: [{ id: 'solid', targetPartId: 'solid-child', shape: 'mesh', walkable: true }] },
      },
    }

    await runtime.register('model-1', model)
    runtime.update(1, 1 / 60, {})

    expect(model.userData.animationCreated).toBeUndefined()
    expect(runtime.hasActiveAnimations()).toBe(false)
    expect(errors).toHaveLength(1)
    expect(errors[0].detail.phase).toBe('create')
    expect(errors[0].error.message).toContain('静态物理')
    runtime.dispose()
  })

  it('allows animation targets that are separate from static physics parts', async () => {
    const runtime = createModelAnimationRuntime()
    const model = createModel(TRANSFORM_SOURCE)
    model.getObjectByName('animated-target').userData.componentId = 'visual-only'
    const solid = new THREE.Group()
    solid.userData.componentId = 'solid-base'
    model.add(solid)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: {
        visual: { animations: [{ id: 'motion', targetPartId: 'visual-only' }] },
        spatial: { colliders: [{ id: 'base', targetPartId: 'solid-base', shape: 'box' }] },
      },
    }

    await runtime.register('model-1', model)
    runtime.update(1, 1 / 60, {})

    expect(runtime.hasActiveAnimations()).toBe(true)
    expect(model.userData.lastFrame.time).toBe(1)
    runtime.dispose()
  })

  it('isolates a controller whose update rejects asynchronously without disabling peer models', async () => {
    const errors = []
    const runtime = createModelAnimationRuntime({ onError: (error, detail) => errors.push({ error, detail }) })
    const healthy = createModel(TRANSFORM_SOURCE, 'healthy')
    const asyncBad = createModel(/* js */`
      export function createModelAnimation(THREE, model) {
        return {
          async update() {
            model.userData.updateCalls = (model.userData.updateCalls || 0) + 1
            throw new Error('async update failed')
          },
        }
      }
    `, 'async-bad')

    await runtime.register('healthy', healthy)
    await runtime.register('async-bad', asyncBad)
    runtime.update(1, 1 / 60, {})
    await Promise.resolve()
    await Promise.resolve()

    const updateErrors = errors.filter(item => item.detail.phase === 'update')
    expect(updateErrors).toHaveLength(1)
    expect(updateErrors[0].error.message).toBe('async update failed')
    expect(asyncBad.userData.updateCalls).toBe(1)

    runtime.update(2, 1 / 60, {})
    await Promise.resolve()
    expect(asyncBad.userData.updateCalls).toBe(1)
    expect(healthy.userData.lastFrame.time).toBe(2)
    expect(runtime.hasActiveAnimations()).toBe(true)
    runtime.dispose()
  })

  it('notifies active transitions and disposes entries exactly once', async () => {    const transitions = []
    const runtime = createModelAnimationRuntime({ onActiveChange: active => transitions.push(active) })
    const model = createModel(TRANSFORM_SOURCE)

    await runtime.register('model-1', model)
    runtime.remove('model-1')
    runtime.remove('model-1')
    runtime.dispose()
    runtime.dispose()

    expect(transitions).toEqual([true, false])
    expect(model.userData.disposeCount).toBe(1)
  })
})
