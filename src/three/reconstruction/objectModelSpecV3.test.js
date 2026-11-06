import { validateObjectModelSpecV3 } from '../../../server/src/shared/object-model-spec-v3.ts';
import { describe, expect, it } from 'vitest';
import { compileObjectModelSpec } from './objectModelSpecV3.js';

function createRadialSpec(count = 8) {
  return {
    schemaVersion: '3.0',
    targetName: 'radial-ribs',
    materials: { steel: { color: '#777777', roughness: 0.5, metalness: 0.8 } },
    componentTree: [
      { id: 'root', kind: 'group' },
      { id: 'rib-unit', kind: 'group', parent: 'root' },
      {
        id: 'rib',
        kind: 'mesh',
        parent: 'rib-unit',
        primitive: 'tube',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: { path: [[0, -0.5, 0], [0, 0.5, 0]], radius: 0.025 },
        material: 'steel',
      },
    ],
    parameterSchema: [{
      id: 'rib-count', label: 'Rib count', type: 'number',
      value: count, min: 1, max: 64, step: 1, targets: [],
    }],
    operations: [{
      id: 'radial-ribs',
      type: 'instance',
      sourceRootId: 'rib-unit',
      count: { parameterId: 'rib-count' },
      transform: {
        position: [
          { op: 'multiply', left: { op: 'constant', value: 2 }, right: { op: 'cos', value: { op: 'multiply', left: { op: 'index' }, right: { op: 'divide', left: { op: 'constant', value: 6.283185307179586 }, right: { op: 'count' } } } } },
          0,
          { op: 'multiply', left: { op: 'constant', value: 2 }, right: { op: 'sin', value: { op: 'multiply', left: { op: 'index' }, right: { op: 'divide', left: { op: 'constant', value: 6.283185307179586 }, right: { op: 'count' } } } } },
        ],
        rotation: [0, { op: 'multiply', left: { op: 'index' }, right: { op: 'divide', left: { op: 'constant', value: 6.283185307179586 }, right: { op: 'count' } } }, 0],
        scale: [1, 1, 1],
      },
    }],
  };
}

describe('canonical ObjectModelSpec 3.0 validator', () => {
  it('accepts a valid source spec and reports bounded expansion size', () => {
    const result = validateObjectModelSpecV3(createRadialSpec(8));
    expect(result.componentCount).toBe(3);
    expect(result.expandedComponentCount).toBe(3 + 2 * (64 - 1));
  });

  it('rejects duplicate operation IDs and invalid operation parameter references', () => {
    const duplicate = createRadialSpec();
    duplicate.operations.push({ ...duplicate.operations[0] });
    expect(() => validateObjectModelSpecV3(duplicate)).toThrow('instance operation ID');

    const missingParameter = createRadialSpec();
    missingParameter.operations[0].count.parameterId = 'missing-count';
    expect(() => validateObjectModelSpecV3(missingParameter)).toThrow('整数数量参数');
  });

  it('rejects parameter targets that do not resolve to a real scalar field', () => {
    const invalid = createRadialSpec();
    invalid.parameterSchema.push({
      id: 'fake-field', label: 'Fake', type: 'number', value: 1, min: 0, max: 2,
      targets: [{ nodeId: 'rib', property: 'geometryDescriptor.fakeRadius', mode: 'set' }],
    });
    expect(() => validateObjectModelSpecV3(invalid)).toThrow('参数目标属性不受支持');
  });

  it('rejects legacy protocol fields at the canonical boundary', () => {
    const legacy = createRadialSpec();
    legacy.generators = [];
    expect(() => validateObjectModelSpecV3(legacy)).toThrow('不接受 generators/constraints');
  });
});

describe('ObjectModelSpec 3.0 compiler', () => {
  it('expands arbitrary axis-angle instance distributions from expressions', () => {
    const compiled = compileObjectModelSpec(createRadialSpec());
    expect(compiled.schemaVersion).toBe('3.0');
    expect(compiled.componentTree).toHaveLength(1 + 2 * 8);
    expect(new Set(compiled.componentTree.map(node => node.id)).size).toBe(compiled.componentTree.length);
    const instances = compiled.componentTree.filter(node => node.operationInstance?.operationId === 'radial-ribs');
    expect(instances).toHaveLength(2 * 7);
    const secondRoot = instances.find(node => node.operationInstance?.sourceNodeId === 'rib-unit' && node.operationInstance.index === 1);
    expect(secondRoot.transform.position[0]).toBeCloseTo(2 * Math.cos(Math.PI / 4));
    expect(secondRoot.transform.position[2]).toBeCloseTo(2 * Math.sin(Math.PI / 4));
    expect(secondRoot.transform.rotation[1]).toBeCloseTo(Math.PI / 4);
  });

  it('rejects unsupported expression operators instead of evaluating code', () => {
    const spec = createRadialSpec();
    spec.operations[0].transform.rotation[1] = { op: 'javascript', source: 'process.exit()' };
    expect(() => compileObjectModelSpec(spec)).toThrow('不支持的表达式运算');
  });

  it('enforces operation instance limits', () => {
    const spec = createRadialSpec(101);
    spec.parameterSchema[0].max = 101;
    expect(() => compileObjectModelSpec(spec)).toThrow('instance 数量参数范围无效');
  });
});
