import { describe, expect, it } from 'vitest'
import { normalizeCapabilityControlDocument, resolveCapabilityRecords } from './capabilityControl.js'

describe('normalizeCapabilityControlDocument', () => {
  it('creates independent empty inference, override and diagnostic collections', () => {
    expect(normalizeCapabilityControlDocument(null)).toEqual({
      version: 1, inference: { proposals: [] }, overrides: [], diagnostics: [],
    })
  })
  it('preserves unknown extension fields and future proposal payloads', () => {
    const input = {
      version: 4, customNamespace: { future: true },
      inference: { proposals: [{ capabilityId: 'fluid.flow', confidence: 0.82, evidence: ['mesh'] }] },
      overrides: [{ capabilityId: 'fluid.flow', action: 'set', value: { speed: 2 } }],
      diagnostics: [{ code: 'runtime-missing' }],
    }
    expect(normalizeCapabilityControlDocument(input)).toEqual(input)
  })
})

describe('resolveCapabilityRecords', () => {
  const capabilityId = 'spatial.traversal'
  const scope = { targetType: 'part', targetId: 'glass-panel-1' }
  it('applies explicit user override over definition and AI inference', () => {
    const result = resolveCapabilityRecords({
      proposals: [{ capabilityId, scope, status: 'accepted', value: { passThrough: false } }],
      definitions: [{ capabilityId, scope, value: { passThrough: false } }],
      overrides: [{ capabilityId, scope, action: 'set', value: { passThrough: true } }],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ source: 'user-override', value: { passThrough: true }, status: 'resolved' })
  })
  it('prefers confirmed model definition over accepted inference', () => {
    const result = resolveCapabilityRecords({
      proposals: [{ capabilityId, scope, status: 'accepted', value: { passThrough: true } }],
      definitions: [{ capabilityId, scope, value: { passThrough: false } }],
    })
    expect(result[0]).toMatchObject({ source: 'model-definition', value: { passThrough: false } })
  })
  it('automatically applies AI inference when the user has not specified an alternative', () => {
    const result = resolveCapabilityRecords({
      proposals: [{ capabilityId, scope, confidence: 0.99, evidence: ['door-like opening'], value: { passThrough: true } }],
    })
    expect(result[0]).toMatchObject({ source: 'ai-inference', status: 'inferred', enabled: true, value: { passThrough: true } })
  })
  it('does not require a legacy proposed status to apply an inference', () => {
    const result = resolveCapabilityRecords({
      proposals: [{ capabilityId, scope, status: 'proposed', value: { passThrough: true } }],
    })
    expect(result[0]).toMatchObject({ source: 'ai-inference', status: 'inferred', enabled: true })
  })
  it('preserves an explicit disabled flag on an automatically inferred capability', () => {
    const result = resolveCapabilityRecords({
      proposals: [{ capabilityId, scope, enabled: false, value: { passThrough: true } }],
    })
    expect(result[0]).toMatchObject({ source: 'ai-inference', status: 'inferred', enabled: false })
  })
  it('allows a user rejection/disable to suppress a capability', () => {
    const result = resolveCapabilityRecords({
      definitions: [{ capabilityId, scope, value: { blocksMovement: true } }],
      overrides: [{ capabilityId, scope, action: 'disable', reason: 'user-disabled' }],
    })
    expect(result[0]).toMatchObject({ source: 'user-override', status: 'suppressed', enabled: false, reason: 'user-disabled' })
  })
  it('resolves independent scopes independently', () => {
    const result = resolveCapabilityRecords({
      definitions: [
        { capabilityId, scope: { targetType: 'part', targetId: 'wall-a' }, value: { blocksMovement: true } },
        { capabilityId, scope: { targetType: 'part', targetId: 'wall-b' }, value: { blocksMovement: true } },
      ],
      overrides: [{ capabilityId, scope: { targetType: 'part', targetId: 'wall-a' }, action: 'disable' }],
    })
    expect(result).toHaveLength(2)
    expect(result.find(item => item.scope.targetId === 'wall-a')).toMatchObject({ enabled: false, source: 'user-override' })
    expect(result.find(item => item.scope.targetId === 'wall-b')).toMatchObject({ enabled: true, source: 'model-definition' })
  })
  it('preserves unknown capability names without a registry whitelist', () => {
    const result = resolveCapabilityRecords({
      definitions: [{ capabilityId: 'my-domain.future-device', value: { custom: { mode: 'adaptive' } } }],
    })
    expect(result[0]).toMatchObject({ capabilityId: 'my-domain.future-device', value: { custom: { mode: 'adaptive' } } })
  })
  it('does not mutate caller-owned records', () => {
    const definitions = [{ capabilityId, scope, value: { passThrough: false } }]
    const before = JSON.stringify(definitions)
    resolveCapabilityRecords({ definitions })
    expect(JSON.stringify(definitions)).toBe(before)
  })
})


