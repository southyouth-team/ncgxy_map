import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createObjectSculptModel, validateObjectSculptSpec, applyObjectSculptParameter } from './createObjectSculptModel.js';

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


  it('builds pure logical Group nodes without creating placeholder meshes', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'root-group', kind: 'group', name: '主体分组' },
        { id: 'facade-group', kind: 'group', name: '立面分组', parent: 'root-group', transform: { position: [0, 2, 0] } },
        { id: 'wall', kind: 'mesh', primitive: 'box', material: 'wall', parent: 'facade-group', dimensions: { width: 4, height: 4, depth: 0.4 } },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    const rootGroup = model.userData.componentGroups.get('root-group');
    const facadeGroup = model.userData.componentGroups.get('facade-group');
    expect(rootGroup.isGroup).toBe(true);
    expect(facadeGroup.parent).toBe(rootGroup);
    expect(rootGroup.children.some(child => child.isMesh)).toBe(false);
    expect(facadeGroup.children.some(child => child.isMesh)).toBe(false);
    expect(model.getObjectByName('wall:mesh').isMesh).toBe(true);
    expect(model.userData.objectSculpt.componentCount).toBe(3);
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
    const keep = model.getObjectByName('主城堡主体');
    const tower = model.getObjectByName('西侧圆塔');
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
  it('applies AI-declared parameters to linked components without cumulative drift', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'body', primitive: 'box', material: 'wall', dimensions: { width: 4, height: 2, depth: 3 } },
        { id: 'window-a', parent: 'body', primitive: 'box', material: 'wall', dimensions: { width: 1, height: 1, depth: 0.1 }, transform: { position: [-1, 0, 1.5] } },
        { id: 'window-b', parent: 'body', primitive: 'box', material: 'wall', dimensions: { width: 1, height: 1, depth: 0.1 }, transform: { position: [1, 0, 1.5] } },
      ],
      parameterSchema: [{
        id: 'window-height', label: '窗户高度', type: 'number', value: 1, min: 0.5, max: 2, step: 0.1, unit: 'm',
        targets: [
          { nodeId: 'window-a', property: 'dimensions.height', mode: 'set' },
          { nodeId: 'window-b', property: 'dimensions.height', mode: 'set' },
        ],
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    applyObjectSculptParameter(THREE, model, 'window-height', 1.6);
    expect(model.userData.objectSculptSpec.componentTree.filter(node => node.id.startsWith('window')).map(node => node.dimensions.height)).toEqual([1.6, 1.6]);
    applyObjectSculptParameter(THREE, model, 'window-height', 1.2);
    expect(model.userData.objectSculptSpec.componentTree.filter(node => node.id.startsWith('window')).map(node => node.dimensions.height)).toEqual([1.2, 1.2]);
    expect(model.userData.objectSculptSpec.parameterSchema[0].value).toBe(1.2);
  });


  it('rebuilds repeat-generated component subtrees when a template count parameter changes', () => {
    const spec = {
      schemaVersion: '2.0',
      targetName: 'three-storey-school',
      materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'building-root', kind: 'group', name: '教学楼主体' },
        { id: 'floor-prototype', kind: 'group', name: '标准楼层', parent: 'building-root', transform: { position: [0, 0, 0] } },
        { id: 'floor-slab', kind: 'mesh', name: '楼板', parent: 'floor-prototype', primitive: 'box', material: 'wall', dimensions: { width: 8, height: 0.25, depth: 6 }, transform: { position: [0, 0, 0] } },
        { id: 'roof', kind: 'mesh', name: '屋顶', parent: 'building-root', primitive: 'box', material: 'wall', dimensions: { width: 8.5, height: 0.4, depth: 6.5 }, transform: { position: [0, 11, 0] } },
      ],
      parameterSchema: [{
        id: 'floor-count', label: '楼层数', type: 'number', value: 3, min: 1, max: 8, step: 1, unit: '层', targets: [],
      }],
      generators: [{
        id: 'floor-repeat', type: 'repeat', templateRootId: 'floor-prototype', countParameterId: 'floor-count',
        axis: 'y', spacing: 3.2, defaultCount: 3, maxCount: 8, followers: [{ nodeId: 'roof', axis: 'y', offset: 0 }],
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    expect(model.userData.componentGroups.size).toBe(8);
    expect([...model.userData.componentGroups.keys()].some(id => id.startsWith('generated-'))).toBe(true);
    applyObjectSculptParameter(THREE, model, 'floor-count', 5);
    expect(model.userData.objectSculptSpec.parameterSchema[0].value).toBe(5);
    expect(model.userData.objectSculptSpec.generators).toHaveLength(1);
    expect(model.userData.componentGroups.size).toBe(12);
    const fifthFloor = [...model.userData.componentGroups.values()].find(group => group.userData.componentSourceId === 'floor-prototype' && Math.abs(group.position.y - 12.8) < 0.001);
    expect(fifthFloor).toBeDefined();
    expect(model.userData.componentGroups.get('roof').position.y).toBeCloseTo(17.4);
    const reloaded = createObjectSculptModel(THREE, structuredClone(model.userData.objectSculptSpec));
    expect(reloaded.userData.componentGroups.size).toBe(12);
    expect(reloaded.userData.componentGroups.get('roof').position.y).toBeCloseTo(17.4);
    applyObjectSculptParameter(THREE, model, 'floor-count', 2);
    expect(model.userData.componentGroups.size).toBe(6);
    expect(model.userData.componentGroups.get('roof').position.y).toBeCloseTo(7.8);
    expect([...model.userData.componentGroups.keys()].filter(id => id.startsWith('generated-'))).toHaveLength(2);
  });


  it('rebuilds room layouts as a deterministic two-dimensional grid', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'building-root', kind: 'group', name: '教学楼' },
        { id: 'room-prototype', kind: 'group', name: '标准教室', parent: 'building-root' },
        { id: 'room-shell', kind: 'mesh', name: '教室主体', parent: 'room-prototype', primitive: 'box', material: 'wall', dimensions: { width: 6, height: 3, depth: 5 } },
      ],
      parameterSchema: [
        { id: 'room-rows', label: '房间行数', type: 'number', value: 2, min: 1, max: 4, step: 1, targets: [] },
        { id: 'room-columns', label: '房间列数', type: 'number', value: 3, min: 1, max: 5, step: 1, targets: [] },
      ],
      generators: [{
        id: 'room-grid', type: 'grid', templateRootId: 'room-prototype',
        rowParameterId: 'room-rows', columnParameterId: 'room-columns',
        spacingX: 7, spacingZ: 6, defaultRows: 2, defaultColumns: 3, maxRows: 4, maxColumns: 5,
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    expect(model.userData.componentGroups.size).toBe(13);
    const roomAtSecondColumn = [...model.userData.componentGroups.values()].find(group =>
      group.userData.componentSourceId === 'room-prototype' && Math.abs(group.position.x - 7) < 0.001 && Math.abs(group.position.z) < 0.001);
    expect(roomAtSecondColumn).toBeDefined();
    const roomAtSecondRow = [...model.userData.componentGroups.values()].find(group =>
      group.userData.componentSourceId === 'room-prototype' && Math.abs(group.position.x) < 0.001 && Math.abs(group.position.z - 6) < 0.001);
    expect(roomAtSecondRow).toBeDefined();
    const originalGeneratedIds = [...model.userData.componentGroups.keys()].filter(id => id.startsWith('generated-')).sort();
    applyObjectSculptParameter(THREE, model, 'room-rows', 3);
    applyObjectSculptParameter(THREE, model, 'room-columns', 2);
    expect(model.userData.objectSculptSpec.parameterSchema.find(item => item.id === 'room-rows').value).toBe(3);
    expect(model.userData.objectSculptSpec.parameterSchema.find(item => item.id === 'room-columns').value).toBe(2);
    expect(model.userData.componentGroups.size).toBe(13);
    expect([...model.userData.componentGroups.keys()].filter(id => id.startsWith('generated-')).sort()).not.toEqual(originalGeneratedIds);
    const reloaded = createObjectSculptModel(THREE, structuredClone(model.userData.objectSculptSpec));
    expect(reloaded.userData.componentGroups.size).toBe(13);
  });

  it('builds a continuous tube mesh from a bounded declarative 3D path', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { metal: { color: '#777777', roughness: 0.35, metalness: 0.7 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'handrail', kind: 'mesh', parent: 'root', primitive: 'tube', material: 'metal',
          dimensions: { width: 4, height: 3, depth: 2 },
          geometryDescriptor: {
            path: [[-0.5, -0.3, 0], [-0.2, 0.1, 0], [0.2, 0.1, 0.2], [0.5, -0.3, 0.2]],
            radius: 0.06, tubularSegments: 48, radialSegments: 10,
          } },
      ],
      parameterSchema: [{ id: 'rail-radius', label: '扶手半径', type: 'number', value: 0.06, min: 0.03, max: 0.12, step: 0.01,
        targets: [{ nodeId: 'handrail', property: 'geometryDescriptor.radius', mode: 'set' }] }],
    };
    const model = createObjectSculptModel(THREE, spec);
    let mesh = model.userData.componentGroups.get('handrail').getObjectByName('handrail:mesh');
    expect(mesh.geometry.type).toBe('TubeGeometry');
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(100);
    expect(mesh.geometry.getAttribute('normal').count).toBe(mesh.geometry.getAttribute('position').count);
    applyObjectSculptParameter(THREE, model, 'rail-radius', 0.1);
    mesh = model.userData.componentGroups.get('handrail').getObjectByName('handrail:mesh');
    expect(mesh.geometry.parameters.radius).toBe(0.1);
    expect(model.userData.objectSculptSpec.componentTree.find(node => node.id === 'handrail').geometryDescriptor.radius).toBe(0.1);
  });

  it('builds a lathe mesh from a bounded radial profile and recalculates it when dimensions change', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { ceramic: { color: '#d7b98c', roughness: 0.72, metalness: 0 } },
      componentTree: [{
        id: 'vase', primitive: 'lathe', material: 'ceramic',
        dimensions: { width: 2, height: 3, depth: 2 },
        geometryDescriptor: {
          profile: [[0, -0.5], [0.28, -0.48], [0.34, -0.3], [0.22, 0.05], [0.3, 0.32], [0.38, 0.5]],
        },
      }],
      parameterSchema: [{
        id: 'vase-height', label: '花瓶高度', type: 'number', value: 3, min: 2, max: 5, step: 0.5,
        targets: [{ nodeId: 'vase', property: 'dimensions.height', mode: 'set' }],
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    let mesh = model.userData.componentGroups.get('vase').getObjectByName('vase:mesh');
    expect(mesh.geometry.type).toBe('LatheGeometry');
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(100);
    applyObjectSculptParameter(THREE, model, 'vase-height', 4.5);
    mesh = model.userData.componentGroups.get('vase').getObjectByName('vase:mesh');
    expect(mesh.geometry.parameters.points[0].y).toBe(-2.25);
    expect(model.userData.objectSculptSpec.componentTree.find(node => node.id === 'vase').dimensions.height).toBe(4.5);
  });

  it('builds a continuous sweep mesh from a 3D path and a 2D cross-section', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { metal: { color: '#777777', roughness: 0.35, metalness: 0.7 } },
      componentTree: [{
        id: 'curved-duct', primitive: 'sweep', material: 'metal',
        dimensions: { width: 4, height: 3, depth: 2 },
        geometryDescriptor: {
          path: [[-0.5, -0.3, 0], [-0.2, 0, 0], [0.2, 0.2, 0.1], [0.5, 0.3, 0.2]],
          profile: [[-0.08, -0.06], [0.08, -0.06], [0.08, 0.06], [-0.08, 0.06]],
          steps: 40,
        },
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const mesh = model.userData.componentGroups.get('curved-duct').getObjectByName('curved-duct:mesh');
    expect(mesh.geometry.type).toBe('ExtrudeGeometry');
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(100);
    expect(mesh.geometry.getAttribute('normal').count).toBe(mesh.geometry.getAttribute('position').count);
  });

  it('builds a loft mesh between ordered cross-sections and closes both ends', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { stone: { color: '#b9b4a8', roughness: 0.85, metalness: 0 } },
      componentTree: [{
        id: 'tapered-pillar', primitive: 'loft', material: 'stone',
        dimensions: { width: 3, height: 4, depth: 3 },
        geometryDescriptor: {
          sections: [
            { height: -0.5, points: [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]] },
            { height: 0, points: [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]] },
            { height: 0.5, points: [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]] },
          ],
        },
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const mesh = model.userData.componentGroups.get('tapered-pillar').getObjectByName('tapered-pillar:mesh');
    expect(mesh.geometry.type).toBe('BufferGeometry');
    expect(mesh.geometry.getAttribute('position').count).toBe(12);
    expect(mesh.geometry.getIndex().count).toBeGreaterThan(36);
    expect(mesh.geometry.getAttribute('normal').count).toBe(12);
  });

  it('rejects self-intersecting sweep cross-sections before mesh construction', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{
        id: 'crossed-sweep', primitive: 'sweep', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          path: [[-0.5, 0, 0], [0.5, 0, 0]],
          profile: [[-0.4, -0.4], [0.4, 0.4], [-0.4, 0.4], [0.4, -0.4]],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('存在自相交边');
  });

  it('rejects duplicate adjacent points in sweep paths', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{
        id: 'zero-path', primitive: 'sweep', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          path: [[-0.5, 0, 0], [-0.5, 0, 0], [0.5, 0, 0]],
          profile: [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('重复或零长度路径段');
  });

  it('rejects self-intersecting loft section contours', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{
        id: 'crossed-loft', primitive: 'loft', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          sections: [
            { height: -0.5, points: [[-0.4, -0.4], [0.4, 0.4], [-0.4, 0.4], [0.4, -0.4]] },
            { height: 0.5, points: [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]] },
          ],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('存在自相交边');
  });

  it('rejects loft sections that do not share the same profile topology', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{
        id: 'loft', primitive: 'loft', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          sections: [
            { height: -0.5, points: [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]] },
            { height: 0.5, points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] },
          ],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('必须具有相同数量的轮廓点');
  });

  it('rejects sweep profiles with invalid normalized cross-section coordinates', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{
        id: 'duct', primitive: 'sweep', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          path: [[-0.5, 0, 0], [0.5, 0, 0]],
          profile: [[-0.5, -0.5], [0.8, -0.5], [0, 0.5]],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('必须是 [-0.5,0.5] 范围内的二维坐标');
  });

  it('rejects lathe profiles outside normalized radius and height bounds', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{
        id: 'vase', primitive: 'lathe', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: { profile: [[0, -0.5], [0.7, 0.5]] },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('必须是 [0,0.5] 半径与 [-0.5,0.5] 高度');
  });

  it('rejects tube paths with coordinates outside the normalized bounds', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{
        id: 'cable', primitive: 'tube', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: { path: [[0, 0, 0], [0.8, 0, 0]] },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('必须是 [-0.5,0.5] 范围内的三维坐标');
  });

  it('rejects AI parameter targets outside the renderer allowlist', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [{ id: 'root', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } }],
      parameterSchema: [{ id: 'unsafe', type: 'number', value: 1, min: 0, max: 2, targets: [{ nodeId: 'root', property: 'constructor.prototype', mode: 'set' }] }],
    };
    expect(() => validateObjectSculptSpec(spec)).toThrow('参数目标属性不受支持');
  });

  it('supports AI-declared shape selectors and floor visibility dependencies', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'body', primitive: 'box', material: 'wall', dimensions: { width: 4, height: 4, depth: 3 } },
        { id: 'window', parent: 'body', primitive: 'box', material: 'wall', dimensions: { width: 1, height: 1.5, depth: 0.1 } },
        { id: 'floor-2', parent: 'body', primitive: 'box', material: 'wall', dimensions: { width: 3, height: 0.2, depth: 2 } },
        { id: 'floor-3', parent: 'body', primitive: 'box', material: 'wall', dimensions: { width: 3, height: 0.2, depth: 2 } },
      ],
      parameterSchema: [
        { id: 'window-shape', label: '窗户形状', type: 'select', value: 'box', options: [{ label: '矩形', value: 'box' }, { label: '拱形', value: 'arch' }], targets: [{ nodeId: 'window', property: 'geometry.primitive', mode: 'set' }] },
        { id: 'floor-count', label: '楼层数量', type: 'number', value: 2, min: 1, max: 3, targets: [
          { nodeId: 'floor-2', property: 'visibility.visible', mode: 'visible-from', threshold: 2 },
          { nodeId: 'floor-3', property: 'visibility.visible', mode: 'visible-from', threshold: 3 },
        ] },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    applyObjectSculptParameter(THREE, model, 'window-shape', 'arch');
    expect(model.userData.objectSculptSpec.componentTree.find(node => node.id === 'window').primitive).toBe('arch');
    applyObjectSculptParameter(THREE, model, 'floor-count', 2);
    expect(model.userData.componentGroups.get('floor-2').visible).toBe(true);
    expect(model.userData.componentGroups.get('floor-3').visible).toBe(false);
    expect(model.userData.objectSculptSpec.parameterSchema.find(item => item.id === 'window-shape').value).toBe('arch');
  });

  it('recalculates follow and span constraints from the baseline when grid dimensions change', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'building-root', kind: 'group', name: '建筑主体' },
        { id: 'room-prototype', kind: 'group', name: '房间原型', parent: 'building-root' },
        { id: 'room-shell', kind: 'mesh', name: '房间', parent: 'room-prototype', primitive: 'box', material: 'wall', dimensions: { width: 6, height: 3, depth: 5 } },
        { id: 'outer-wall', kind: 'mesh', name: '外墙边界', parent: 'building-root', primitive: 'box', material: 'wall', dimensions: { width: 6, height: 3, depth: 0.3 } },
        { id: 'roof', kind: 'mesh', name: '屋顶', parent: 'building-root', primitive: 'box', material: 'wall', dimensions: { width: 8, height: 0.4, depth: 7 }, transform: { position: [0, 4, 0] } },
        { id: 'decoration', kind: 'mesh', name: '独立装饰', parent: 'building-root', primitive: 'box', material: 'wall', dimensions: { width: 1, height: 1, depth: 1 }, transform: { position: [3, 2, 1] } },
      ],
      parameterSchema: [
        { id: 'rows', label: '行数', type: 'number', value: 2, min: 1, max: 4, step: 1, targets: [] },
        { id: 'columns', label: '列数', type: 'number', value: 3, min: 1, max: 5, step: 1, targets: [] },
      ],
      generators: [{
        id: 'room-grid', type: 'grid', templateRootId: 'room-prototype',
        rowParameterId: 'rows', columnParameterId: 'columns',
        spacingX: 7, spacingZ: 6, defaultRows: 2, defaultColumns: 3, maxRows: 4, maxColumns: 5,
      }],
      constraints: [
        { id: 'roof-follow', type: 'follow', sourceGeneratorId: 'room-grid', targetNodeId: 'roof', axis: 'x', measure: 'columns', factor: 1, offset: 0 },
        { id: 'wall-span', type: 'span', sourceGeneratorId: 'room-grid', targetNodeId: 'outer-wall', axis: 'x', measure: 'columns', property: 'dimensions.width', factor: 1, offset: 0 },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    expect(model.userData.componentGroups.get('roof').position.x).toBeCloseTo(14);
    expect(model.userData.componentGroups.get('outer-wall').getObjectByName('outer-wall:mesh').geometry.parameters.width).toBeCloseTo(20);
    applyObjectSculptParameter(THREE, model, 'columns', 2);
    expect(model.userData.componentGroups.get('roof').position.x).toBeCloseTo(7);
    expect(model.userData.componentGroups.get('outer-wall').getObjectByName('outer-wall:mesh').geometry.parameters.width).toBeCloseTo(13);
    applyObjectSculptParameter(THREE, model, 'columns', 4);
    expect(model.userData.componentGroups.get('roof').position.x).toBeCloseTo(21);
    expect(model.userData.componentGroups.get('outer-wall').getObjectByName('outer-wall:mesh').geometry.parameters.width).toBeCloseTo(27);
    expect(model.userData.componentGroups.get('decoration').position.toArray()).toEqual([3, 2, 1]);
  });

  it('rejects structural constraints that reference unknown generators or template nodes', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc' } },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'prototype', kind: 'group', parent: 'root' },
        { id: 'part', primitive: 'box', parent: 'prototype', material: 'wall', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
      parameterSchema: [{ id: 'count', type: 'number', value: 1, min: 1, max: 2, targets: [] }],
      generators: [{ id: 'repeat', type: 'repeat', templateRootId: 'prototype', countParameterId: 'count', axis: 'y', spacing: 2, defaultCount: 1, maxCount: 2 }],
      constraints: [{ id: 'bad-follow', type: 'follow', sourceGeneratorId: 'missing', targetNodeId: 'root', axis: 'y' }],
    };
    expect(() => validateObjectSculptSpec(spec)).toThrow('结构约束引用无效');
  });

  it('attaches sibling meshes by face anchors and records adjacency metadata', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc' } },
      componentTree: [
        { id: 'building', kind: 'group', name: '建筑主体' },
        { id: 'wall', kind: 'mesh', parent: 'building', primitive: 'box', material: 'wall',
          dimensions: { width: 4, height: 3, depth: 0.3 }, transform: { position: [0, 0, 0] } },
        { id: 'door', kind: 'mesh', parent: 'building', primitive: 'box', material: 'wall',
          dimensions: { width: 1, height: 2, depth: 0.2 }, transform: { position: [9, 0, 0] } },
        { id: 'corridor', kind: 'mesh', parent: 'building', primitive: 'box', material: 'wall',
          dimensions: { width: 3, height: 2.5, depth: 2 } },
      ],
      constraints: [
        { id: 'door-to-wall', type: 'attach', sourceNodeId: 'wall', targetNodeId: 'door',
          axis: 'x', sourceSide: 1, targetSide: -1, offset: 0 },
        { id: 'door-to-corridor', type: 'adjacency', sourceNodeId: 'door', targetNodeId: 'corridor', relation: 'connects' },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    expect(model.userData.componentGroups.get('door').position.x).toBeCloseTo(2.5);
    expect(model.userData.componentGroups.get('door').userData.componentRelations).toContainEqual({
      id: 'door-to-wall', type: 'attach', nodeId: 'wall', axis: 'x',
    });
    expect(model.userData.componentGroups.get('corridor').userData.componentRelations).toContainEqual({
      id: 'door-to-corridor', type: 'adjacency', relation: 'connects', nodeId: 'door',
    });
    expect(model.userData.componentGroups.get('door').userData.componentRelations).toContainEqual({
      id: 'door-to-corridor', type: 'adjacency', relation: 'connects', nodeId: 'corridor',
    });
  });

  it('rejects cyclic attach dependencies before building the model', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [
        { id: 'a', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } },
        { id: 'b', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
      constraints: [
        { id: 'a-to-b', type: 'attach', sourceNodeId: 'a', targetNodeId: 'b', axis: 'x', sourceSide: 1, targetSide: -1 },
        { id: 'b-to-a', type: 'attach', sourceNodeId: 'b', targetNodeId: 'a', axis: 'x', sourceSide: 1, targetSide: -1 },
      ],
    };
    expect(() => validateObjectSculptSpec(spec)).toThrow('attach 关系存在循环依赖');
  });

  it('rejects attach relations across different parent groups', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'left', kind: 'group', parent: 'root' },
        { id: 'right', kind: 'group', parent: 'root' },
        { id: 'a', parent: 'left', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } },
        { id: 'b', parent: 'right', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
      constraints: [{ id: 'invalid-attach', type: 'attach', sourceNodeId: 'a', targetNodeId: 'b',
        axis: 'x', sourceSide: 1, targetSide: -1 }],
    };
    expect(() => validateObjectSculptSpec(spec)).toThrow('attach 必须连接同一父级下的 Mesh 面');
  });

  it('cuts a real rectangular through-opening into a box mesh and hides its cutter volume', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc' } },
      componentTree: [
        { id: 'building', kind: 'group' },
        { id: 'wall', kind: 'mesh', parent: 'building', primitive: 'box', material: 'wall',
          dimensions: { width: 4, height: 3, depth: 0.3 } },
        { id: 'door-opening-volume', kind: 'mesh', parent: 'building', primitive: 'box', material: 'wall',
          dimensions: { width: 1, height: 2, depth: 0.5 }, transform: { position: [0.5, -0.2, 0] } },
      ],
      constraints: [{
        id: 'door-opening', type: 'cutout', targetNodeId: 'wall',
        cutterNodeId: 'door-opening-volume', axis: 'z', operation: 'subtract',
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const wall = model.userData.componentGroups.get('wall').getObjectByName('wall:mesh');
    expect(wall.geometry.type).toBe('ExtrudeGeometry');
    expect(wall.geometry.parameters.shapes.holes).toHaveLength(1);
    expect(wall.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(model.userData.componentGroups.get('door-opening-volume').children).toHaveLength(0);
  });

  it('rebuilds cutout geometry from baseline when opening width and position parameters change', () => {
    const spec = {
      schemaVersion: '2.0',
      materials: { wall: { color: '#cccccc', roughness: 0.8 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'wall', kind: 'mesh', parent: 'root', primitive: 'box', material: 'wall',
          dimensions: { width: 4, height: 3, depth: 0.3 } },
        { id: 'opening-volume', kind: 'mesh', parent: 'root', primitive: 'box', material: 'wall',
          dimensions: { width: 1, height: 2, depth: 0.5 }, transform: { position: [0, -0.2, 0] } },
      ],
      parameterSchema: [
        { id: 'opening-width', label: '开口宽度', type: 'number', value: 1, min: 0.5, max: 2, step: 0.1, unit: 'm',
          targets: [{ nodeId: 'opening-volume', property: 'dimensions.width', mode: 'set' }] },
        { id: 'opening-offset-x', label: '开口水平位置', type: 'number', value: 0, min: -1, max: 1, step: 0.1, unit: 'm',
          targets: [{ nodeId: 'opening-volume', property: 'transform.position.x', mode: 'set' }] },
      ],
      constraints: [{ id: 'wall-opening', type: 'cutout', targetNodeId: 'wall', cutterNodeId: 'opening-volume', axis: 'z', operation: 'subtract' }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const getWall = () => model.userData.componentGroups.get('wall').getObjectByName('wall:mesh');
    expect(getWall().geometry.parameters.shapes.holes).toHaveLength(1);
    expect(model.userData.componentGroups.get('opening-volume').children).toHaveLength(0);
    applyObjectSculptParameter(THREE, model, 'opening-width', 1.6);
    expect(getWall().geometry.parameters.shapes.holes).toHaveLength(1);
    expect(getWall().geometry.parameters.shapes.holes[0].getPoints().length).toBeGreaterThan(0);
    expect(model.userData.objectSculptSpec.componentTree.find(node => node.id === 'opening-volume').dimensions.width).toBe(1.6);
    applyObjectSculptParameter(THREE, model, 'opening-offset-x', 0.5);
    expect(model.userData.objectSculptSpec.componentTree.find(node => node.id === 'opening-volume').transform.position[0]).toBe(0.5);
    expect(getWall().geometry.parameters.shapes.holes).toHaveLength(1);
    const reloaded = createObjectSculptModel(THREE, structuredClone(model.userData.objectSculptSpec));
    expect(reloaded.userData.componentGroups.get('wall').getObjectByName('wall:mesh').geometry.parameters.shapes.holes).toHaveLength(1);
  });

  it('rejects cutouts that exceed the target mesh bounds', () => {
    const spec = {
      schemaVersion: '2.0',
      componentTree: [
        { id: 'wall', primitive: 'box', dimensions: { width: 2, height: 2, depth: 0.3 } },
        { id: 'opening', primitive: 'box', dimensions: { width: 1.5, height: 1, depth: 0.5 }, transform: { position: [0.8, 0, 0] } },
      ],
      constraints: [{ id: 'out-of-bounds', type: 'cutout', targetNodeId: 'wall', cutterNodeId: 'opening', axis: 'z', operation: 'subtract' }],
    };
    expect(() => validateObjectSculptSpec(spec)).toThrow('cutout 开口必须完整位于目标 Mesh 边界内');
  });

});
