import { createObjectModelGeometryCapabilityRegistry } from './object-model-geometry-capability-registry';
import { describe, expect, it } from '@jest/globals';
import { normalizeObjectModelParameterSchema } from './object-model-parameter-schema';
import { validateObjectModelSpecV3 } from './object-model-spec-v3';
import { createObjectModelParameterContractCases } from './object-model-parameter-contract.fixtures';

describe('geometry capability validator registry', () => {
  it('requires a validator for every capability and rejects duplicate identifiers', () => {
    expect(() => createObjectModelGeometryCapabilityRegistry([{ primitive: 'box', descriptor: 'optional' } as any]))
      .toThrow('valid primitive, descriptor contract and validator');
    expect(() => createObjectModelGeometryCapabilityRegistry([
      { primitive: 'box', descriptor: 'optional', validateDescriptor() {} },
      { primitive: 'BOX', descriptor: 'optional', validateDescriptor() {} },
    ])).toThrow('Duplicate geometry capability: box');
  });

  it('dispatches trusted validators and rejects unknown capabilities', () => {
    const calls: string[] = [];
    const registry = createObjectModelGeometryCapabilityRegistry([
      { primitive: 'polygon', descriptor: 'points', validateDescriptor(node: any) { calls.push(node.id); } },
    ]);
    expect(registry.has('POLYGON')).toBe(true);
    registry.validate('POLYGON', { id: 'footprint' }, {});
    expect(calls).toEqual(['footprint']);
    expect(() => registry.validate('lathe', {}, {})).toThrow('not registered: lathe');
  });
});

describe('ObjectModelSpec cross-layer parameter contract', () => {
  it('uses the same serialized cases as the frontend contract suite', () => {
    for (const contract of createObjectModelParameterContractCases()) {
      const { spec } = contract;
      const normalize = () => normalizeObjectModelParameterSchema(spec.parameterSchema, spec.componentTree, spec.materials);
      const validateRaw = () => validateObjectModelSpecV3(spec);

      if (contract.normalizer === 'accept') {
        const normalizedParameters = normalize();
        if (contract.normalizedTarget) expect(normalizedParameters[0].targets[0]).toEqual(contract.normalizedTarget);
        const normalizedSpec = { ...spec, parameterSchema: normalizedParameters };
        if (contract.validator === 'accept') {
          expect(() => validateObjectModelSpecV3(normalizedSpec)).not.toThrow();
        } else {
          expect(() => validateObjectModelSpecV3(normalizedSpec)).toThrow();
        }
      } else {
        expect(normalize).toThrow();
      }

      if (contract.validator === 'accept') expect(validateRaw).not.toThrow();
      else expect(validateRaw).toThrow();
    }
  });
});
