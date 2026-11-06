import { describe, expect, it } from '@jest/globals';
import {
  isObjectModelParameterTargetTypeCompatible,
  resolveObjectModelParameterTarget,
} from './object-model-property-resolver';

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
});
