import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createObjectSculptModel, validateObjectSculptSpec, applyObjectSculptParameter, resolveEditableParameterTarget } from './createObjectSculptModel.js';
import { createObjectModelParameterContractCases } from '../../../server/src/shared/object-model-parameter-contract.fixtures.ts';

function castleSpec() {
  return {
    schemaVersion: '3.0',
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
      schemaVersion: '3.0',
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
      schemaVersion: '3.0',
      materials: { shared: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'left', parent: 'root', primitive: 'box', material: 'shared', dimensions: { width: 1, height: 1, depth: 1 } },
        { id: 'right', parent: 'root', primitive: 'box', material: 'shared', dimensions: { width: 1, height: 1, depth: 1 }, transform: { position: [2, 0, 0] } },
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

  it('routes box and cuboid geometry through their registered capability executors', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'box', parent: 'root', primitive: 'box', dimensions: { width: 2, height: 2, depth: 2 } },
        { id: 'cuboid', parent: 'root', primitive: 'cuboid', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    expect(model.getObjectByName('box:mesh').geometry.type).toBe('BoxGeometry');
    expect(model.getObjectByName('cuboid:mesh').geometry.type).toBe('BoxGeometry');
  });

  it('rejects malformed box opening descriptors before invoking the executor', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'root', kind: 'group',
      }, {
        id: 'wall', parent: 'root', primitive: 'box',
        dimensions: { width: 2, height: 2, depth: 0.2 },
        geometryDescriptor: { openings: [{ width: 0.5, height: 0.5, center: [0] }] },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('center 必须是两个有限数值');
  });

  it('builds dedicated arch openings and wedge roof geometry', () => {
    const spec = {
      schemaVersion: '3.0',
      materials: { stone: { color: '#d8c39a' } },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'arch', parent: 'root', primitive: 'arch', material: 'stone', dimensions: { width: 3, height: 4, depth: 0.5 }, geometryDescriptor: { inset: 0.35 } },
        { id: 'gable', parent: 'root', primitive: 'wedge', material: 'stone', dimensions: { width: 5, height: 2, depth: 3 } },
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
      schemaVersion: '3.0',
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


  it('executes cylinder, cone, sphere, ellipsoid and torus through registered capabilities', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'cylinder', parent: 'root', primitive: 'cylinder', dimensions: { width: 2, height: 4, depth: 1 }, geometryDescriptor: { segments: 12 } },
        { id: 'cone', parent: 'root', primitive: 'cone', dimensions: { width: 3, height: 5, depth: 2 }, geometryDescriptor: { segments: 10 } },
        { id: 'sphere', parent: 'root', primitive: 'sphere', dimensions: { width: 2, height: 3, depth: 4 }, geometryDescriptor: { segments: 12 } },
        { id: 'ellipsoid', parent: 'root', primitive: 'ellipsoid', dimensions: { width: 4, height: 2, depth: 3 }, geometryDescriptor: { segments: 14 } },
        { id: 'torus', parent: 'root', primitive: 'torus', dimensions: { width: 4, height: 1, depth: 2 }, geometryDescriptor: { segments: 20, tube: 0.2 } },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    const cylinder = model.getObjectByName('cylinder:mesh').geometry;
    const cone = model.getObjectByName('cone:mesh').geometry;
    const sphereMesh = model.getObjectByName('sphere:mesh');
    const sphere = sphereMesh.geometry;
    const ellipsoidMesh = model.getObjectByName('ellipsoid:mesh');
    const ellipsoid = ellipsoidMesh.geometry;
    const torus = model.getObjectByName('torus:mesh').geometry;
    expect(cylinder.type).toBe('CylinderGeometry');
    expect(cylinder.parameters).toMatchObject({ radiusTop: 1, radiusBottom: 0.5, height: 4, radialSegments: 12 });
    expect(cone.type).toBe('ConeGeometry');
    expect(cone.parameters).toMatchObject({ radius: 1.5, height: 5, radialSegments: 10 });
    expect(sphere.type).toBe('SphereGeometry');
    expect(sphereMesh.scale.toArray()).toEqual([2, 3, 4]);
    expect(ellipsoid.type).toBe('SphereGeometry');
    expect(ellipsoidMesh.scale.toArray()).toEqual([4, 2, 3]);
    expect(torus.type).toBe('TorusGeometry');
    expect(torus.parameters).toMatchObject({ radius: 1.8, tube: 0.2, radialSegments: 16, tubularSegments: 20 });
  });

  it('rejects torus tube values outside the existing geometry bounds', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'torus', primitive: 'torus', dimensions: { width: 2, height: 1, depth: 2 },
        geometryDescriptor: { tube: 0.9 },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('torus.tube 超出允许范围');
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
    expect(() => createObjectSculptModel(THREE, unsupported)).toThrow('组件几何类型不受支持');

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
  it('rejects legacy 2.0 specs and generator fields at the runtime boundary', () => {
    const legacyVersion = castleSpec();
    legacyVersion.schemaVersion = '2.0';
    expect(() => createObjectSculptModel(THREE, legacyVersion)).toThrow('ObjectModelSpec 3.0 无效');

    const legacyGenerator = castleSpec();
    legacyGenerator.generators = [];
    expect(() => createObjectSculptModel(THREE, legacyGenerator)).toThrow('不接受 generators/constraints');
  });

  it('applies AI-declared parameters to linked components without cumulative drift', () => {
    const spec = {
      schemaVersion: '3.0',
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


  it('builds a continuous tube mesh from a bounded declarative 3D path', () => {
    const spec = {
      schemaVersion: '3.0',
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
      schemaVersion: '3.0',
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

  it('builds a continuous parallel-transport sweep mesh from a 3D path and a 2D cross-section', () => {
    const spec = {
      schemaVersion: '3.0',
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
    expect(mesh.geometry.type).toBe('BufferGeometry');
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(100);
    expect(mesh.geometry.getIndex().count).toBeGreaterThan(100);
    expect(mesh.geometry.boundingSphere).not.toBeNull();
    expect(mesh.geometry.getAttribute('normal').count).toBe(mesh.geometry.getAttribute('position').count);
  });

  it('keeps sweep cap triangles correctly indexed and consistently oriented for either profile winding', () => {
    const build = profile => createObjectSculptModel(THREE, {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'straight-sweep', primitive: 'sweep', material: 'default',
        dimensions: { width: 4, height: 2, depth: 2 },
        geometryDescriptor: {
          path: [[-0.5, 0, 0], [0.5, 0, 0]],
          profile,
          steps: 8,
        },
      }],
    }).userData.componentGroups.get('straight-sweep').getObjectByName('straight-sweep:mesh').geometry;
    const ccw = [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]];
    const geometries = [build(ccw), build([...ccw].reverse())];
    for (const geometry of geometries) {
      const index = geometry.getIndex();
      const position = geometry.getAttribute('position');
      const sideIndexCount = 8 * 4 * 6;
      expect(index.count % 3).toBe(0);
      expect(index.count - sideIndexCount).toBe(12);
      const faceNormal = offset => {
        const ids = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
        const a = new THREE.Vector3().fromBufferAttribute(position, ids[0]);
        const b = new THREE.Vector3().fromBufferAttribute(position, ids[1]);
        const c = new THREE.Vector3().fromBufferAttribute(position, ids[2]);
        return b.sub(a).cross(c.sub(a)).normalize();
      };
      // Two start-cap triangles (3 indices each), then two end-cap triangles.
      expect(faceNormal(sideIndexCount).x).toBeLessThan(-0.99);
      expect(faceNormal(sideIndexCount + 3).x).toBeLessThan(-0.99);
      expect(faceNormal(sideIndexCount + 6).x).toBeGreaterThan(0.99);
      expect(faceNormal(sideIndexCount + 9).x).toBeGreaterThan(0.99);
      for (let offset = sideIndexCount; offset < index.count; offset += 3) {
        const ids = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
        expect(new Set(ids).size).toBe(3);
      }
      geometry.dispose();
    }
  });

  it('rejects closed sweep paths until seam frame correction is implemented', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'closed-sweep', primitive: 'sweep', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          path: [[-0.4, 0, 0], [0, 0.4, 0], [0.4, 0, 0], [0, -0.4, 0]],
          profile: [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]],
          closed: true,
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('暂不支持闭合扫掠路径');
  });

  it('builds a loft mesh between ordered cross-sections and closes both ends', () => {
    const spec = {
      schemaVersion: '3.0',
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
    expect(mesh.geometry.getAttribute('position').count).toBe(32);
    expect(mesh.geometry.getIndex().count).toBeGreaterThan(36);
    expect(mesh.geometry.getAttribute('normal').count).toBe(32);
  });

  it('orients loft side faces and end caps consistently for clockwise input contours', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'loft-solid', primitive: 'loft', material: 'default',
        dimensions: { width: 2, height: 2, depth: 2 },
        geometryDescriptor: {
          sections: [
            { height: -0.5, points: [[-0.4, -0.4], [-0.4, 0.4], [0.4, 0.4], [0.4, -0.4]] },
            { height: 0.5, points: [[-0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0.3, -0.3]] },
          ],
        },
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const mesh = model.userData.componentGroups.get('loft-solid').getObjectByName('loft-solid:mesh');
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const faceNormal = (offset) => {
      const ids = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
      const a = new THREE.Vector3().fromBufferAttribute(position, ids[0]);
      const b = new THREE.Vector3().fromBufferAttribute(position, ids[1]);
      const d = new THREE.Vector3().fromBufferAttribute(position, ids[2]);
      return b.sub(a).cross(d.sub(a)).normalize();
    };
    // 4 side edges × 2 triangles × 3 indices = 24 indices before the caps.
    expect(faceNormal(0).x).toBeGreaterThan(0);
    expect(faceNormal(24).y).toBeLessThan(0);
    expect(faceNormal(30).y).toBeGreaterThan(0);
    const normals = mesh.geometry.getAttribute('normal');
    // The same lower corner is duplicated for its two adjoining wall faces.
    const cornerA = new THREE.Vector3().fromBufferAttribute(normals, 0);
    const cornerB = new THREE.Vector3().fromBufferAttribute(normals, 7);
    expect(cornerA.dot(cornerB)).toBeLessThan(0.9);
  });

  it('keeps loft side-face winding aligned with generated vertex normals across multiple sections', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'offset-loft', primitive: 'loft', material: 'default',
        dimensions: { width: 4, height: 6, depth: 3 },
        geometryDescriptor: {
          sections: [
            { height: -0.5, points: [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]] },
            { height: 0, points: [[-0.3, -0.35], [0.35, -0.3], [0.3, 0.35], [-0.35, 0.3]] },
            { height: 0.5, points: [[-0.2, -0.25], [0.25, -0.2], [0.2, 0.25], [-0.25, 0.2]] },
          ],
        },
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const mesh = model.userData.componentGroups.get('offset-loft').getObjectByName('offset-loft:mesh');
    const position = mesh.geometry.getAttribute('position');
    const normals = mesh.geometry.getAttribute('normal');
    const index = mesh.geometry.getIndex();
    const ringSize = 4;
    const sideIndexCount = (3 - 1) * ringSize * 6;

    for (let offset = 0; offset < sideIndexCount; offset += 3) {
      const ids = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
      const a = new THREE.Vector3().fromBufferAttribute(position, ids[0]);
      const b = new THREE.Vector3().fromBufferAttribute(position, ids[1]);
      const c = new THREE.Vector3().fromBufferAttribute(position, ids[2]);
      const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
      expect(faceNormal.length()).toBeGreaterThan(0.99);
      ids.forEach(id => {
        const vertexNormal = new THREE.Vector3().fromBufferAttribute(normals, id);
        expect(faceNormal.dot(vertexNormal)).toBeGreaterThan(0.5);
      });
    }
  });

  it('rejects loft sections with inconsistent contour winding', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'twisted-loft', primitive: 'loft', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          sections: [
            { height: -0.5, points: [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]] },
            { height: 0.5, points: [[-0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0.3, -0.3]] },
          ],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('必须保持一致的轮廓绕序');
  });

  it('rejects self-intersecting sweep cross-sections before mesh construction', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'crossed-sweep', primitive: 'sweep', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          path: [[-0.5, 0, 0], [0.5, 0, 0]],
          profile: [[-0.4, -0.4], [0.4, 0.4], [-0.4, 0.5], [0.5, -0.4]],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('存在自相交边');
  });

  it('rejects sharp reversing turns in sweep paths before geometry construction', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'reversing-sweep', primitive: 'sweep', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          path: [[-0.5, 0, 0], [0, 0, 0], [-0.45, 0.02, 0]],
          profile: [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('超过 150° 的急转弯');
  });

  it('rejects duplicate adjacent points in sweep paths', () => {
    const spec = {
      schemaVersion: '3.0',
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
      schemaVersion: '3.0',
      componentTree: [{
        id: 'crossed-loft', primitive: 'loft', material: 'default',
        dimensions: { width: 1, height: 1, depth: 1 },
        geometryDescriptor: {
          sections: [
            { height: -0.5, points: [[-0.4, -0.4], [0.4, 0.4], [-0.4, 0.5], [0.5, -0.4]] },
            { height: 0.5, points: [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]] },
          ],
        },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('存在自相交边');
  });

  it('rejects loft sections that do not share the same profile topology', () => {
    const spec = {
      schemaVersion: '3.0',
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

  it('keeps sweep side normals aligned along a non-planar parallel-transport path', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'spatial-sweep', primitive: 'sweep', material: 'default',
        dimensions: { width: 3, height: 3, depth: 3 },
        geometryDescriptor: {
          path: [[-0.45, -0.25, -0.2], [-0.15, -0.1, -0.05], [0.15, 0.1, 0.05], [0.45, 0.25, 0.2]],
          profile: [[-0.025, -0.02], [0.025, -0.02], [0.025, 0.02], [-0.025, 0.02]],
          steps: 48,
        },
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const mesh = model.userData.componentGroups.get('spatial-sweep').getObjectByName('spatial-sweep:mesh');
    const position = mesh.geometry.getAttribute('position');
    const normals = mesh.geometry.getAttribute('normal');
    const index = mesh.geometry.getIndex();
    const sideIndexCount = 48 * 4 * 6;

    for (let offset = 0; offset < sideIndexCount; offset += 3) {
      const ids = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
      const a = new THREE.Vector3().fromBufferAttribute(position, ids[0]);
      const b = new THREE.Vector3().fromBufferAttribute(position, ids[1]);
      const c = new THREE.Vector3().fromBufferAttribute(position, ids[2]);
      const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
      ids.forEach(id => {
        const vertexNormal = new THREE.Vector3().fromBufferAttribute(normals, id);
        expect(faceNormal.dot(vertexNormal)).toBeGreaterThan(0.25);
      });
    }
  });

  it('rejects sweep profiles with invalid normalized cross-section coordinates', () => {
    const spec = {
      schemaVersion: '3.0',
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
      schemaVersion: '3.0',
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
      schemaVersion: '3.0',
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
      schemaVersion: '3.0',
      componentTree: [{ id: 'root', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } }],
      parameterSchema: [{ id: 'unsafe', type: 'number', value: 1, min: 0, max: 2, targets: [{ nodeId: 'root', property: 'constructor.prototype', mode: 'set' }] }],
    };
    expect(() => validateObjectSculptSpec(spec)).toThrow('参数目标属性不受支持');
  });

  it('supports AI-declared shape selectors and floor visibility dependencies', () => {
    const spec = {
      schemaVersion: '3.0',
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

  it('applies boolean visibility parameter defaults on the initial build', () => {
    const spec = {
      schemaVersion: '3.0',
      targetName: 'core-visibility',
      materials: { concrete: { color: '#888888', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'core', parent: 'root', primitive: 'box', material: 'concrete',
          dimensions: { width: 1, height: 4, depth: 1 }, hidden: true },
      ],
      parameterSchema: [{
        id: 'coreVisible', label: '核心筒显示', type: 'boolean', value: true,
        targets: [{ nodeId: 'core', property: 'visibility.visible', mode: 'set' }],
      }],
      operations: [],
    };
    const model = createObjectSculptModel(THREE, spec);
    expect(model.userData.componentGroups.get('core').visible).toBe(true);
    applyObjectSculptParameter(THREE, model, 'coreVisible', false);
    expect(model.userData.componentGroups.get('core').visible).toBe(false);
    expect(model.userData.objectSculptSpec.parameterSchema[0].value).toBe(false);
  });

  it('rebuilds operation instances when an operation count parameter changes', () => {
    const spec = {
      schemaVersion: '3.0',
      targetName: 'linear-ribs',
      materials: { steel: { color: '#777777', roughness: 0.5, metalness: 0.8 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'rib-unit', kind: 'group', parent: 'root' },
        { id: 'rib', parent: 'rib-unit', primitive: 'tube', material: 'steel',
          dimensions: { width: 1, height: 1, depth: 1 },
          geometryDescriptor: { path: [[0, -0.5, 0], [0, 0.5, 0]], radius: 0.025 } },
      ],
      parameterSchema: [{
        id: 'rib-count', label: '肋条数量', type: 'number', value: 4, min: 1, max: 12, step: 1, targets: [],
      }],
      operations: [{
        id: 'rib-array', type: 'instance', sourceRootId: 'rib-unit',
        count: { parameterId: 'rib-count' },
        transform: { position: [{ op: 'index' }, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    const countInstances = () => [...model.userData.componentGroups.values()]
      .filter(group => group.userData.componentSourceId === 'rib').length;
    expect(countInstances()).toBe(4);
    const sourceMappedMeshes = () => {
      const meshes = [];
      model.traverse(object => { if (object.isMesh) meshes.push(object); });
      return meshes;
    };
    expect(sourceMappedMeshes()).toHaveLength(4);
    expect(sourceMappedMeshes().every(mesh => mesh.userData.componentSourceId === 'rib')).toBe(true);
    applyObjectSculptParameter(THREE, model, 'rib-count', 7);
    expect(countInstances()).toBe(7);
    expect(sourceMappedMeshes()).toHaveLength(7);
    expect(sourceMappedMeshes().every(mesh => mesh.userData.componentSourceId === 'rib')).toBe(true);
    expect(model.userData.objectSculptSpec.parameterSchema[0].value).toBe(7);
  });

  it('exposes geometry descriptor scalars as dynamic parameters in ObjectModelSpec 3.0', () => {
    const spec = {
      schemaVersion: '3.0',
      targetName: 'steel-frame',
      materials: { steel: { color: '#777777', roughness: 0.6, metalness: 0.7 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        {
          id: 'rib', parent: 'root', primitive: 'tube',
          dimensions: { width: 1, height: 1, depth: 1 },
          geometryDescriptor: {
            path: [[0, -0.5, 0], [0, 0.5, 0]],
            radius: 0.08,
            tubularSegments: 12,
            radialSegments: 6,
          },
          material: 'steel',
        },
      ],
      parameterSchema: [{
        id: 'rib-radius', label: '钢丝管径', type: 'number',
        value: 0.08, min: 0.04, max: 0.12, step: 0.005,
        targets: [{ nodeId: 'rib', property: 'geometryDescriptor.radius', mode: 'set' }],
      }],
      operations: [],
    };
    const model = createObjectSculptModel(THREE, spec);
    const mesh = model.userData.componentGroups.get('rib').getObjectByName('rib:mesh');
    expect(mesh.geometry.parameters.radius).toBeCloseTo(0.08);
    applyObjectSculptParameter(THREE, model, 'rib-radius', 0.1);
    expect(model.userData.objectSculptSpec.componentTree.find(node => node.id === 'rib').geometryDescriptor.radius).toBeCloseTo(0.1);
    expect(model.userData.componentGroups.get('rib').getObjectByName('rib:mesh').geometry.parameters.radius).toBeCloseTo(0.1);
  });

  it('uses the shared parameter target resolver and normalizes legacy material aliases at runtime', () => {
    const spec = {
      schemaVersion: '3.0',
      materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0 } },
      componentTree: [{ id: 'wall-panel', primitive: 'box', material: 'wall', dimensions: { width: 2, height: 2, depth: 0.2 } }],
      parameterSchema: [{
        id: 'legacy-wall-color', type: 'color', value: '#aabbcc',
        targets: [{ nodeId: 'wall-panel', property: 'lattice_color' }],
      }],
    };
    expect(resolveEditableParameterTarget(
      { id: 'node', primitive: 'box', geometryDescriptor: { label: 'custom' } },
      {},
      'geometryDescriptor.label',
    )).toMatchObject({ value: 'custom', kind: 'select' });
    expect(resolveEditableParameterTarget(
      { id: 'panel', primitive: 'box', material: 'wall' },
      { wall: { color: '#cccccc' } },
      'lattice_color',
    )).toMatchObject({ value: '#cccccc', kind: 'color' });

    const model = createObjectSculptModel(THREE, spec);
    expect(model.userData.objectSculptSpec.parameterSchema[0].targets[0].property).toBe('material.color');
    expect(model.userData.objectSculptSpec.materials[model.userData.objectSculptSpec.componentTree[0].material].color).toBe('#aabbcc');
    expect(spec.parameterSchema[0].targets[0].property).toBe('lattice_color');
  });

  it('builds frontend models from the shared accepted parameter contract cases', () => {
    for (const contract of createObjectModelParameterContractCases()) {
      if (contract.validator !== 'accept') continue;
      const input = structuredClone(contract.spec);
      const model = createObjectSculptModel(THREE, input);
      expect(model.userData.objectSculptSpec.parameterSchema).toHaveLength(input.parameterSchema.length);
      expect(input.parameterSchema).toEqual(contract.spec.parameterSchema);
    }
  });

});
