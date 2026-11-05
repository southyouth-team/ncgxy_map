import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createObjectSculptModel, validateObjectSculptSpec } from './createObjectSculptModel.js';

function castleSpec() {
  return {
    schemaVersion: '2.0',
    targetName: 'anime-painted-castle',
    materials: {
      stone: { color: '#ead9ad', roughness: 0.9 },
      roof: { color: '#b84b3d', roughness: 0.78 },
      dark: { color: '#493b37', roughness: 0.8 },
      glass: { color: '#79b8c4', roughness: 0.25, metalness: 0.08 },
    },
    componentTree: [
      { id: 'keep', name: '主城堡主体', primitive: 'box', material: 'stone', dimensions: { width: 7, height: 5, depth: 5 }, transform: { position: [0, 2.5, 0] } },
      { id: 'west-tower', name: '西侧圆塔', parent: 'keep', primitive: 'cylinder', material: 'stone', dimensions: { width: 2, height: 7, depth: 2 }, transform: { position: [-2.8, 1, 0] } },
      { id: 'west-roof', name: '西塔红色尖顶', parent: 'west-tower', primitive: 'cone', material: 'roof', dimensions: { width: 2.8, height: 2.2, depth: 2.8 }, transform: { position: [0, 4.5, 0] } },
      { id: 'east-tower', name: '东侧圆塔', parent: 'keep', primitive: 'cylinder', material: 'stone', dimensions: { width: 2, height: 7, depth: 2 }, transform: { position: [2.8, 1, 0] } },
      { id: 'east-roof', name: '东塔红色尖顶', parent: 'east-tower', primitive: 'cone', material: 'roof', dimensions: { width: 2.8, height: 2.2, depth: 2.8 }, transform: { position: [0, 4.5, 0] } },
      { id: 'main-roof', name: '主楼屋顶', parent: 'keep', primitive: 'cone', material: 'roof', dimensions: { width: 7.8, height: 2, depth: 5.8 }, transform: { position: [0, 3.4, 0] } },
      { id: 'gate', name: '城堡拱门主体', parent: 'keep', primitive: 'box', material: 'dark', dimensions: { width: 1.6, height: 2.4, depth: 0.35 }, transform: { position: [0, -0.6, 2.55] } },
      { id: 'gate-window', name: '城堡入口玻璃', parent: 'gate', primitive: 'box', material: 'glass', dimensions: { width: 0.7, height: 1.4, depth: 0.08 }, transform: { position: [0, 0, 0.22] } },
    ],
  };
}

