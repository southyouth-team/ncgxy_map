import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  batchStaticModel,
  collectProtectedPartIds,
  explainBatching,
  resolveStaticBatchPartId,
  STATIC_BATCH_ROOT_NAME,
} from './staticModelBatcher.js'

function makeMesh(name, material, { position = null, castShadow = true, receiveShadow = true, geometry = null } = {}) {
  const mesh = new THREE.Mesh(geometry || new THREE.BoxGeometry(1, 1, 1), material)
  mesh.name = name
  if (position) mesh.position.set(...position)
  mesh.castShadow = castShadow
  mesh.receiveShadow = receiveShadow
  return mesh
}

function worldBox(root) {
  root.updateWorldMatrix(true, true)
  return new THREE.Box3().setFromObject(root)
}

describe('collectProtectedPartIds', () => {
  it('enumerates every part id referenced by runtime manifests and bindings', () => {
    const root = new THREE.Group()
    root.userData.proceduralModelEnvironmentBindings = [
      { variable: 'lighting.artificial.enabled', targetPartId: 'env-lamp', property: 'visible' },
    ]
    root.userData.proceduralModelCapabilityControlDocument = {
      overrides: [{ scope: { targetType: 'part', partId: 'override-part' } }],
      inference: { proposals: [{ scope: { targetType: 'part', partId: 'proposal-part' } }] },
    }
    root.userData.proceduralModelCapabilityManifest = {
      parameters: [{ id: 'p1', bindings: [{ capabilityId: 'x', scope: { partId: 'parameter-part' } }] }],
      capabilities: {
        environmentBindings: [{ variable: 'wind', targetPartId: 'manifest-env', property: 'visible' }],
        visual: { animations: [{ id: 'motion-target', targetPartId: 'animated-part' }] },
        interior: { entryPoints: [{ id: 'in', targetPartId: 'interior-spawn' }] },
        spatial: {
          colliders: [{ id: 'c1', targetPartId: 'wall', shape: 'box' }],
          surfaces: [{ id: 's1', targetPartId: 'floor', shape: 'mesh' }],
          waterVolumes: [{ id: 'w1', targetPartId: 'basin', surfacePartId: 'water-surface', shape: 'box' }],
          traversability: {
            stairs: [{ id: 'st1', targetPartId: 'stairs-main' }],
            ramps: [{ id: 'r1', targetPartId: 'ramp-main' }],
            jumps: [{ id: 'j1', targetPartId: 'jump-pad' }],
            passages: [{ id: 'p1', targetPartId: 'gate' }],
            connections: [{ id: 'conn1', from: 'floor', to: 'stairs-main' }],
          },
        },
      },
    }

    const ids = collectProtectedPartIds(root)

    expect([...ids].sort()).toEqual([
      'animated-part', 'basin', 'env-lamp', 'floor', 'gate', 'interior-spawn', 'jump-pad',
      'manifest-env', 'override-part', 'parameter-part', 'proposal-part',
      'ramp-main', 'stairs-main', 'wall', 'water-surface',
    ])
  })

  it('returns an empty set for models without any runtime declarations', () => {
    const root = new THREE.Group()
    root.add(makeMesh('decor', new THREE.MeshStandardMaterial()))
    expect(collectProtectedPartIds(root).size).toBe(0)
    expect(collectProtectedPartIds(null).size).toBe(0)
  })
})

