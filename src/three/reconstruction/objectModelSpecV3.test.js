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

describe('ObjectModelSpec 3.0 compiler', () => {
  it('expands arbitrary axis-angle instance distributions from expressions', () => {
    const compiled = compileObjectModelSpec(createRadialSpec());
    expect(compiled.schemaVersion).toBe('2.0');
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
