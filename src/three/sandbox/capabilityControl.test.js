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
  it('keeps unaccepted AI inference pending instead of silently activating it', () => {
    const result = resolveCapabilityRecords({
      proposals: [{ capabilityId, scope, status: 'proposed', confidence: 0.99, value: { passThrough: true } }],
    })
    expect(result[0]).toMatchObject({ source: 'ai-inference', status: 'pending', enabled: true })
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