describe('explainBatching', () => {
  it('classifies skip reasons and merge compatibility without mutating the tree', () => {
    const root = new THREE.Group()
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { colliders: [{ id: 'c1', targetPartId: 'door', shape: 'box' }] } },
    }
    const material = new THREE.MeshStandardMaterial()
    const part = new THREE.Group()
    part.userData.componentId = 'door'
    part.add(makeMesh('door-mesh', material))
    root.add(part)
    // 装饰部件：带 componentId 但没有任何清单引用，应当可合批。
    const decor = new THREE.Group()
    decor.userData.componentId = 'decor-group'
    decor.add(makeMesh('decor-mesh', material))
    root.add(decor)
    const hidden = makeMesh('hidden', material)
    hidden.visible = false
    root.add(hidden)
    root.add(makeMesh('plain-a', material))
    const beforeCount = root.children.length

    const report = explainBatching(root)

    expect(root.children.length).toBe(beforeCount)
    expect(report.total).toBe(4)
    expect(report.skipReasons.protectedPart).toBe(1)
    expect(report.skipReasons.invisible).toBe(1)
    expect(report.batchableMeshCount).toBe(2)
    expect(report.materialGroups[0].willMerge).toBe(true)
  })

  it('splits material groups into compatible partitions by attribute signature', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const withUv = new THREE.BoxGeometry(1, 1, 1)
    const rawGeometry = new THREE.BufferGeometry()
    rawGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1,
    ], 3))
    const meshA = new THREE.Mesh(withUv, material)
    const meshB = new THREE.Mesh(rawGeometry, material)
    meshB.position.x = 2
    root.add(meshA, meshB)

    const report = explainBatching(root)

    expect(report.materialGroups).toHaveLength(2)
    for (const group of report.materialGroups) {
      expect(group.meshCount).toBe(1)
      expect(group.willMerge).toBe(false)
    }
  })
})

