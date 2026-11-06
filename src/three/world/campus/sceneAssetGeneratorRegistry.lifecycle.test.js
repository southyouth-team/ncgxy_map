import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneAssetGeneratorRegistry } from './sceneAssetGeneratorRegistry.js';

describe('scene asset generator registry lifecycle', () => {
  it('does not let an old unregister handle remove a replacement generator', () => {
    const registry = createSceneAssetGeneratorRegistry(THREE);
    const first = registry.register('indoor', ['classroom'], (three, input, materials) => {
      const group = new three.Group();
      group.add(new three.Mesh(new three.BoxGeometry(1, 1, 1), materials.primary));
      group.userData.implementation = 'first';
      return group;
    });
    const second = registry.register('indoor', ['classroom'], (three, input, materials) => {
      const group = new three.Group();
      group.add(new three.Mesh(new three.SphereGeometry(1), materials.primary));
      group.userData.implementation = 'replacement';
      return group;
    }, { replace: true });

    first();
    expect(registry.supports('indoor', 'classroom')).toBe(true);
    expect(registry.generate({ category: 'indoor', objectType: 'classroom' }).userData.implementation)
      .toBe('replacement');

    second();
    expect(registry.supports('indoor', 'classroom')).toBe(false);
  });
});
