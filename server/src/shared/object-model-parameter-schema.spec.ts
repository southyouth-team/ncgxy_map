import { describe, expect, it } from '@jest/globals';
import {
  normalizeObjectModelMaterialParameterAliases,
  normalizeObjectModelParameterSchema,
} from './object-model-parameter-schema';

describe('ObjectModelSpec parameter schema normalization', () => {
  const tree = [
    { id: 'root', kind: 'group', dimensions: { width: 1 } },
    { id: 'panel', parent: 'root', primitive: 'box', material: 'lattice', dimensions: { width: 2, height: 1, depth: 0.1 } },
  ];
  const materials = { lattice: { color: '#8a623d', roughness: 0.8, metalness: 0.1, opacity: 1 } };

  it('normalizes parameter definitions and material aliases into one canonical shape', () => {
    const result = normalizeObjectModelParameterSchema([
      {
        id: 'panel-color', label: '格栅颜色', type: 'color', value: '#aabbcc',
        targets: [{ nodeId: 'panel', property: 'lattice_color' }],
      },
      {
        id: 'panel-width', type: 'number', value: 2, min: 1, max: 4, step: 0.5, unit: 'm',
        targets: [{ nodeId: 'panel', property: 'dimensions.width' }],
      },
      {
        id: 'panel-opacity', type: 'number', value: 1, min: 0.05, max: 1,
        targets: [{ nodeId: 'panel', property: 'lattice_opacity' }],
      },
    ], tree, materials);

    expect(result[0]).toMatchObject({
      id: 'panel-color', label: '格栅颜色', type: 'color', value: '#aabbcc',
      targets: [{ nodeId: 'panel', property: 'material.color', mode: 'set' }],
    });
    expect(result[1]).toMatchObject({ min: 1, max: 4, step: 0.5, unit: 'm' });
    expect(result[2].targets[0].property).toBe('material.opacity');
  });

  it('supports operation-controlled parameters without ordinary targets', () => {
    const result = normalizeObjectModelParameterSchema([
      { id: 'repeat-count', type: 'number', value: 3, min: 1, max: 8, targets: [] },
    ], tree, materials, new Set(['repeat-count']));
    expect(result[0].targets).toEqual([]);
  });

  it('rejects invalid IDs, values, options, targets and unsupported operations', () => {
    expect(() => normalizeObjectModelParameterSchema([
      { id: 'bad id', type: 'boolean', value: true, targets: [{ nodeId: 'panel', property: 'visibility.visible' }] },
    ], tree, materials)).toThrow('参数 ID 无效或重复');

    expect(() => normalizeObjectModelParameterSchema([
      { id: 'bad-number', type: 'number', value: 9, min: 1, max: 4, targets: [{ nodeId: 'panel', property: 'dimensions.width' }] },
    ], tree, materials)).toThrow('数值参数范围无效');

    expect(() => normalizeObjectModelParameterSchema([
      { id: 'bad-target', type: 'number', value: 2, min: 1, max: 4, targets: [{ nodeId: 'panel', property: 'dimensions.missing' }] },
    ], tree, materials)).toThrow('参数目标无效');

    expect(() => normalizeObjectModelParameterSchema([
      { id: 'group-dimension', type: 'number', value: 1, min: 0, max: 2, targets: [{ nodeId: 'root', property: 'dimensions.width' }] },
    ], tree, materials)).toThrow('Group 节点仅支持变换和显隐参数');

    expect(() => normalizeObjectModelParameterSchema([
      { id: 'bad-select', type: 'select', value: 'missing', options: [{ label: 'Box', value: 'box' }], targets: [{ nodeId: 'panel', property: 'geometry.primitive' }] },
    ], tree, materials)).toThrow('枚举参数选项无效');
  });

  it('normalizes only explicit legacy aliases and leaves unknown names untouched', () => {
    const input = [{ id: 'x', targets: [{ nodeId: 'panel', property: 'lattice_color' }, { nodeId: 'panel', property: 'custom_color' }] }];
    expect(normalizeObjectModelMaterialParameterAliases(input)).toEqual([{
      id: 'x',
      targets: [
        { nodeId: 'panel', property: 'material.color' },
        { nodeId: 'panel', property: 'custom_color' },
      ],
    }]);
  });
});