describe('createCapabilityControlDocument', () => {
  it('derives extensible inference records from every manifest capability namespace', async () => {
    const { createCapabilityControlDocument } = await import('./capabilityControl.js')
    const result = createCapabilityControlDocument({
      manifest: { capabilities: { spatial: { colliders: [] }, customFuture: { enabled: true } } },
    })
    expect(result.inference.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: 'model.spatial', status: 'inferred', value: { colliders: [] } }),
      expect.objectContaining({ capabilityId: 'model.customFuture', value: { enabled: true } }),
    ]))
  })
  it('preserves user overrides, diagnostics and extension fields when rebuilding inference', async () => {
    const { createCapabilityControlDocument } = await import('./capabilityControl.js')
    const previousDocument = {
      version: 1,
      customExtension: { keep: true },
      inference: { proposals: [{ capabilityId: 'old', value: 1 }] },
      overrides: [{ capabilityId: 'model.spatial', action: 'set', value: { enabled: false } }],
      diagnostics: [{ code: 'previous-warning' }],
    }
    const result = createCapabilityControlDocument({
      manifest: { capabilities: { spatial: { colliders: [] } } },
      previousDocument,
    })
    expect(result.customExtension).toEqual({ keep: true })
    expect(result.overrides).toEqual(previousDocument.overrides)
    expect(result.diagnostics).toEqual(previousDocument.diagnostics)
    expect(result.inference.proposals).toHaveLength(1)
  })
})


describe('capability override continuity across model replacement', () => {
  it('keeps user overrides while refreshing AI inference from the replacement manifest', async () => {
    const { createCapabilityControlDocument } = await import('./capabilityControl.js')
    const previousDocument = {
      version: 1,
      inference: { proposals: [{ capabilityId: 'model.spatial', value: { old: true } }] },
      overrides: [{
        capabilityId: 'spatial.collider.door-leaf.blocksMovement',
        scope: { targetType: 'part', targetId: 'door-leaf' },
        action: 'set',
        value: { blocksMovement: false },
      }],
      diagnostics: [{ code: 'user-reviewed' }],
    }
    const nextManifest = {
      version: 1,
      capabilities: {
        spatial: { colliders: [{ id: 'door-leaf', targetPartId: 'door-leaf', shape: 'box' }] },
        interior: { enterable: true },
      },
    }
    const nextDocument = createCapabilityControlDocument({
      manifest: nextManifest,
      previousDocument,
    })
    expect(nextDocument.overrides).toEqual(previousDocument.overrides)
    expect(nextDocument.diagnostics).toEqual(previousDocument.diagnostics)
    expect(nextDocument.inference.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: 'model.spatial', value: nextManifest.capabilities.spatial }),
      expect.objectContaining({ capabilityId: 'model.interior', value: nextManifest.capabilities.interior }),
    ]))
    const resolved = resolveCapabilityRecords({
      definitions: [{
        capabilityId: 'spatial.collider.door-leaf.blocksMovement',
        scope: { targetType: 'part', targetId: 'door-leaf' },
        value: { blocksMovement: true },
      }],
      overrides: nextDocument.overrides,
    })
    expect(resolved).toEqual([expect.objectContaining({
      source: 'user-override',
      value: { blocksMovement: false },
    })])
  })
})
