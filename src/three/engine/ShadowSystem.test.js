import { describe, expect, it } from 'vitest'
import { ShadowSystem } from './ShadowSystem.js'

describe('ShadowSystem', () => {
  it('keeps automatic shadow updates disabled and invalidates cached shadows on demand', () => {
    const renderer = { shadowMap: { enabled: false, autoUpdate: true, needsUpdate: false, type: null } }
    const shadows = new ShadowSystem(renderer)

    shadows.configure({ enabled: true, type: 'soft' })
    expect(renderer.shadowMap.enabled).toBe(true)
    expect(renderer.shadowMap.autoUpdate).toBe(false)
    expect(renderer.shadowMap.type).toBe('soft')
    expect(renderer.shadowMap.needsUpdate).toBe(true)

    renderer.shadowMap.needsUpdate = false
    expect(shadows.invalidateDynamic()).toBe(true)
    expect(renderer.shadowMap.needsUpdate).toBe(true)
    expect(shadows.getDiagnostics().dynamicInvalidations).toBe(1)
  })

  it('does not schedule shadow work when disabled or disposed', () => {
    const renderer = { shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false } }
    const shadows = new ShadowSystem(renderer)

    expect(shadows.invalidateStatic()).toBe(false)
    expect(renderer.shadowMap.needsUpdate).toBe(false)

    shadows.dispose()
    expect(shadows.invalidateDynamic()).toBe(false)
  })
})
