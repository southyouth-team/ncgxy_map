import { describe, expect, it } from '@jest/globals';
import {
  isObjectModelParameterTargetTypeCompatible,
  resolveObjectModelParameterTarget,
} from './object-model-property-resolver';
import { validateObjectModelSpecV3 } from './object-model-spec-v3';

describe('ObjectModelSpec parameter target resolver', () => {
  const node = {
    id: 'body',
    primitive: 'box',
    material: 'paint',
    dimensions: { width: 4 },
    geometryDescriptor: { sections: [{ height: 2 }] },
    transform: { position: [1, 2, 3] },
  };
  const materials = { paint: { color: '#aabbcc', roughness: 0.7, metalness: 0 } };

  it('resolves scalar dimensions, nested descriptor fields, material fields and vector components', () => {
    expect(resolveObjectModelParameterTarget(node, materials, 'dimensions.width')).toMatchObject({ kind: 'number', value: 4, domain: 'dimensions' });
    expect(resolveObjectModelParameterTarget(node, materials, 'geometryDescriptor.sections.0.height')).toMatchObject({ kind: 'number', value: 2 });
    expect(resolveObjectModelParameterTarget(node, materials, 'material.color')).toMatchObject({ kind: 'color', value: '#aabbcc', domain: 'material' });
    expect(resolveObjectModelParameterTarget(node, materials, 'material.roughness')).toMatchObject({ kind: 'number', value: 0.7 });
    expect(resolveObjectModelParameterTarget(node, materials, 'transform.position.y')).toMatchObject({ kind: 'number', value: 2, domain: 'transform' });
  });

  it('resolves virtual geometry and visibility targets with mode-aware parameter types', () => {
    const visibility = resolveObjectModelParameterTarget(node, materials, 'visibility.visible');
    const primitive = resolveObjectModelParameterTarget(node, materials, 'geometry.primitive');
    expect(visibility).toMatchObject({ kind: 'boolean', value: true });
    expect(primitive).toMatchObject({ kind: 'select', value: 'box' });
    expect(isObjectModelParameterTargetTypeCompatible('boolean', visibility!, 'set', 'visibility.visible')).toBe(true);
    expect(isObjectModelParameterTargetTypeCompatible('number', visibility!, 'set', 'visibility.visible')).toBe(false);
    expect(isObjectModelParameterTargetTypeCompatible('number', visibility!, 'visible-from', 'visibility.visible')).toBe(true);
    expect(isObjectModelParameterTargetTypeCompatible('boolean', visibility!, 'visible-through', 'visibility.visible')).toBe(false);
  });

  it('rejects unknown, object-valued, oversized and prototype-sensitive paths', () => {
    expect(resolveObjectModelParameterTarget(node, materials, 'dimensions.missing')).toBeNull();
    expect(resolveObjectModelParameterTarget(node, materials, 'geometryDescriptor.sections')).toBeNull();
    expect(resolveObjectModelParameterTarget(node, materials, 'dimensions.__proto__')).toBeNull();
    expect(resolveObjectModelParameterTarget(node, materials, 'dimensions.constructor')).toBeNull();
    expect(resolveObjectModelParameterTarget(node, materials, 'x'.repeat(161))).toBeNull();
    expect(resolveObjectModelParameterTarget(node, materials, 'material.color.extra')).toBeNull();
  });

  it('uses safe defaults for missing transform vectors and rejects invalid component values', () => {
    expect(resolveObjectModelParameterTarget({ id: 'empty' }, {}, 'transform.scale.z')).toMatchObject({ kind: 'number', value: 1 });
    expect(resolveObjectModelParameterTarget({ id: 'empty' }, {}, 'transform.position.x')).toMatchObject({ kind: 'number', value: 0 });
    expect(resolveObjectModelParameterTarget(node, materials, 'material.missing')).toBeNull();
  });

  it('applies the shared visibility typing rules in the canonical protocol validator', () => {
    const createSpec = (parameter: any) => ({
      schemaVersion: '3.0',
      materials: {},
      componentTree: [{
        id: 'body',
        primitive: 'box',
        dimensions: { width: 2, height: 2, depth: 2 },
      }],
      parameterSchema: [parameter],
    });

    expect(() => validateObjectModelSpecV3(createSpec({
      id: 'visible',
      label: '显示',
      type: 'boolean',
      value: true,
      targets: [{ nodeId: 'body', property: 'visibility.visible', mode: 'set' }],
    }))).not.toThrow();

    expect(() => validateObjectModelSpecV3(createSpec({
      id: 'visible-distance',
      label: '显示距离',
      type: 'number',
      value: 10,
      min: 1,
      max: 100,
      targets: [{ nodeId: 'body', property: 'visibility.visible', mode: 'visible-from', threshold: 10 }],
    }))).not.toThrow();

    expect(() => validateObjectModelSpecV3(createSpec({
      id: 'invalid-visible-distance',
      label: '错误的显示距离',
      type: 'number',
      value: 10,
      min: 1,
      max: 100,
      targets: [{ nodeId: 'body', property: 'visibility.visible', mode: 'set' }],
    }))).toThrow('参数类型与目标属性的数据类型不匹配');
  });
});
