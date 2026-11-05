import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneAssetGeneratorRegistry, SCENE_ASSET_GENERATOR_CATALOG } from './sceneAssetGeneratorRegistry.js';

describe('scene asset generator registry', () => {
  const registry = createSceneAssetGeneratorRegistry(THREE);

  it('registers reusable generators across the first five supported scene categories', () => {
    expect(registry.supports('vegetation', '香樟树')).toBe(true);
    expect(registry.supports('structure', '拱桥')).toBe(true);
    expect(registry.supports('facility', '长椅')).toBe(true);
    expect(registry.supports('decoration', '景观石')).toBe(true);
    expect(registry.supports('sports', '篮球架')).toBe(true);
    expect(SCENE_ASSET_GENERATOR_CATALOG).toHaveLength(5);
  });

  it('generates a real multi-mesh tree and records template metadata', () => {
    const tree = registry.generate({
      category: 'vegetation',
      objectType: '香樟树',
      visualStyle: 'anime-painted',
      name: '校园香樟树模板',
      dimensions: { width: 3, height: 5, depth: 3 },
    });
    const meshes = [];
    tree.traverse(object => { if (object.isMesh) meshes.push(object); });
    expect(meshes.length).toBeGreaterThanOrEqual(3);
    expect(meshes.every(mesh => mesh.geometry && mesh.material)).toBe(true);
    expect(tree.userData.sceneAsset).toMatchObject({
      category: 'vegetation',
      objectType: '香樟树',
      visualStyle: 'anime-painted',
      generator: 'procedural',
      schemaVersion: 1,
    });
  });

  it('generates facility and structure objects as actual Three.js meshes', () => {
    for (const input of [
      { category: 'facility', objectType: '长椅' },
      { category: 'structure', objectType: '拱桥' },
      { category: 'decoration', objectType: '景观石' },
      { category: 'sports', objectType: '篮球架' },
    ]) {
      const object = registry.generate(input);
      let meshCount = 0;
      object.traverse(child => { if (child.isMesh) meshCount += 1; });
      expect(meshCount).toBeGreaterThan(0);
      expect(object.userData.sceneAsset.category).toBe(input.category);
    }
  });

  it('fails explicitly for spatial categories without a dedicated generator', () => {
    expect(registry.supports('water', '湖泊')).toBe(false);
    expect(() => registry.generate({ category: 'water', objectType: '湖泊' }))
      .toThrow('未注册场景资产生成器：water/湖泊');
  });
});
