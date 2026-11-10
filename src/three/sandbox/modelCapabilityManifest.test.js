import { describe, expect, it } from 'vitest'
import { hasExplicitModelCapabilityManifest, normalizeModelCapabilityManifest, normalizeSpatialTraversability, resolveProceduralModelParts, validateSpatialTraversability } from './modelCapabilityManifest.js'

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
    expect(normalizeModelCapabilityManifest(manifest)).toEqual({
      ...manifest,
      capabilities: { ...manifest.capabilities, environmentBindings: [] },
    })
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

  
it('identifies an explicit module manifest without treating arrays as manifests', () => {
  expect(hasExplicitModelCapabilityManifest({ version: 1, capabilities: {} })).toBe(true)
  expect(hasExplicitModelCapabilityManifest(null)).toBe(false)
  expect(hasExplicitModelCapabilityManifest([])).toBe(false)
})


describe('resolveProceduralModelParts', () => {
  it('prefers part metadata exported by the source executed in the Worker', () => {
    const moduleParts = [{ id: 'new-door', componentId: 'door-v2' }]
    const responseParts = [{ id: 'old-door', componentId: 'door-v1' }]
    const currentParts = [{ id: 'legacy-door', componentId: 'door-v0' }]
    expect(resolveProceduralModelParts({
      moduleParts, modulePartsSource: 'module', responseParts, currentParts,
    })).toBe(moduleParts)
  })

  it('honors an explicitly empty module part list instead of restoring stale parts', () => {
    expect(resolveProceduralModelParts({
      moduleParts: [], modulePartsSource: 'module',
      responseParts: [{ id: 'stale-api-part' }],
      currentParts: [{ id: 'stale-current-part' }],
    })).toEqual([])
  })

  it('uses API or current-model metadata only for legacy modules', () => {
    const responseParts = [{ id: 'api-part' }]
    expect(resolveProceduralModelParts({
      moduleParts: [], modulePartsSource: 'legacy', responseParts,
      currentParts: [{ id: 'old-part' }],
    })).toBe(responseParts)
    expect(resolveProceduralModelParts({
      moduleParts: [], modulePartsSource: 'legacy', responseParts: [],
      currentParts: [{ id: 'old-part' }],
    })).toEqual([{ id: 'old-part' }])
  })
})


describe('model spatial traversability contract', () => {
  it('normalizes stairs, ramps, jumps, passages and connections without discarding extensions', () => {
    const normalized = normalizeSpatialTraversability({
      stairs: [{ id: 'stair-main', targetPartId: 'stair-mesh', riserHeight: 0.18 }],
      ramps: [{ id: 'ramp-east', targetPartId: 'ramp-mesh', slopeDegrees: 8 }],
      jumps: [{ id: 'gap-jump', targetPartId: 'jump-frame' }],
      passages: [{ id: 'doorway', targetPartId: 'door-frame', width: 1.2 }],
      connections: [{ id: 'floor-link', from: 'floor-1', to: 'floor-2', type: 'stairs' }],
      customTraversalData: { vendor: 'ai' },
    })
    expect(normalized.stairs).toHaveLength(1)
    expect(normalized.ramps).toHaveLength(1)
    expect(normalized.jumps).toHaveLength(1)
    expect(normalized.passages).toHaveLength(1)
    expect(normalized.connections).toHaveLength(1)
    expect(normalized.customTraversalData).toEqual({ vendor: 'ai' })
  })

  it('reports missing stable ids, part bindings and connection endpoints', () => {
    const result = validateSpatialTraversability({
      stairs: [{ targetPartId: 'steps' }],
      ramps: [{ id: 'ramp' }],
      passages: [{ id: 'doorway', targetPartId: 'door' }],
      connections: [{ id: 'link', from: 'floor-a' }],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'traversability.id.required',
      'traversability.targetPartId.required',
      'traversability.connection.endpoints.required',
    ]))
  })

  it('normalizes traversal collections when a spatial traversal section exists', () => {
    const normalized = normalizeModelCapabilityManifest({
      capabilities: { spatial: { traversability: { stairs: [{ id: 's', targetPartId: 'p' }] } } },
    })
    expect(normalized.capabilities.spatial.traversability).toMatchObject({
      stairs: [{ id: 's', targetPartId: 'p' }],
      ramps: [],
      jumps: [],
      passages: [],
      connections: [],
    })
  })
})
