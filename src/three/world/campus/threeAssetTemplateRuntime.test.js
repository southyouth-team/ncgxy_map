import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createThreeAssetTemplateRuntime } from './threeAssetTemplateRuntime.js';
import { createCampusAssetTemplateRuntime } from './createCampusAssetTemplateRuntime.js';

describe('Three.js asset template runtime', () => {
  it('creates independent instances from one registered factory and composes them into one scene', () => {
    const runtime = createThreeAssetTemplateRuntime(THREE);
    runtime.register({
      id: 'test:tree',
      version: 1,
      category: 'vegetation',
      objectType: 'tree',
      factory: three => {
        const group = new three.Group();
        group.add(new three.Mesh(new three.CylinderGeometry(0.2, 0.3, 2), new three.MeshStandardMaterial()));
        return group;
      },
    });
    const scene = new THREE.Scene();
    const first = runtime.createInto(scene, 'test:tree', { instanceId: 'tree-1', transform: { position: [1, 0, 2] } });
    const second = runtime.createInto(scene, 'test:tree', { instanceId: 'tree-2', transform: { position: [4, 0, 2] } });
    expect(scene.children).toContain(first);
    expect(scene.children).toContain(second);
    expect(first).not.toBe(second);
    expect(first.children[0].geometry).not.toBe(second.children[0].geometry);
    expect(first.userData.assetTemplate).toMatchObject({ id: 'test:tree', version: 1, category: 'vegetation' });
    expect(first.userData.assetInstanceId).toBe('tree-1');
    expect(second.position.x).toBe(4);
  });

  it('rejects arbitrary executable source, invalid factories and unsafe transforms', () => {
    const runtime = createThreeAssetTemplateRuntime(THREE);
    expect(() => runtime.register({ id: 'bad', version: 1, factory: 'return eval(1)' })).toThrow('资产模板定义无效');
    runtime.register({ id: 'test:plain', version: 1, factory: three => new three.Group() });
    expect(() => runtime.create('test:plain', { transform: { scale: [0, 1, 1] } })).toThrow('scale 超出允许范围');
    expect(() => runtime.create('missing')).toThrow('未注册资产模板');
  });

  it('does not let an old unregister handle remove a replacement template', () => {
    const runtime = createThreeAssetTemplateRuntime(THREE);
    const firstFactory = three => new three.Group();
    const secondFactory = three => {
      const group = new three.Group();
      group.name = 'replacement';
      return group;
    };
    const removeOld = runtime.register({ id: 'test:replace', version: 1, factory: firstFactory });
    runtime.register({ id: 'test:replace', version: 2, factory: secondFactory }, { replace: true });
    removeOld();
    expect(runtime.create('test:replace').name).toBe('replacement');
    expect(runtime.list().find(item => item.id === 'test:replace').version).toBe(2);
  });

  it('adapts campus building, vegetation and spatial templates into one sandbox scene', () => {
    const runtime = createCampusAssetTemplateRuntime(THREE);
    const scene = runtime.createSandboxScene();
    const building = runtime.templates.createInto(scene, 'building:building-教学楼', {
      instanceId: 'building-1',
      parameters: { width: 8, depth: 6, height: 12, label: '教学楼模板实例' },
      transform: { position: [-8, 0, 0] },
    });
    const tree = runtime.templates.createInto(scene, 'vegetation:香樟树', {
      instanceId: 'tree-1',
      parameters: { dimensions: { width: 3, height: 5, depth: 3 }, visualStyle: 'anime-painted' },
      transform: { position: [8, 0, 0] },
    });
    const road = runtime.templates.createInto(scene, 'road:校园道路', {
      instanceId: 'road-1',
      parameters: { spatialGeometry: { coordinates: [[-5, 0], [0, 1], [5, 0]] } },
    });
    expect(building.userData.assetTemplate.category).toBe('building');
    expect(tree.userData.assetTemplate.category).toBe('vegetation');
    expect(road.userData.assetTemplate.category).toBe('road');
    expect(scene.children.filter(child => child.userData.assetTemplate)).toHaveLength(3);
    expect(runtime.templates.list().length).toBeGreaterThan(20);
  });
});
