import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSceneAssetGeneratorRegistry, SCENE_ASSET_GENERATOR_CATALOG } from './sceneAssetGeneratorRegistry.js';

describe('scene asset generator registry', () => {
  const registry = createSceneAssetGeneratorRegistry(THREE);

  it('registers reusable generators across all eight implemented scene categories', () => {
    expect(registry.supports('vegetation', '香樟树')).toBe(true);
    expect(registry.supports('structure', '拱桥')).toBe(true);
    expect(registry.supports('facility', '长椅')).toBe(true);
    expect(registry.supports('decoration', '景观石')).toBe(true);
    expect(registry.supports('sports', '篮球架')).toBe(true);
    expect(registry.supports('road', '校园道路')).toBe(true);
    expect(registry.supports('water', '湖泊')).toBe(true);
    expect(registry.supports('terrain', '山坡')).toBe(true);
    expect(SCENE_ASSET_GENERATOR_CATALOG).toHaveLength(8);
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

  it('allows category-specific generator plugins to be registered and removed', () => {
    const remove = registry.register('indoor', ['教室'], (three, input, materials) => {
      const group = new three.Group();
      group.add(new three.Mesh(new three.BoxGeometry(4, 0.1, 4), materials.glass));
      return group;
    });
    expect(registry.supports('indoor', '教室')).toBe(true);
    expect(registry.generate({ category: 'indoor', objectType: '教室' }).userData.sceneAsset.category).toBe('indoor');
    remove();
    expect(registry.supports('indoor', '教室')).toBe(false);
  });

  it('fails explicitly for categories without a dedicated generator', () => {
    expect(registry.supports('effect', '天气粒子')).toBe(false);
    expect(() => registry.generate({ category: 'effect', objectType: '天气粒子' }))
      .toThrow('未注册场景资产生成器：effect/天气粒子');
  });

  it('applies AI-extracted geometry parameters to generated meshes', () => {
    const tree = registry.generate({
      category: 'vegetation', objectType: '香樟树', dimensions: { width: 3, height: 5, depth: 3 },
      design: { geometry: { trunkRatio: 0.5, crownLayers: 4 } },
    });
    const treeMeshes = [];
    tree.traverse(object => { if (object.isMesh) treeMeshes.push(object); });
    expect(treeMeshes.filter(mesh => mesh.name === 'vegetation-crown' || mesh.name === 'vegetation-crown-highlight').length).toBeGreaterThan(0);
    expect(treeMeshes.length).toBeGreaterThanOrEqual(6);

    const bridge = registry.generate({
      category: 'structure', objectType: '拱桥',
      design: { geometry: { supportCount: 6 } },
    });
    const supports = [];
    bridge.traverse(object => { if (object.name === 'bridge-pier') supports.push(object); });
    expect(supports).toHaveLength(6);

    const bench = registry.generate({
      category: 'facility', objectType: '长椅',
      design: { geometry: { seatCount: 4 } },
    });
    const seats = [];
    bench.traverse(object => { if (object.name.startsWith('bench-seat-')) seats.push(object); });
    expect(seats).toHaveLength(4);
  });


  it('generates spatial road ribbons, polygon water with holes, and terrain grids', () => {
    const road = registry.generate({
      category: 'road', objectType: '校园道路',
      design: { geometry: { roadWidth: 5, sidewalkWidth: 1.5, markingType: 'centerline' } },
      spatialGeometry: { coordinates: [[-5, 0], [0, 2], [5, 0]] },
    });
    expect(road.getObjectByName('road-surface')?.geometry.attributes.position.count).toBeGreaterThan(0);
    expect(road.getObjectByName('road-sidewalk')).toBeTruthy();
    expect(road.getObjectByName('road-marking')).toBeTruthy();

    const water = registry.generate({
      category: 'water', objectType: '湖泊',
      spatialGeometry: {
        outer: [[-5,-4],[5,-4],[5,4],[-5,4]],
        holes: [[[-1,-1],[1,-1],[1,1],[-1,1]]],
      },
    });
    expect(water.getObjectByName('water-surface')?.geometry).toBeTruthy();
    expect(water.getObjectByName('water-shoreline')).toBeTruthy();

    const terrain = registry.generate({
      category: 'terrain', objectType: '山坡',
      design: { geometry: { relief: 3, slope: 0.4 } },
      spatialGeometry: { gridSize: 8 },
    });
    expect(terrain.getObjectByName('terrain-surface')?.geometry.attributes.position.count).toBe(81);
  });

});