describe('batchStaticModel', () => {
  it('merges same-material meshes into one batch mesh while preserving world bounds', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial({ color: '#aa3333' })
    const inner = new THREE.Group()
    inner.position.set(5, 0, 0)
    inner.add(makeMesh('a', material, { position: [0, 0, 0] }))
    inner.add(makeMesh('b', material, { position: [0, 2, 0] }))
    root.add(inner)
    const before = worldBox(root)

    const result = batchStaticModel(root)

    expect(result.mergedMeshCount).toBe(1)
    expect(result.consumedMeshCount).toBe(2)
    const batchRoot = root.getObjectByName(STATIC_BATCH_ROOT_NAME)
    expect(batchRoot).toBeTruthy()
    expect(batchRoot.children).toHaveLength(1)
    expect(batchRoot.children[0].material).toBe(material)
    expect(inner.children).toHaveLength(0)
    const after = worldBox(root)
    for (const axis of ['x', 'y', 'z']) {
      expect(after.min[axis]).toBeCloseTo(before.min[axis], 6)
      expect(after.max[axis]).toBeCloseTo(before.max[axis], 6)
    }
  })

  it('groups meshes by material, producing one batch mesh per material', () => {
    const root = new THREE.Group()
    const red = new THREE.MeshStandardMaterial({ color: '#ff0000' })
    const blue = new THREE.MeshStandardMaterial({ color: '#0000ff' })
    root.add(makeMesh('r1', red))
    root.add(makeMesh('r2', red, { position: [2, 0, 0] }))
    root.add(makeMesh('b1', blue))
    root.add(makeMesh('b2', blue, { position: [0, 2, 0] }))

    const result = batchStaticModel(root)

    expect(result.mergedMeshCount).toBe(2)
    expect(result.consumedMeshCount).toBe(4)
    const batchRoot = root.getObjectByName(STATIC_BATCH_ROOT_NAME)
    const materials = batchRoot.children.map(child => child.material)
    expect(materials).toContain(red)
    expect(materials).toContain(blue)
  })

  it('merges indexed and non-indexed geometries sharing a material (Box + Extrude real-model case)', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    // BoxGeometry 有索引；ExtrudeGeometry 无索引，二者属性集相同（position/normal/uv）。
    const box = makeMesh('box', material)
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.lineTo(1, 0)
    shape.lineTo(1, 1)
    shape.lineTo(0, 1)
    shape.closePath()
    const extruded = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }), material)
    extruded.position.x = 3
    extruded.castShadow = true
    extruded.receiveShadow = true
    root.add(box, extruded)
    const before = worldBox(root)

    const result = batchStaticModel(root)

    expect(result.mergedMeshCount).toBe(1)
    expect(result.consumedMeshCount).toBe(2)
    const after = worldBox(root)
    for (const axis of ['x', 'y', 'z']) {
      expect(after.min[axis]).toBeCloseTo(before.min[axis], 5)
      expect(after.max[axis]).toBeCloseTo(before.max[axis], 5)
    }
  })

  it('keeps manifest-referenced component subtrees untouched while batching unreferenced decorative parts', () => {
    const root = new THREE.Group()
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { colliders: [{ id: 'c1', targetPartId: 'door-1', shape: 'box' }] } },
    }
    const material = new THREE.MeshStandardMaterial()
    const part = new THREE.Group()
    part.userData.componentId = 'door-1'
    const partMesh = makeMesh('door-leaf', material)
    part.add(partMesh)
    root.add(part)
    // 真实模型里每个节点都带 componentId；未被清单引用的装饰节点必须可合批。
    const decorGroup = new THREE.Group()
    decorGroup.userData.componentId = 'decor-group'
    decorGroup.add(makeMesh('decor-a', material))
    root.add(decorGroup)
    root.add(makeMesh('decor-b', material, { position: [3, 0, 0] }))

    const result = batchStaticModel(root)

    expect(part.parent).toBe(root)
    expect(partMesh.parent).toBe(part)
    expect(result.consumedMeshCount).toBe(2)
    const batchRoot = root.getObjectByName(STATIC_BATCH_ROOT_NAME)
    expect(batchRoot.children[0].userData.staticBatchSourceCount).toBe(2)
  })

  it('preserves a direct animated mesh while merging unrelated decorative meshes', () => {
    const root = new THREE.Group()
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: {
        visual: { animations: [{ id: 'motion-target', targetPartId: 'animated-part' }] },
      },
    }
    const material = new THREE.MeshStandardMaterial()
    const animated = makeMesh('animated-mesh', material)
    animated.userData.componentId = 'animated-part'
    root.add(
      animated,
      makeMesh('decor-a', material, { position: [2, 0, 0] }),
      makeMesh('decor-b', material, { position: [4, 0, 0] }),
    )

    const result = batchStaticModel(root)

    expect(animated.parent).toBe(root)
    expect(result.consumedMeshCount).toBe(2)
    expect(explainBatching(root).skipReasons.protectedPart).toBe(1)
  })

  it('preserves every descendant when the model root is an animation target', () => {
    const root = new THREE.Group()
    root.userData.componentId = 'animated-root'
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: {
        visual: { animations: [{ id: 'root-motion', targetPartId: 'animated-root' }] },
      },
    }
    const material = new THREE.MeshStandardMaterial()
    const first = makeMesh('animated-a', material)
    const second = makeMesh('animated-b', material, { position: [2, 0, 0] })
    root.add(first, second)

    const result = batchStaticModel(root)

    expect(first.parent).toBe(root)
    expect(second.parent).toBe(root)
    expect(result.consumedMeshCount).toBe(0)
    expect(result.mergedMeshCount).toBe(0)
  })

  it('batches meshes that only carry componentId when no runtime manifest references them (734-mesh regression)', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    // 模拟 createObjectSculptModel：Group 与 mesh 双挂 componentId，但模型没有任何能力清单。
    for (const id of ['node-a', 'node-b', 'node-c']) {
      const group = new THREE.Group()
      group.userData.componentId = id
      const mesh = makeMesh(id + '-mesh', material, { position: [Math.random(), 0, 0] })
      mesh.userData.componentId = id
      group.add(mesh)
      root.add(group)
    }

    const result = batchStaticModel(root)

    expect(result.consumedMeshCount).toBe(3)
    expect(result.mergedMeshCount).toBe(1)
    const batchMesh = root.getObjectByName(STATIC_BATCH_ROOT_NAME).children[0]
    expect(batchMesh.userData.staticBatchPartIds.sort()).toEqual(['node-a', 'node-b', 'node-c'])
  })

  it('protects meshes whose ancestor carries an interactionConfig action', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const button = new THREE.Group()
    button.userData.componentId = 'wall-switch-button'
    button.userData.interactionConfig = { action: 'toggle', stateKey: 'lampOn', radius: 1 }
    const buttonMesh = makeMesh('button-face', material)
    button.add(buttonMesh)
    root.add(button)
    root.add(makeMesh('plain-1', material))
    root.add(makeMesh('plain-2', material, { position: [1, 0, 0] }))

    batchStaticModel(root)

    expect(buttonMesh.parent).toBe(button)
  })

  it('protects meshes whose ancestor carries a stateBinding', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const lamp = new THREE.Group()
    lamp.userData.stateBinding = { key: 'lampOn', property: 'visible' }
    const bulb = makeMesh('bulb', material)
    lamp.add(bulb)
    root.add(lamp)
    root.add(makeMesh('plain-1', material))
    root.add(makeMesh('plain-2', material, { position: [1, 0, 0] }))

    batchStaticModel(root)

    expect(bulb.parent).toBe(lamp)
  })

  it('skips invisible meshes instead of forcing them visible inside a batch', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const hidden = makeMesh('hidden', material)
    hidden.visible = false
    root.add(hidden)
    root.add(makeMesh('visible-1', material))
    root.add(makeMesh('visible-2', material, { position: [1, 0, 0] }))

    batchStaticModel(root)

    expect(hidden.parent).toBe(root)
    expect(hidden.visible).toBe(false)
  })

  it('does not rewrite single-mesh material groups', () => {
    const root = new THREE.Group()
    const unique = new THREE.MeshStandardMaterial()
    const lone = makeMesh('lone', unique)
    root.add(lone)

    const result = batchStaticModel(root)

    expect(result.mergedMeshCount).toBe(0)
    expect(result.consumedMeshCount).toBe(0)
    expect(lone.parent).toBe(root)
    expect(root.getObjectByName(STATIC_BATCH_ROOT_NAME)).toBeFalsy()
  })

  it('preserves shadow flags on the batch mesh', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    root.add(makeMesh('a', material, { castShadow: true, receiveShadow: false }))
    root.add(makeMesh('b', material, { castShadow: true, receiveShadow: false }))

    batchStaticModel(root)

    const batchMesh = root.getObjectByName(STATIC_BATCH_ROOT_NAME).children[0]
    expect(batchMesh.castShadow).toBe(true)
    expect(batchMesh.receiveShadow).toBe(false)
  })

  it('returns a neutral result for empty or non-object roots without throwing', () => {
    expect(batchStaticModel(null)).toEqual({ mergedMeshCount: 0, consumedMeshCount: 0, skippedMeshCount: 0, materialGroups: [] })
    const empty = new THREE.Group()
    const result = batchStaticModel(empty)
    expect(result.mergedMeshCount).toBe(0)
    expect(empty.children).toHaveLength(0)
  })

  it('is idempotent: a second call changes nothing', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    root.add(makeMesh('a', material))
    root.add(makeMesh('b', material, { position: [1, 0, 0] }))
    const first = batchStaticModel(root)
    const meshCountAfterFirst = root.children.length

    const second = batchStaticModel(root)

    expect(second.mergedMeshCount).toBe(0)
    expect(second.consumedMeshCount).toBe(0)
    expect(root.children.length).toBe(meshCountAfterFirst)
    expect(first.mergedMeshCount).toBe(1)
  })

  it('keeps the model root transform and userData intact', () => {
    const root = new THREE.Group()
    root.userData.sandboxModelId = 'sandbox_7'
    root.position.set(10, 0, -4)
    root.rotation.y = 0.5
    const material = new THREE.MeshStandardMaterial()
    root.add(makeMesh('a', material))
    root.add(makeMesh('b', material, { position: [0, 0, 2] }))

    batchStaticModel(root)

    expect(root.userData.sandboxModelId).toBe('sandbox_7')
    expect(root.position.x).toBe(10)
    expect(root.position.z).toBe(-4)
    expect(root.rotation.y).toBeCloseTo(0.5)
  })

  it('disposes consumed geometries but never the shared materials', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const geometryA = new THREE.BoxGeometry(1, 1, 1)
    const geometryB = new THREE.BoxGeometry(1, 1, 1)
    const meshA = new THREE.Mesh(geometryA, material)
    const meshB = new THREE.Mesh(geometryB, material)
    meshB.position.x = 2
    root.add(meshA, meshB)
    const disposeGeometry = vi.spyOn(geometryA, 'dispose')
    const disposeMaterial = vi.spyOn(material, 'dispose')

    batchStaticModel(root)

    expect(disposeGeometry).toHaveBeenCalled()
    expect(disposeMaterial).not.toHaveBeenCalled()
  })

  it('never consumes the model root itself even when the root is a mesh', () => {
    const material = new THREE.MeshStandardMaterial()
    const root = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material)
    root.userData.sandboxModelId = 'sandbox_9'
    const childA = makeMesh('child-a', material)
    const childB = makeMesh('child-b', material, { position: [4, 0, 0] })
    root.add(childA, childB)

    batchStaticModel(root)

    expect(root.parent).toBeNull()
    expect(root.geometry).toBeTruthy()
    expect(root.userData.sandboxModelId).toBe('sandbox_9')
    const batchRoot = root.getObjectByName(STATIC_BATCH_ROOT_NAME)
    expect(batchRoot.children[0].userData.staticBatchSourceCount).toBe(2)
  })

  it('maps raycast face indices back to the source component part ids', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const partA = new THREE.Group()
    partA.userData.componentId = 'part-a'
    partA.position.set(-4, 0, 0)
    partA.add(makeMesh('a-mesh', material))
    const bare = makeMesh('bare-mesh', material, { position: [0, 0, 0] })
    const partB = new THREE.Group()
    partB.userData.componentId = 'part-b'
    partB.position.set(4, 0, 0)
    partB.add(makeMesh('b-mesh', material))
    root.add(partA, bare, partB)

    batchStaticModel(root)
    const batchMesh = root.getObjectByName(STATIC_BATCH_ROOT_NAME).children[0]
    batchMesh.updateWorldMatrix(true, false)

    const rayAt = x => {
      const raycaster = new THREE.Raycaster()
      raycaster.set(new THREE.Vector3(x, 0, 10), new THREE.Vector3(0, 0, -1))
      return raycaster.intersectObject(batchMesh, false)[0]
    }
    const hitA = rayAt(-4)
    const hitB = rayAt(4)
    const hitBare = rayAt(0)
    expect(hitA).toBeTruthy()
    expect(hitB).toBeTruthy()
    expect(hitBare).toBeTruthy()
    expect(resolveStaticBatchPartId(batchMesh, hitA.faceIndex)).toBe('part-a')
    expect(resolveStaticBatchPartId(batchMesh, hitB.faceIndex)).toBe('part-b')
    expect(resolveStaticBatchPartId(batchMesh, hitBare.faceIndex)).toBeNull()
  })

  it('resolveStaticBatchPartId returns null for invalid input instead of throwing', () => {
    expect(resolveStaticBatchPartId(null, 3)).toBeNull()
    const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    expect(resolveStaticBatchPartId(plain, 3)).toBeNull()
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    root.add(makeMesh('a', material), makeMesh('b', material, { position: [2, 0, 0] }))
    batchStaticModel(root)
    const batchMesh = root.getObjectByName(STATIC_BATCH_ROOT_NAME).children[0]
    expect(resolveStaticBatchPartId(batchMesh, -1)).toBeNull()
    expect(resolveStaticBatchPartId(batchMesh, Number.MAX_SAFE_INTEGER)).toBeNull()
  })

  it('keeps original meshes when no compatible merge partner exists', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const standard = makeMesh('standard', material)
    const rawGeometry = new THREE.BufferGeometry()
    rawGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ], 3))
    const rawMesh = new THREE.Mesh(rawGeometry, material)
    rawMesh.position.x = 3
    root.add(standard, rawMesh)

    const result = batchStaticModel(root)

    expect(result.consumedMeshCount).toBe(0)
    expect(standard.parent).toBe(root)
    expect(rawMesh.parent).toBe(root)
    expect(root.getObjectByName(STATIC_BATCH_ROOT_NAME)).toBeFalsy()
  })

  it('still merges the compatible subset when an incompatible mesh shares the material', () => {
    const root = new THREE.Group()
    const material = new THREE.MeshStandardMaterial()
    const standardA = makeMesh('standard-a', material)
    const standardB = makeMesh('standard-b', material, { position: [2, 0, 0] })
    const rawGeometry = new THREE.BufferGeometry()
    rawGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ], 3))
    const rawMesh = new THREE.Mesh(rawGeometry, material)
    rawMesh.position.x = 5
    root.add(standardA, standardB, rawMesh)

    const result = batchStaticModel(root)

    expect(result.consumedMeshCount).toBe(2)
    expect(rawMesh.parent).toBe(root)
  })
})
