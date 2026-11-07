import { describe, expect, it } from 'vitest'
import { normalizeModelCapabilityManifest } from './modelCapabilityManifest.js'

describe('normalizeModelCapabilityManifest', () => {
  it('creates a v1 manifest from legacy model metadata', () => {
    const parameters = [{ id: 'height', type: 'number' }]
    const bindings = [{ id: 'lamp', variable: 'lighting.artificial.enabled' }]
    expect(normalizeModelCapabilityManifest(null, parameters, bindings)).toEqual({
      version: 1,
      parameters,
      capabilities: { environmentBindings: bindings },
    })
  })

  it('preserves unknown capability sections and manifest parameters', () => {
    const manifest = {
      version: 3,
      parameters: [{ id: 'floors', type: 'number' }],
      capabilities: { customPhysics: { shape: 'capsule' }, interior: { floors: [] } },
    }
    expect(normalizeModelCapabilityManifest(manifest)).toEqual(manifest)
  })

  it('keeps an explicitly empty environment binding list', () => {
    const manifest = { version: 1, capabilities: { environmentBindings: [] } }
    expect(normalizeModelCapabilityManifest(manifest, [], [{ id: 'legacy' }]).capabilities.environmentBindings).toEqual([])
  })

  it('uses legacy metadata only when the manifest omits those fields', () => {
    const manifest = { capabilities: { spatial: { enterable: true } } }
    const normalized = normalizeModelCapabilityManifest(manifest, [{ id: 'width' }], [{ id: 'light' }])
    expect(normalized.parameters).toEqual([{ id: 'width' }])
    expect(normalized.capabilities.spatial).toEqual({ enterable: true })
    expect(normalized.capabilities.environmentBindings).toEqual([{ id: 'light' }])
  })
})
