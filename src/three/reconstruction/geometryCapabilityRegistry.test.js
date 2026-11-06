import { describe, expect, it, vi } from 'vitest';
import { auditGeometryCapabilityCoverage, createGeometryCapabilityRegistry } from './geometryCapabilityRegistry.js';
import { auditObjectModelGeometryCapabilityCoverage } from './createObjectSculptModel.js';

describe('trusted geometry capability registry', () => {
  it('requires both a descriptor validator and a trusted executor', () => {
    expect(() => createGeometryCapabilityRegistry([{ primitive: 'box', createGeometry() {} }]))
      .toThrow('requires a trusted validator and executor');
  });

  it('normalizes primitive identifiers and dispatches validation before execution', () => {
    const calls = [];
    const registry = createGeometryCapabilityRegistry([{
      primitive: 'Box',
      descriptor: 'optional',
      validateDescriptor(context) { calls.push(['validate', context.node.id]); },
      createGeometry(context) { calls.push(['execute', context.node.id]); return { kind: 'box' }; },
    }]);

    expect(registry.has('BOX')).toBe(true);
    expect(registry.list()).toEqual([{ id: 'box', primitive: 'box', descriptor: 'optional' }]);
    expect(registry.create('BOX', { node: { id: 'wall' } })).toEqual({ kind: 'box' });
    expect(calls).toEqual([['validate', 'wall'], ['execute', 'wall']]);
  });

  it('binds runtime executors to the exact protocol capability ID and descriptor contract', () => {
    const capability = {
      primitive: 'box', descriptor: 'optional',
      validateDescriptor() {}, createGeometry() { return {}; },
    };
    const resolveContract = id => id === 'box'
      ? { id: 'box', primitive: 'box', descriptor: 'optional' } : null;
    expect(() => createGeometryCapabilityRegistry([capability], () => null))
      .toThrow('no matching protocol contract');
    expect(() => createGeometryCapabilityRegistry([capability], () => ({
      id: 'box', primitive: 'box', descriptor: 'points',
    }))).toThrow('descriptor contract mismatch');
    expect(createGeometryCapabilityRegistry([capability], resolveContract).has('box')).toBe(true);
  });


  it('exposes the real protocol-to-runtime coverage gap during staged migration', () => {
    expect(auditObjectModelGeometryCapabilityCoverage()).toEqual({
      complete: false,
      protocolCount: 14,
      runtimeCount: 10,
      missingExecutorIds: ['lathe', 'loft', 'sweep', 'tube'],
      unknownExecutorIds: [],
      descriptorMismatches: [],
      primitiveMismatches: [],
    });
  });

  it('audits missing, unknown and mismatched runtime executors without hiding partial coverage', () => {
    const result = auditGeometryCapabilityCoverage([
      { id: 'box', primitive: 'box', descriptor: 'optional' },
      { id: 'tube', primitive: 'tube', descriptor: 'path-radius' },
      { id: 'lathe', primitive: 'lathe', descriptor: 'profile' },
    ], [
      { id: 'box', primitive: 'box', descriptor: 'optional' },
      { id: 'tube', primitive: 'tube', descriptor: 'path' },
      { id: 'custom', primitive: 'custom', descriptor: 'optional' },
    ]);
    expect(result).toEqual({
      complete: false,
      protocolCount: 3,
      runtimeCount: 3,
      missingExecutorIds: ['lathe'],
      unknownExecutorIds: ['custom'],
      descriptorMismatches: ['tube'],
      primitiveMismatches: [],
    });
  });

  it('reports full coverage only when IDs, primitives and descriptor contracts match', () => {
    expect(auditGeometryCapabilityCoverage(
      [{ id: 'box', primitive: 'box', descriptor: 'optional' }],
      [{ id: 'box', primitive: 'box', descriptor: 'optional' }],
    )).toMatchObject({ complete: true, missingExecutorIds: [], unknownExecutorIds: [] });
  });

  it('rejects duplicate registrations and unregistered primitives', () => {
    const capability = {
      primitive: 'box',
      validateDescriptor: vi.fn(),
      createGeometry: vi.fn(() => ({})),
    };
    const registry = createGeometryCapabilityRegistry([capability]);
    expect(() => registry.register(capability)).toThrow('already registered: box');
    expect(() => registry.create('lathe', {})).toThrow('not registered: lathe');
  });

  it('fails closed when validation rejects a descriptor or an executor returns no geometry', () => {
    const registry = createGeometryCapabilityRegistry([{
      primitive: 'test',
      validateDescriptor() { throw new TypeError('descriptor rejected'); },
      createGeometry: vi.fn(() => ({})),
    }]);
    expect(() => registry.create('test', {})).toThrow('descriptor rejected');

    const invalidExecutor = createGeometryCapabilityRegistry([{
      primitive: 'empty',
      validateDescriptor() {},
      createGeometry() { return null; },
    }]);
    expect(() => invalidExecutor.create('empty', {})).toThrow('returned an invalid geometry');
  });
});
