import { describe, expect, it, vi } from 'vitest';
import { createGeometryCapabilityRegistry } from './geometryCapabilityRegistry.js';

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
    expect(registry.list()).toEqual([{ primitive: 'box', descriptor: 'optional' }]);
    expect(registry.create('BOX', { node: { id: 'wall' } })).toEqual({ kind: 'box' });
    expect(calls).toEqual([['validate', 'wall'], ['execute', 'wall']]);
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