describe('ObjectSculptSpec Three.js adapter', () => {
  it('reconstructs a hierarchical castle as real Three.js meshes', () => {
    const spec = castleSpec();
    const result = createObjectSculptModel(THREE, spec);
    const meshes = [];
    result.traverse(object => { if (object.isMesh) meshes.push(object); });

    expect(meshes).toHaveLength(8);
    expect(result.getObjectByName('主城堡主体')).toBeTruthy();
    expect(result.getObjectByName('西塔红色尖顶')).toBeTruthy();
    expect(result.getObjectByName('城堡入口玻璃')).toBeTruthy();
    expect(result.userData.objectSculpt).toMatchObject({
      targetName: 'anime-painted-castle',
      componentCount: 8,
    });
    expect(meshes.every(mesh => mesh.geometry && mesh.material)).toBe(true);
  });


  it('exposes stable component IDs and gives each mesh an independently editable material', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { shared: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'left', primitive: 'box', material: 'shared', dimensions: { width: 1, height: 1, depth: 1 } },
        { id: 'right', primitive: 'box', material: 'shared', dimensions: { width: 1, height: 1, depth: 1 }, transform: { position: [2, 0, 0] } },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    const left = model.getObjectByName('left:mesh');
    const right = model.getObjectByName('right:mesh');
    expect(left.userData.componentId).toBe('left');
    expect(right.userData.componentId).toBe('right');
    expect(left.material).not.toBe(right.material);
    left.material.color.set('#ff0000');
    expect(right.material.color.getHexString()).toBe('cccccc');
  });

  it('builds dedicated arch openings and wedge roof geometry', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { stone: { color: '#d8c39a' } },
      componentTree: [
        { id: 'arch', primitive: 'arch', material: 'stone', dimensions: { width: 3, height: 4, depth: 0.5 }, geometryDescriptor: { inset: 0.35 } },
        { id: 'gable', primitive: 'wedge', material: 'stone', dimensions: { width: 5, height: 2, depth: 3 } },
      ],
    };
    const result = createObjectSculptModel(THREE, spec);
    const arch = result.getObjectByName('arch:mesh');
    const wedge = result.getObjectByName('gable:mesh');
    expect(arch.geometry.type).toBe('ExtrudeGeometry');
    expect(arch.geometry.parameters.shapes.holes).toHaveLength(1);
    expect(wedge.geometry.type).toBe('ExtrudeGeometry');
    expect(wedge.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('extrudes bounded custom polygon outlines into real geometry', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{
        id: 'gable-outline', primitive: 'polygon', dimensions: { width: 4, height: 3, depth: 0.6 },
        geometryDescriptor: { points: [[-0.5, -0.5], [0.5, -0.5], [0.32, 0.15], [0, 0.5], [-0.32, 0.15]] },
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const mesh = model.getObjectByName('gable-outline:mesh');
    expect(mesh.geometry.type).toBe('ExtrudeGeometry');
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
    const invalid = structuredClone(spec);
    invalid.componentTree[0].geometryDescriptor.points[0][0] = 4;
    expect(() => createObjectSculptModel(THREE, invalid)).toThrow('二维坐标');
  });

  it('applies hidden visibility and preserves locked metadata on component groups', () => {
    const spec = castleSpec();
    spec.componentTree[0].hidden = true;
    spec.componentTree[1].locked = true;
    const model = createObjectSculptModel(THREE, spec);
    const keep = model.getObjectByName('keep');
    const tower = model.getObjectByName('west-tower');
    expect(keep.visible).toBe(false);
    expect(keep.userData.componentHidden).toBe(true);
    expect(tower.userData.componentLocked).toBe(true);
    expect(tower.visible).toBe(true);
  });

  it('accepts an upstream-style component tree independent of renderer objects', () => {
    const result = validateObjectSculptSpec(castleSpec());
    expect(result.componentCount).toBe(8);
    expect(result.nodes.get('west-roof').parent).toBe('west-tower');
  });

  it('rejects duplicate IDs, missing parents and cyclic hierarchies', () => {
    const duplicate = castleSpec();
    duplicate.componentTree.push({ ...duplicate.componentTree[0] });
    expect(() => validateObjectSculptSpec(duplicate)).toThrow('组件 id 重复');

    const missing = castleSpec();
    missing.componentTree[0].parent = 'missing';
    expect(() => validateObjectSculptSpec(missing)).toThrow('组件父节点不存在');

    const cyclic = castleSpec();
    cyclic.componentTree[0].parent = 'west-tower';
    expect(() => validateObjectSculptSpec(cyclic)).toThrow('循环引用');
  });

  it('rejects unsupported primitives and out-of-range dimensions', () => {
    const unsupported = castleSpec();
    unsupported.componentTree[0].primitive = 'javascript';
    expect(() => createObjectSculptModel(THREE, unsupported)).toThrow('不支持的重建几何 primitive');

    const oversized = castleSpec();
    oversized.componentTree[0].dimensions.width = 1000;
    expect(() => createObjectSculptModel(THREE, oversized)).toThrow('超出允许范围');
  });

  it('falls back safely when a material entry is null or malformed', () => {
    const spec = castleSpec();
    spec.materials.stone = null;
    expect(() => createObjectSculptModel(THREE, spec)).not.toThrow();
  });

  it('enforces component count and hierarchy depth budgets', () => {
    const tooMany = castleSpec();
    tooMany.componentTree = Array.from({ length: 301 }, (_, index) => ({
      id: 'part-' + index, primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 },
    }));
    expect(() => validateObjectSculptSpec(tooMany)).toThrow('componentTree 数量');

    const tooDeep = castleSpec();
    tooDeep.componentTree = Array.from({ length: 18 }, (_, index) => ({
      id: 'level-' + index,
      parent: index ? 'level-' + (index - 1) : null,
      primitive: 'box',
      dimensions: { width: 1, height: 1, depth: 1 },
    }));
    expect(() => validateObjectSculptSpec(tooDeep)).toThrow('组件层级超过');
  });
});
