import { describe, expect, it } from '@jest/globals';
import { normalizeObjectModelParameterSchema } from './object-model-parameter-schema';
import { validateObjectModelSpecV3 } from './object-model-spec-v3';
import { createObjectModelParameterContractCases } from './object-model-parameter-contract.fixtures';

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
