import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createObjectSculptModel, createObjectSculptComponentGroup, validateObjectSculptSpec, applyObjectSculptParameter, applyObjectSculptMeshVertexUpdates, applyObjectSculptComponentChanges, resolveEditableParameterTarget, estimateObjectSculptPrimitiveGeometry } from './createObjectSculptModel.js';
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
  it('builds an isolated component group through the shared runtime builder', () => {
    const node = {
      id: 'isolated-body',
      kind: 'mesh',
      primitive: 'box',
      material: 'stone',
      dimensions: { width: 2, height: 3, depth: 4 },
      transform: { position: [1, 2, 3], rotation: [0, 0.2, 0], scale: [1, 1, 1] },
    };
    const group = createObjectSculptComponentGroup(THREE, node, {
      stone: { color: '#888888', roughness: 0.8, metalness: 0 },
    });
    expect(group.userData.componentId).toBe('isolated-body');
    expect(group.position.toArray()).toEqual([1, 2, 3]);
    expect(group.getObjectByName('isolated-body:mesh')?.isMesh).toBe(true);
    expect(group.getObjectByName('isolated-body:mesh')?.geometry.isBufferGeometry).toBe(true);
  });

  it('disposes partially constructed geometry and material when component construction fails', () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.MeshStandardMaterial.prototype, 'dispose');
    try {
      expect(() => createObjectSculptComponentGroup(THREE, {
        id: 'broken-component',
        primitive: 'box',
        dimensions: { width: 2, height: 2, depth: 2 },
        transform: { scale: [0, 1, 1] },
      })).toThrow('broken-component.scale 超出允许范围');
      expect(geometryDispose).toHaveBeenCalledTimes(1);
      expect(materialDispose).toHaveBeenCalledTimes(1);
    } finally {
      geometryDispose.mockRestore();
      materialDispose.mockRestore();
    }
  });

  it('keeps the live model intact and disposes staged resources when a later Mesh construction fails', () => {
    const model = createObjectSculptModel(THREE, {
      schemaVersion: '3.0',
      componentTree: [{ id: 'root', kind: 'group' }],
    });
    const rootGroup = model.userData.componentGroups.get('root');
    const previousGroups = model.userData.componentGroups;
    const previousSpec = structuredClone(model.userData.parameterBaseSpec);
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.MeshStandardMaterial.prototype, 'dispose');
    let meshConstructionCount = 0;
    class FailingMesh extends THREE.Mesh {
      constructor(geometry, material) {
        meshConstructionCount += 1;
        if (meshConstructionCount === 2) throw new Error('injected Mesh construction failure');
        super(geometry, material);
      }
    }
    const failingThree = { ...THREE, Mesh: FailingMesh };
    const next = structuredClone(model.userData.objectSculptSpec);
    next.componentTree.push(
      { id: 'staged-valid', parent: 'root', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } },
      { id: 'staged-invalid', parent: 'root', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } },
    );
    try {
      expect(() => applyObjectSculptComponentChanges(failingThree, model, next)).toThrow('injected Mesh construction failure');
      expect(model.userData.componentGroups).toBe(previousGroups);
      expect(model.userData.componentGroups.get('root')).toBe(rootGroup);
      expect(rootGroup.parent).toBe(model);
      expect(rootGroup.children).toHaveLength(0);
      expect(model.userData.parameterBaseSpec).toEqual(previousSpec);
      expect(model.userData.objectSculptSpec.componentTree).toHaveLength(1);
      expect(meshConstructionCount).toBe(2);
      expect(geometryDispose).toHaveBeenCalledTimes(2);
      expect(materialDispose).toHaveBeenCalledTimes(2);
    } finally {
      geometryDispose.mockRestore();
      materialDispose.mockRestore();
    }
  });

  it('restores the previous component hierarchy when candidate attachment fails', () => {
    const model = createObjectSculptModel(THREE, {
      schemaVersion: '3.0',
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'left', parent: 'root', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } },
        { id: 'right', parent: 'root', primitive: 'sphere', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
    });
    const rootGroup = model.userData.componentGroups.get('root');
    const leftGroup = model.userData.componentGroups.get('left');
    const rightGroup = model.userData.componentGroups.get('right');
    const previousGroups = model.userData.componentGroups;
    const previousSpec = structuredClone(model.userData.parameterBaseSpec);
    const previousRenderSpec = structuredClone(model.userData.renderObjectSculptSpec);
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.MeshStandardMaterial.prototype, 'dispose');
    const addSpy = vi.spyOn(rootGroup, 'add').mockImplementationOnce(() => {
      throw new Error('injected component attachment failure');
    });
    const next = structuredClone(model.userData.objectSculptSpec);
    next.componentTree.find(node => node.id === 'left').dimensions.width = 2;
    next.componentTree.push({
      id: 'added',
      parent: 'root',
      primitive: 'box',
      dimensions: { width: 0.5, height: 0.5, depth: 0.5 },
    });
    try {
      expect(() => applyObjectSculptComponentChanges(THREE, model, next))
        .toThrow('injected component attachment failure');
      expect(model.userData.componentGroups).toBe(previousGroups);
      expect(model.userData.componentGroups.get('root')).toBe(rootGroup);
      expect(model.userData.componentGroups.get('left')).toBe(leftGroup);
      expect(model.userData.componentGroups.get('right')).toBe(rightGroup);
      expect(rootGroup.parent).toBe(model);
      expect(rootGroup.children).toEqual([leftGroup, rightGroup]);
      expect(leftGroup.parent).toBe(rootGroup);
      expect(rightGroup.parent).toBe(rootGroup);
      expect(model.userData.parameterBaseSpec).toEqual(previousSpec);
      expect(model.userData.renderObjectSculptSpec).toEqual(previousRenderSpec);
      expect(model.userData.objectSculptSpec.componentTree.map(node => node.id))
        .toEqual(['root', 'left', 'right']);
      expect(geometryDispose).toHaveBeenCalledTimes(2);
      expect(materialDispose).toHaveBeenCalledTimes(2);
      expect(addSpy).toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
      geometryDispose.mockRestore();
      materialDispose.mockRestore();
    }
  });

  it('builds an arbitrary indexed mesh without requiring a registered primitive', () => {
    const spec = {
      schemaVersion: '3.0',
      materials: { metal: { color: '#777777', roughness: 0.35, metalness: 0.7 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        {
          id: 'custom-shell', kind: 'mesh', parent: 'root', material: 'metal',
          geometry: {
            type: 'indexed-mesh',
            positions: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 0, 2, 0],
            indices: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
          },
        },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    const mesh = model.getObjectByName('custom-shell:mesh');
    expect(mesh.isMesh).toBe(true);
    expect(mesh.geometry.isBufferGeometry).toBe(true);
    expect(mesh.geometry.getAttribute('position').count).toBe(5);
    expect(mesh.geometry.getIndex().count).toBe(12);
    expect(mesh.geometry.getAttribute('normal').count).toBe(5);
    expect(mesh.geometry.boundingSphere).not.toBeNull();
  });

  it('rejects malformed indexed mesh topology before Three.js construction', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'custom-shell',
        geometry: { type: 'indexed-mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 3] },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('索引超出顶点范围');
  });

  it('rebuilds only changed component Groups and preserves unrelated references', () => {
    const spec={schemaVersion:'3.0',materials:{stone:{color:'#888888',roughness:0.8,metalness:0}},componentTree:[{id:'root',kind:'group'},{id:'body',parent:'root',primitive:'box',material:'stone',dimensions:{width:2,height:2,depth:2}},{id:'window',parent:'root',primitive:'box',material:'stone',dimensions:{width:0.5,height:0.6,depth:0.1}}]};
    const model=createObjectSculptModel(THREE,spec),body=model.userData.componentGroups.get('body'),window=model.userData.componentGroups.get('window');
    const windowMesh=window.getObjectByName('window:mesh'),next=structuredClone(model.userData.objectSculptSpec);
    next.componentTree.find(node=>node.id==='body').dimensions.width=3;
    applyObjectSculptComponentChanges(THREE,model,next);
    expect(model.userData.componentGroups.get('body')).not.toBe(body);expect(model.userData.componentGroups.get('window')).toBe(window);
    expect(model.userData.componentGroups.get('window').getObjectByName('window:mesh')).toBe(windowMesh);
    expect(model.userData.componentGroups.get('body').getObjectByName('body:mesh').geometry.parameters.width).toBe(3);
  });

  it('uses server ChangeSet affected IDs and material IDs to target component rebuilds', () => {
    const spec={schemaVersion:'3.0',materials:{stone:{color:'#888888',roughness:0.8,metalness:0}},componentTree:[{id:'root',kind:'group'},{id:'body',parent:'root',primitive:'box',material:'stone',dimensions:{width:2,height:2,depth:2}},{id:'window',parent:'root',primitive:'box',material:'stone',dimensions:{width:0.5,height:0.6,depth:0.1}}]};
    const model=createObjectSculptModel(THREE,spec),body=model.userData.componentGroups.get('body'),window=model.userData.componentGroups.get('window');
    const next=structuredClone(model.userData.objectSculptSpec);
    next.componentTree.find(node=>node.id==='body').dimensions.width=3;
    const changeSetResult={objectModelSpec:next,changes:[{type:'replace-component',nodeId:'body',component:next.componentTree.find(node=>node.id==='body')}],affectedNodeIds:['body'],affectedMaterialIds:[]};
    applyObjectSculptComponentChanges(THREE,model,next,changeSetResult);
    expect(model.userData.componentGroups.get('body')).not.toBe(body);
    expect(model.userData.componentGroups.get('window')).toBe(window);
  });
  it('adds and removes components without replacing surviving component Groups', () => {
    const spec={schemaVersion:'3.0',componentTree:[{id:'root',kind:'group'},{id:'left',parent:'root',primitive:'box',dimensions:{width:1,height:1,depth:1}},{id:'right',parent:'root',primitive:'box',dimensions:{width:1,height:1,depth:1}}]};
    const model=createObjectSculptModel(THREE,spec),left=model.userData.componentGroups.get('left'),right=model.userData.componentGroups.get('right');
    const next=structuredClone(model.userData.objectSculptSpec);next.componentTree=next.componentTree.filter(node=>node.id!=='left');
    next.componentTree.push({id:'new-part',parent:'root',primitive:'sphere',dimensions:{width:1,height:1,depth:1}});
    applyObjectSculptComponentChanges(THREE,model,next);
    expect(model.userData.componentGroups.has('left')).toBe(false);expect(model.userData.componentGroups.has('new-part')).toBe(true);
    expect(model.userData.componentGroups.get('right')).toBe(right);expect(model.userData.componentGroups.get('left')).not.toBe(left);
    expect(model.userData.componentGroups.get('new-part').parent).toBe(model.userData.componentGroups.get('root'));
  });

  it('preserves migrated descendant resources and disposes only removed component resources', () => {
    const spec={schemaVersion:'3.0',componentTree:[
      {id:'root',kind:'group'},
      {id:'assembly',kind:'group',parent:'root'},
      {id:'shell',parent:'assembly',primitive:'box',dimensions:{width:2,height:2,depth:2}},
      {id:'detail',parent:'shell',primitive:'sphere',dimensions:{width:0.5,height:0.5,depth:0.5}},
      {id:'discarded',parent:'assembly',primitive:'box',dimensions:{width:0.25,height:0.25,depth:0.25}},
    ]};
    const model=createObjectSculptModel(THREE,spec);
    const assembly=model.userData.componentGroups.get('assembly');
    const shell=model.userData.componentGroups.get('shell');
    const detail=model.userData.componentGroups.get('detail');
    const discarded=model.userData.componentGroups.get('discarded');
    const shellMesh=shell.getObjectByName('shell:mesh');
    const detailMesh=detail.getObjectByName('detail:mesh');
    const discardedMesh=discarded.getObjectByName('discarded:mesh');
    const disposeCount={shellGeometry:0,shellMaterial:0,detailGeometry:0,detailMaterial:0,discardedGeometry:0,discardedMaterial:0};
    shellMesh.geometry.addEventListener('dispose',()=>disposeCount.shellGeometry++);
    shellMesh.material.addEventListener('dispose',()=>disposeCount.shellMaterial++);
    detailMesh.geometry.addEventListener('dispose',()=>disposeCount.detailGeometry++);
    detailMesh.material.addEventListener('dispose',()=>disposeCount.detailMaterial++);
    discardedMesh.geometry.addEventListener('dispose',()=>disposeCount.discardedGeometry++);
    discardedMesh.material.addEventListener('dispose',()=>disposeCount.discardedMaterial++);
    const next=structuredClone(model.userData.objectSculptSpec);
    next.componentTree=next.componentTree.filter(node=>node.id!=='assembly'&&node.id!=='discarded');
    next.componentTree.find(node=>node.id==='shell').parent='root';
    const changeSetResult={
      objectModelSpec:next,
      changes:[
        {type:'replace-component',nodeId:'shell',component:next.componentTree.find(node=>node.id==='shell')},
        {type:'remove-component',nodeId:'assembly',cascade:true},
      ],
      affectedNodeIds:['shell','assembly','discarded'],
      affectedMaterialIds:[],
    };
    applyObjectSculptComponentChanges(THREE,model,next,changeSetResult);
    expect(model.userData.componentGroups.has('assembly')).toBe(false);
    expect(model.userData.componentGroups.has('discarded')).toBe(false);
    expect(model.userData.componentGroups.get('shell')).toBe(shell);
    expect(model.userData.componentGroups.get('detail')).toBe(detail);
    expect(shell.parent).toBe(model.userData.componentGroups.get('root'));
    expect(detail.parent).toBe(shell);
    expect(assembly.parent).toBe(null);
    expect(disposeCount).toEqual({shellGeometry:0,shellMaterial:0,detailGeometry:0,detailMaterial:0,discardedGeometry:1,discardedMaterial:1});
  });
  it('attaches nested additions in parent-first order from a server ChangeSet', () => {
    const spec={schemaVersion:'3.0',componentTree:[{id:'root',kind:'group'}]};
    const model=createObjectSculptModel(THREE,spec);
    const next=structuredClone(model.userData.objectSculptSpec);
    const branch={id:'branch',kind:'group',parent:'root'};
    const leaf={id:'leaf',parent:'branch',primitive:'box',dimensions:{width:1,height:2,depth:1}};
    next.componentTree.push(branch,leaf);
    const changeSetResult={objectModelSpec:next,changes:[
      {type:'add-component',component:branch},
      {type:'add-component',component:leaf},
    ],affectedNodeIds:['branch','leaf'],affectedMaterialIds:[]};
    applyObjectSculptComponentChanges(THREE,model,next,changeSetResult);
    expect(model.userData.componentGroups.get('branch').parent).toBe(model.userData.componentGroups.get('root'));
    expect(model.userData.componentGroups.get('leaf').parent).toBe(model.userData.componentGroups.get('branch'));
  });
  it('reparents an unchanged component without replacing its Group', () => {
    const spec={schemaVersion:'3.0',componentTree:[{id:'root',kind:'group'},{id:'a',kind:'group',parent:'root'},{id:'b',kind:'group',parent:'root'},{id:'leaf',parent:'a',primitive:'box',dimensions:{width:1,height:1,depth:1}}]};
    const model=createObjectSculptModel(THREE,spec),leaf=model.userData.componentGroups.get('leaf'),next=structuredClone(model.userData.objectSculptSpec);
    next.componentTree.find(node=>node.id==='leaf').parent='b';applyObjectSculptComponentChanges(THREE,model,next);
    expect(model.userData.componentGroups.get('leaf')).toBe(leaf);expect(leaf.parent).toBe(model.userData.componentGroups.get('b'));
  });

  it('classifies parent-only server changes against the uncompiled baseline spec', () => {
    const spec={schemaVersion:'3.0',componentTree:[{id:'root',kind:'group'},{id:'left',kind:'group',parent:'root'},{id:'right',kind:'group',parent:'root'},{id:'leaf',parent:'left',primitive:'box',dimensions:{width:1,height:1,depth:1}}],parameterSchema:[{id:'leaf-width',label:'宽度',type:'number',value:1,min:1,max:2,step:0.1,targets:[{nodeId:'leaf',property:'dimensions.width'}]}]};
    const model=createObjectSculptModel(THREE,spec),leaf=model.userData.componentGroups.get('leaf');
    const next=structuredClone(model.userData.objectSculptSpec);
    const moved=next.componentTree.find(node=>node.id==='leaf');moved.parent='right';
    const changeSetResult={objectModelSpec:next,changes:[{type:'replace-component',nodeId:'leaf',component:moved}],affectedNodeIds:['leaf'],affectedMaterialIds:[]};
    applyObjectSculptComponentChanges(THREE,model,next,changeSetResult);
    expect(model.userData.componentGroups.get('leaf')).toBe(leaf);
    expect(leaf.parent).toBe(model.userData.componentGroups.get('right'));
  });
  it('retains a component Group when a server ChangeSet only reparents it', () => {
    const spec={schemaVersion:'3.0',componentTree:[{id:'root',kind:'group'},{id:'left',kind:'group',parent:'root'},{id:'right',kind:'group',parent:'root'},{id:'leaf',parent:'left',primitive:'box',dimensions:{width:1,height:1,depth:1}}]};
    const model=createObjectSculptModel(THREE,spec),leaf=model.userData.componentGroups.get('leaf');
    const next=structuredClone(model.userData.objectSculptSpec);
    const moved=next.componentTree.find(node=>node.id==='leaf');moved.parent='right';
    const changeSetResult={objectModelSpec:next,changes:[{type:'replace-component',nodeId:'leaf',component:moved}],affectedNodeIds:['leaf'],affectedMaterialIds:[]};
    applyObjectSculptComponentChanges(THREE,model,next,changeSetResult);
    expect(model.userData.componentGroups.get('leaf')).toBe(leaf);
    expect(leaf.parent).toBe(model.userData.componentGroups.get('right'));
  });
  it('updates parameter targets without replacing unrelated component Groups', () => {
    const spec={schemaVersion:'3.0',componentTree:[{id:'root',kind:'group'},{id:'body',parent:'root',primitive:'box',dimensions:{width:2,height:2,depth:2}},{id:'window',parent:'root',primitive:'box',dimensions:{width:0.5,height:0.5,depth:0.1}}],parameterSchema:[{id:'body-width',label:'主体宽度',type:'number',value:2,min:1,max:4,step:1,targets:[{nodeId:'body',property:'dimensions.width'}]}]};
    const model=createObjectSculptModel(THREE,spec),body=model.userData.componentGroups.get('body'),window=model.userData.componentGroups.get('window');
    applyObjectSculptParameter(THREE,model,'body-width',3);
    expect(model.userData.componentGroups.get('body')).not.toBe(body);expect(model.userData.componentGroups.get('window')).toBe(window);
    expect(model.userData.componentGroups.get('body').getObjectByName('body:mesh').geometry.parameters.width).toBe(3);
  });
  it('rebuilds linked parameter targets while retaining unrelated component Groups', () => {
    const spec={schemaVersion:'3.0',componentTree:[{id:'root',kind:'group'},{id:'body',parent:'root',primitive:'box',dimensions:{width:2,height:2,depth:2}},{id:'window-a',parent:'body',primitive:'box',dimensions:{width:0.5,height:1,depth:0.1}},{id:'window-b',parent:'body',primitive:'box',dimensions:{width:0.5,height:1,depth:0.1}},{id:'door',parent:'body',primitive:'box',dimensions:{width:0.8,height:1.8,depth:0.1}}],parameterSchema:[{id:'window-height',type:'number',value:1,min:0.5,max:2,step:0.1,targets:[{nodeId:'window-a',property:'dimensions.height'},{nodeId:'window-b',property:'dimensions.height'}]}]};
    const model=createObjectSculptModel(THREE,spec);
    const before=new Map(['body','window-a','window-b','door'].map(id=>[id,model.userData.componentGroups.get(id)]));
    const resources=['window-a','window-b'].map(id=>{const mesh=before.get(id).getObjectByName(id+':mesh');return {geometry:mesh.geometry,material:mesh.material,geometryDisposals:0,materialDisposals:0};});
    resources.forEach(resource=>{resource.geometry.addEventListener('dispose',()=>resource.geometryDisposals++);resource.material.addEventListener('dispose',()=>resource.materialDisposals++);});
    applyObjectSculptParameter(THREE,model,'window-height',1.6);
    for(const id of ['window-a','window-b']){const group=model.userData.componentGroups.get(id);expect(group).not.toBe(before.get(id));expect(group.getObjectByName(id+':mesh').geometry.parameters.height).toBe(1.6);}
    expect(model.userData.componentGroups.get('body')).toBe(before.get('body'));
    expect(model.userData.componentGroups.get('door')).toBe(before.get('door'));
    expect(resources.map(({geometryDisposals,materialDisposals})=>[geometryDisposals,materialDisposals])).toEqual([[1,1],[1,1]]);
  });

  it('updates selected indexed-mesh vertices in place and preserves unrelated Three.js objects', () => {
    const spec = {
      schemaVersion: '3.0',
      materials: { stone: { color: '#888888', roughness: 0.8, metalness: 0 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        {
          id: 'body', parent: 'root', material: 'stone',
          geometry: {
            type: 'indexed-mesh',
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            indices: [0, 1, 2],
          },
        },
        { id: 'window', parent: 'root', primitive: 'box', material: 'stone',
          dimensions: { width: 0.5, height: 0.6, depth: 0.1 } },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    const bodyGroup = model.userData.componentGroups.get('body');
    const bodyMesh = bodyGroup.getObjectByName('body:mesh');
    const bodyGeometry = bodyMesh.geometry;
    const bodyPosition = bodyGeometry.getAttribute('position');
    const bodyPositionVersion = bodyPosition.version;
    const windowGroup = model.userData.componentGroups.get('window');
    const windowMesh = windowGroup.getObjectByName('window:mesh');
    const resultSpec = structuredClone(model.userData.objectSculptSpec);
    resultSpec.componentTree.find(node => node.id === 'body').geometry.positions[7] = 1.5;

    applyObjectSculptMeshVertexUpdates(THREE, model, {
      objectModelSpec: resultSpec,
      geometryVertexUpdates: [{
        nodeId: 'body',
        updates: [{ index: 2, position: [0, 1.5, 0] }],
      }],
    });

    expect(model.userData.componentGroups.get('body')).toBe(bodyGroup);
    expect(bodyGroup.getObjectByName('body:mesh')).toBe(bodyMesh);
    expect(bodyMesh.geometry).toBe(bodyGeometry);
    expect(bodyMesh.geometry.getAttribute('position')).toBe(bodyPosition);
    expect(bodyPosition.getY(2)).toBe(1.5);
    expect(bodyPosition.version).toBeGreaterThan(bodyPositionVersion);
    expect(bodyGeometry.getAttribute('normal').count).toBe(3);
    expect(bodyGeometry.boundingSphere).not.toBeNull();
    expect(model.userData.componentGroups.get('window')).toBe(windowGroup);
    expect(windowGroup.getObjectByName('window:mesh')).toBe(windowMesh);
    expect(model.userData.objectSculptSpec.componentTree.find(node => node.id === 'body').geometry.positions[7]).toBe(1.5);
  });

  it('rejects vertex updates when the live component topology no longer matches the ChangeSet result', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'body',
        geometry: {
          type: 'indexed-mesh',
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
        },
      }],
    };
    const model = createObjectSculptModel(THREE, spec);
    model.userData.componentGroups.get('body').getObjectByName('body:mesh').geometry.setIndex([0, 2, 1]);
    const resultSpec = structuredClone(model.userData.objectSculptSpec);
    resultSpec.componentTree[0].geometry.positions[7] = 1.5;
    expect(() => applyObjectSculptMeshVertexUpdates(THREE, model, {
      objectModelSpec: resultSpec,
      geometryVertexUpdates: [{ nodeId: 'body', updates: [{ index: 2, position: [0, 1.5, 0] }] }],
    })).toThrow('拓扑已变化');
  });

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

  it('rebuilds only users of an updated material and disposes replaced resources once', () => {
    const spec = {
      schemaVersion: '3.0',
      materials: {
        shared: { color: '#888888', roughness: 0.8, metalness: 0 },
        independent: { color: '#00aa00', roughness: 0.5, metalness: 0 },
      },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'left', parent: 'root', primitive: 'box', material: 'shared', dimensions: { width: 1, height: 1, depth: 1 } },
        { id: 'right', parent: 'root', primitive: 'sphere', material: 'shared', dimensions: { width: 1, height: 1, depth: 1 } },
        { id: 'independent', parent: 'root', primitive: 'box', material: 'independent', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    const leftGroup = model.userData.componentGroups.get('left');
    const rightGroup = model.userData.componentGroups.get('right');
    const independentGroup = model.userData.componentGroups.get('independent');
    const leftMesh = leftGroup.getObjectByName('left:mesh');
    const rightMesh = rightGroup.getObjectByName('right:mesh');
    const independentMesh = independentGroup.getObjectByName('independent:mesh');
    const disposeCount = { leftGeometry: 0, leftMaterial: 0, rightGeometry: 0, rightMaterial: 0 };
    leftMesh.geometry.addEventListener('dispose', () => disposeCount.leftGeometry++);
    leftMesh.material.addEventListener('dispose', () => disposeCount.leftMaterial++);
    rightMesh.geometry.addEventListener('dispose', () => disposeCount.rightGeometry++);
    rightMesh.material.addEventListener('dispose', () => disposeCount.rightMaterial++);
    const next = structuredClone(model.userData.objectSculptSpec);
    next.materials.shared.color = '#ff0000';
    const changeSetResult = {
      objectModelSpec: next,
      changes: [{ type: 'update-material', materialId: 'shared' }],
      affectedNodeIds: [],
      affectedMaterialIds: ['shared'],
    };

    applyObjectSculptComponentChanges(THREE, model, next, changeSetResult);

    const nextLeft = model.userData.componentGroups.get('left');
    const nextRight = model.userData.componentGroups.get('right');
    expect(nextLeft).not.toBe(leftGroup);
    expect(nextRight).not.toBe(rightGroup);
    expect(model.userData.componentGroups.get('independent')).toBe(independentGroup);
    expect(nextLeft.getObjectByName('left:mesh').material.color.getHexString()).toBe('ff0000');
    expect(nextRight.getObjectByName('right:mesh').material.color.getHexString()).toBe('ff0000');
    expect(independentGroup.getObjectByName('independent:mesh')).toBe(independentMesh);
    expect(disposeCount).toEqual({ leftGeometry: 1, leftMaterial: 1, rightGeometry: 1, rightMaterial: 1 });
  });

  it('releases a removed material only after all of its component users are reassigned', () => {
    const spec = {
      schemaVersion: '3.0',
      materials: {
        shared: { color: '#888888', roughness: 0.8, metalness: 0 },
        replacement: { color: '#2222ff', roughness: 0.6, metalness: 0 },
      },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'left', parent: 'root', primitive: 'box', material: 'shared', dimensions: { width: 1, height: 1, depth: 1 } },
        { id: 'right', parent: 'root', primitive: 'sphere', material: 'shared', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
    };
    const model = createObjectSculptModel(THREE, spec);
    const oldMeshes = ['left', 'right'].map(id => model.userData.componentGroups.get(id).getObjectByName(id + ':mesh'));
    const disposeCount = { geometry: [0, 0], material: [0, 0] };
    oldMeshes.forEach((mesh, index) => {
      mesh.geometry.addEventListener('dispose', () => disposeCount.geometry[index]++);
      mesh.material.addEventListener('dispose', () => disposeCount.material[index]++);
    });
    const next = structuredClone(model.userData.objectSculptSpec);
    next.componentTree.forEach(node => {
      if (node.id === 'left' || node.id === 'right') node.material = 'replacement';
    });
    delete next.materials.shared;
    const changeSetResult = {
      objectModelSpec: next,
      changes: [
        { type: 'replace-component', nodeId: 'left', component: next.componentTree.find(node => node.id === 'left') },
        { type: 'replace-component', nodeId: 'right', component: next.componentTree.find(node => node.id === 'right') },
        { type: 'remove-material', materialId: 'shared' },
      ],
      affectedNodeIds: ['left', 'right'],
      affectedMaterialIds: ['shared', 'replacement'],
    };

    applyObjectSculptComponentChanges(THREE, model, next, changeSetResult);

    expect(model.userData.objectSculptSpec.materials).not.toHaveProperty('shared');
    for (const id of ['left', 'right']) {
      expect(model.userData.componentGroups.get(id).getObjectByName(id + ':mesh').material.color.getHexString()).toBe('2222ff');
    }
    expect(disposeCount).toEqual({ geometry: [1, 1], material: [1, 1] });
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


  it('rejects self-intersecting and zero-area polygon outlines before execution', () => {
    const base = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'outline', primitive: 'polygon', dimensions: { width: 4, height: 3, depth: 0.6 },
        geometryDescriptor: { points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] },
      }],
    };
    const selfIntersecting = structuredClone(base);
    selfIntersecting.componentTree[0].geometryDescriptor.points = [
      [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5],
    ];
    expect(() => createObjectSculptModel(THREE, selfIntersecting)).toThrow(/自相交/);

    const zeroArea = structuredClone(base);
    zeroArea.componentTree[0].geometryDescriptor.points = [
      [-0.5, 0], [0, 0], [0.5, 0],
    ];
    expect(() => createObjectSculptModel(THREE, zeroArea)).toThrow(/面积不能为零/);
  });

  it('rejects arch insets outside the trusted runtime bounds', () => {
    const spec = {
      schemaVersion: '3.0',
      componentTree: [{
        id: 'arch', primitive: 'arch', dimensions: { width: 3, height: 4, depth: 0.5 },
        geometryDescriptor: { inset: 1.3 },
      }],
    };
    expect(() => createObjectSculptModel(THREE, spec)).toThrow('arch.inset 超出允许范围');
  });

  it('estimates built-in primitive buffers against actual Three.js geometry', () => {
    const cases = ['box', 'cuboid', 'cylinder', 'cone', 'sphere', 'ellipsoid', 'torus'];
    for (const primitive of cases) {
      for (const segments of [3, 12, 48]) {
        const node = {
          id: 'estimate-' + primitive + '-' + segments,
          primitive,
          dimensions: { width: 2, height: 3, depth: 4 },
          geometryDescriptor: { segments },
        };
        const estimate = estimateObjectSculptPrimitiveGeometry(primitive, node.geometryDescriptor);
        const component = createObjectSculptComponentGroup(THREE, node);
        const geometry = component.getObjectByName(node.id + ':mesh').geometry;
        const actualAttributeBytes = Object.values(geometry.attributes)
          .reduce((total, attribute) => total + attribute.array.byteLength, 0);
        const actualIndex = geometry.getIndex();

        expect(estimate.vertexCount).toBe(geometry.getAttribute('position').count);
        expect(estimate.indexCount).toBe(actualIndex.count);
        expect(estimate.attributeBytes).toBe(actualAttributeBytes);
        expect(estimate.indexBytes).toBe(actualIndex.array.byteLength);
        expect(estimate.indexBytesPerElement).toBe(actualIndex.array.BYTES_PER_ELEMENT);
        expect(estimate.bufferBytes).toBe(actualAttributeBytes + actualIndex.array.byteLength);
        component.traverse(object => {
          object.geometry?.dispose?.();
          object.material?.dispose?.();
        });
      }
    }
  });

  it('estimates polygon extrusion buffers against actual Three.js geometry', () => {
    const pointSets = [
      [[-0.4, -0.4], [0.4, -0.4], [0, 0.4]],
      [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]],
      [[-0.4, -0.3], [0, -0.45], [0.4, -0.3], [0.3, 0.1], [0, 0.4], [-0.3, 0.1]],
      [[-0.45, -0.35], [-0.15, -0.45], [0.1, -0.35], [0.4, -0.4],
        [0.45, 0], [0.25, 0.35], [0, 0.45], [-0.3, 0.3], [-0.45, 0]],
    ];
    for (const [index, points] of pointSets.entries()) {
      const descriptor = { points };
      const estimate = estimateObjectSculptPrimitiveGeometry('polygon', descriptor);
      const node = {
        id: 'estimated-polygon-' + index,
        primitive: 'polygon',
        dimensions: { width: 2, height: 3, depth: 1.5 },
        geometryDescriptor: descriptor,
      };
      const component = createObjectSculptComponentGroup(THREE, node);
      const geometry = component.getObjectByName(node.id + ':mesh').geometry;
      const actualAttributeBytes = Object.values(geometry.attributes)
        .reduce((total, attribute) => total + attribute.array.byteLength, 0);
      expect(geometry.getIndex()).toBeNull();
      expect(estimate.vertexCount).toBe(geometry.getAttribute('position').count);
      expect(estimate.indexCount).toBe(0);
      expect(estimate.attributeComponents).toBe(8);
      expect(estimate.attributeBytes).toBe(actualAttributeBytes);
      expect(estimate.indexBytes).toBe(0);
      expect(estimate.indexBytesPerElement).toBe(0);
      expect(estimate.bufferBytes).toBe(actualAttributeBytes);
      component.traverse(object => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    }
  });

  it('estimates indexed-mesh buffers from actual positions and maximum index', () => {
    const positions = [
      0, 0, 0, 1, 0, 0, 0, 1, 0, 9, 9, 9,
    ];
    const indices = [0, 1, 2];
    const estimate = estimateObjectSculptPrimitiveGeometry('indexed-mesh', { positions, indices });
    const component = createObjectSculptComponentGroup(THREE, {
      id: 'estimated-indexed-mesh',
      geometry: { type: 'indexed-mesh', positions, indices },
    });
    const geometry = component.getObjectByName('estimated-indexed-mesh:mesh').geometry;
    const actualAttributeBytes = Object.values(geometry.attributes)
      .reduce((total, attribute) => total + attribute.array.byteLength, 0);
    const actualIndex = geometry.getIndex();
    expect(estimate.vertexCount).toBe(geometry.getAttribute('position').count);
    expect(estimate.indexCount).toBe(actualIndex.count);
    expect(estimate.attributeComponents).toBe(6);
    expect(estimate.attributeBytes).toBe(actualAttributeBytes);
    expect(estimate.indexBytes).toBe(actualIndex.array.byteLength);
    expect(estimate.indexBytesPerElement).toBe(actualIndex.array.BYTES_PER_ELEMENT);
    expect(estimate.bufferBytes).toBe(actualAttributeBytes + actualIndex.array.byteLength);
    component.traverse(object => object.geometry?.dispose?.() || object.material?.dispose?.());
  });

  it('estimates loft buffers against actual generated geometry for multiple section/profile sizes', () => {
    for (const sectionCount of [2, 3, 5]) {
      for (const ringSize of [3, 4, 7]) {
        const sections = Array.from({ length: sectionCount }, (_, sectionIndex) => ({
          height: -0.5 + sectionIndex / (sectionCount - 1),
          points: Array.from({ length: ringSize }, (_, pointIndex) => {
            const angle = (Math.PI * 2 * pointIndex) / ringSize;
            return [Math.cos(angle) * 0.4, Math.sin(angle) * 0.4];
          }),
        }));
        const descriptor = { sections };
        const estimate = estimateObjectSculptPrimitiveGeometry('loft', descriptor);
        const component = createObjectSculptComponentGroup(THREE, {
          id: 'estimated-loft-' + sectionCount + '-' + ringSize,
          primitive: 'loft',
          dimensions: { width: 2, height: 3, depth: 2 },
          geometryDescriptor: descriptor,
        });
        const geometry = component.getObjectByName('estimated-loft-' + sectionCount + '-' + ringSize + ':mesh').geometry;
        const actualAttributeBytes = Object.values(geometry.attributes)
          .reduce((total, attribute) => total + attribute.array.byteLength, 0);
        const actualIndex = geometry.getIndex();
        expect(estimate.vertexCount).toBe(geometry.getAttribute('position').count);
        expect(estimate.indexCount).toBe(actualIndex.count);
        expect(estimate.attributeComponents).toBe(6);
        expect(estimate.attributeBytes).toBe(actualAttributeBytes);
        expect(estimate.indexBytes).toBe(actualIndex.array.byteLength);
        expect(estimate.indexBytesPerElement).toBe(actualIndex.array.BYTES_PER_ELEMENT);
        expect(estimate.bufferBytes).toBe(actualAttributeBytes + actualIndex.array.byteLength);
        component.traverse(object => object.geometry?.dispose?.() || object.material?.dispose?.());
      }
    }
  });

  it('estimates tube buffers against actual TubeGeometry for multiple segment configurations', () => {
    for (const tubularSegments of [3, 12, 48]) {
      for (const radialSegments of [3, 8, 16]) {
        const descriptor = {
          path: [[-0.4, 0, 0], [0, 0.25, 0.1], [0.4, 0, 0]],
          tubularSegments,
          radialSegments,
        };
        const estimate = estimateObjectSculptPrimitiveGeometry('tube', descriptor);
        const node = {
          id: 'estimated-tube-' + tubularSegments + '-' + radialSegments,
          primitive: 'tube',
          dimensions: { width: 2, height: 3, depth: 2 },
          geometryDescriptor: descriptor,
        };
        const component = createObjectSculptComponentGroup(THREE, node);
        const geometry = component.getObjectByName(node.id + ':mesh').geometry;
        const actualAttributeBytes = Object.values(geometry.attributes)
          .reduce((total, attribute) => total + attribute.array.byteLength, 0);
        const actualIndex = geometry.getIndex();
        expect(estimate.vertexCount).toBe(geometry.getAttribute('position').count);
        expect(estimate.indexCount).toBe(actualIndex.count);
        expect(estimate.attributeBytes).toBe(actualAttributeBytes);
        expect(estimate.indexBytes).toBe(actualIndex.array.byteLength);
        expect(estimate.indexBytesPerElement).toBe(actualIndex.array.BYTES_PER_ELEMENT);
        expect(estimate.bufferBytes).toBe(actualAttributeBytes + actualIndex.array.byteLength);
        component.traverse(object => {
          object.geometry?.dispose?.();
          object.material?.dispose?.();
        });
      }
    }
  });

  it('estimates sweep buffers against actual generated geometry for multiple path/profile sizes', () => {
    for (const steps of [3, 12, 32]) {
      for (const profileCount of [3, 4, 6]) {
        const profile = Array.from({ length: profileCount }, (_, index) => {
          const angle = Math.PI * 2 * index / profileCount;
          return [Math.cos(angle) * 0.3, Math.sin(angle) * 0.3];
        });
        const descriptor = {
          path: [[-0.4, 0, 0], [0, 0.15, 0.1], [0.4, 0, 0]],
          profile,
          steps,
        };
        const estimate = estimateObjectSculptPrimitiveGeometry('sweep', descriptor);
        const node = {
          id: 'estimated-sweep-' + steps + '-' + profileCount,
          primitive: 'sweep',
          dimensions: { width: 2, height: 2, depth: 2 },
          geometryDescriptor: descriptor,
        };
        const component = createObjectSculptComponentGroup(THREE, node);
        const geometry = component.getObjectByName(node.id + ':mesh').geometry;
        const actualAttributeBytes = Object.values(geometry.attributes)
          .reduce((total, attribute) => total + attribute.array.byteLength, 0);
        const actualIndex = geometry.getIndex();
        expect(estimate.vertexCount).toBe(geometry.getAttribute('position').count);
        expect(estimate.indexCount).toBe(actualIndex.count);
        expect(estimate.attributeComponents).toBe(6);
        expect(estimate.attributeBytes).toBe(actualAttributeBytes);
        expect(estimate.indexBytes).toBe(actualIndex.array.byteLength);
        expect(estimate.indexBytesPerElement).toBe(actualIndex.array.BYTES_PER_ELEMENT);
        expect(estimate.bufferBytes).toBe(actualAttributeBytes + actualIndex.array.byteLength);
        component.traverse(object => {
          object.geometry?.dispose?.();
          object.material?.dispose?.();
        });
      }
    }
  });

  it('estimates lathe buffers against actual LatheGeometry for multiple profile/segment sizes', () => {
    const profile = [[0.12, -0.5], [0.38, -0.3], [0.32, 0.25], [0.1, 0.5]];
    for (const segments of [3, 12, 32]) {
      const descriptor = { profile, segments };
      const estimate = estimateObjectSculptPrimitiveGeometry('lathe', descriptor);
      const node = {
        id: 'estimated-lathe-' + segments,
        primitive: 'lathe',
        dimensions: { width: 2, height: 3, depth: 2 },
        geometryDescriptor: descriptor,
      };
      const component = createObjectSculptComponentGroup(THREE, node);
      const geometry = component.getObjectByName(node.id + ':mesh').geometry;
      const actualAttributeBytes = Object.values(geometry.attributes)
        .reduce((total, attribute) => total + attribute.array.byteLength, 0);
      const actualIndex = geometry.getIndex();
      expect(estimate.vertexCount).toBe(geometry.getAttribute('position').count);
      expect(estimate.indexCount).toBe(actualIndex.count);
      expect(estimate.attributeBytes).toBe(actualAttributeBytes);
      expect(estimate.indexBytes).toBe(actualIndex.array.byteLength);
      expect(estimate.indexBytesPerElement).toBe(actualIndex.array.BYTES_PER_ELEMENT);
      expect(estimate.bufferBytes).toBe(actualAttributeBytes + actualIndex.array.byteLength);
      component.traverse(object => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    }
  });

  it('does not claim an estimate for extruded box geometry or uncalibrated primitives', () => {
    expect(() => estimateObjectSculptPrimitiveGeometry('box', { openings: [{}] }))
      .toThrow('当前估算器不支持');
    expect(() => estimateObjectSculptPrimitiveGeometry('polygon', {}))
      .toThrow('没有经过校准');
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
    const sphere = model.getObjectByName('sphere:mesh').geometry;
    const ellipsoid = model.getObjectByName('ellipsoid:mesh').geometry;
    const torus = model.getObjectByName('torus:mesh').geometry;
    expect(cylinder.type).toBe('CylinderGeometry');
    expect(cylinder.parameters).toMatchObject({ radiusTop: 1, radiusBottom: 0.5, height: 4, radialSegments: 12 });
    expect(cone.type).toBe('ConeGeometry');
    expect(cone.parameters).toMatchObject({ radius: 1.5, height: 5, radialSegments: 10 });
    expect(sphere.type).toBe('SphereGeometry');
    sphere.computeBoundingBox();
    const sphereSize = sphere.boundingBox.getSize(new THREE.Vector3());
    expect(sphereSize.x).toBeGreaterThan(1.9);
    expect(sphereSize.x).toBeLessThanOrEqual(2);
    expect(sphereSize.y).toBeGreaterThan(2.85);
    expect(sphereSize.y).toBeLessThanOrEqual(3);
    expect(sphereSize.z).toBeGreaterThan(3.8);
    expect(sphereSize.z).toBeLessThanOrEqual(4);
    expect(ellipsoid.type).toBe('SphereGeometry');
    ellipsoid.computeBoundingBox();
    const ellipsoidSize = ellipsoid.boundingBox.getSize(new THREE.Vector3());
    expect(ellipsoidSize.x).toBeGreaterThan(3.8);
    expect(ellipsoidSize.x).toBeLessThanOrEqual(4);
    expect(ellipsoidSize.y).toBeGreaterThan(1.9);
    expect(ellipsoidSize.y).toBeLessThanOrEqual(2);
    expect(ellipsoidSize.z).toBeGreaterThan(2.85);
    expect(ellipsoidSize.z).toBeLessThanOrEqual(3);
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
    const initialInstances = new Map([...model.userData.componentGroups.entries()]
      .filter(([, group]) => group.userData.componentSourceId === 'rib'));
    applyObjectSculptParameter(THREE, model, 'rib-count', 7);
    expect(countInstances()).toBe(7);
    expect(sourceMappedMeshes()).toHaveLength(7);
    expect(sourceMappedMeshes().every(mesh => mesh.userData.componentSourceId === 'rib')).toBe(true);
    for (const [id, group] of initialInstances) {
      expect(model.userData.componentGroups.get(id)).toBe(group);
    }

    const expandedInstances = [...model.userData.componentGroups.entries()]
      .filter(([, group]) => group.userData.componentSourceId === 'rib');
    const expandedResources = expandedInstances.map(([id, group]) => {
      const mesh = group.getObjectByName(id + ':mesh');
      const resource = { geometry: mesh.geometry, material: mesh.material, geometryDisposals: 0, materialDisposals: 0 };
      resource.geometry.addEventListener('dispose', () => resource.geometryDisposals++);
      resource.material.addEventListener('dispose', () => resource.materialDisposals++);
      return { id, group, resource };
    });
    applyObjectSculptParameter(THREE, model, 'rib-count', 3);
    expect(countInstances()).toBe(3);
    expect(sourceMappedMeshes()).toHaveLength(3);
    for (const { id, group } of expandedResources.slice(0, 3)) {
      expect(model.userData.componentGroups.get(id)).toBe(group);
    }
    expect(expandedResources.slice(3).map(({ resource }) => [
      resource.geometryDisposals, resource.materialDisposals,
    ])).toEqual([[1, 1], [1, 1], [1, 1], [1, 1]]);
    expect(model.userData.objectSculptSpec.parameterSchema[0].value).toBe(3);
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
