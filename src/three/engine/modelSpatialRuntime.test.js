import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectModelMovementObstacles, collectModelTraversalTrimeshes, refreshModelPhysicsRegistration, refreshModelSpatialRegistration } from './modelSpatialRuntime.js'
import { CollisionWorld } from '../physics/CollisionWorld.js'

describe('collectModelMovementObstacles', () => {
  it('converts a declared part-local box collider into world-space bounds', () => {
    const root = new THREE.Group()
    root.position.set(10, 0, 5)
    const wall = new THREE.Group()
    wall.userData.componentId = 'wall-a'
    root.add(wall)
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      parameters: [],
      capabilities: { spatial: { colliders: [{
        id: 'wall-collider', targetPartId: 'wall-a', shape: 'box',
        center: { x: 0, y: 1, z: 0 }, size: { x: 4, y: 2, z: 0.4 },
      }] } },
    }
    const result = collectModelMovementObstacles(THREE, root, 'sandbox_1')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      ownerId: 'sandbox_1', minX: 8, maxX: 12, minZ: 4.8, maxZ: 5.2,
    })
  })

  it('ignores disabled, non-blocking, missing-part and elevated colliders', () => {
    const root = new THREE.Group()
    const part = new THREE.Group()
    part.userData.componentId = 'part'
    part.position.y = 4
    root.add(part)
    root.userData.proceduralModelCapabilityManifest = {
      version: 1, parameters: [], capabilities: { spatial: { colliders: [
        { targetPartId: 'part', shape: 'box', size: { x: 1, y: 1, z: 1 } },
        { targetPartId: 'missing', shape: 'box', size: { x: 1, y: 1, z: 1 } },
        { targetPartId: 'part', shape: 'box', blocksMovement: false, size: { x: 1, y: 1, z: 1 } },
        { targetPartId: 'part', shape: 'box', enabled: false, size: { x: 1, y: 1, z: 1 } },
      ] } },
    }
    expect(collectModelMovementObstacles(THREE, root, 'sandbox_2')).toEqual([])
  })

  it('applies a part-scoped user override without changing the model manifest', () => {
    const root = new THREE.Group()
    const wall = new THREE.Group()
    wall.userData.componentId = 'wall-a'
    root.add(wall)
    root.userData.proceduralModelCapabilityManifest = {
      version: 1, capabilities: { spatial: { colliders: [{
        id: 'wall-a-collider', targetPartId: 'wall-a', shape: 'box',
        size: { x: 2, y: 2, z: 0.3 },
      }] } },
    }
    root.userData.proceduralModelCapabilityControlDocument = {
      version: 1, inference: { proposals: [] }, diagnostics: [],
      overrides: [{
        capabilityId: 'spatial.collider.wall-a-collider.blocksMovement',
        scope: { targetType: 'part', targetId: 'wall-a' },
        action: 'set', value: { blocksMovement: false },
      }],
    }
    expect(collectModelMovementObstacles(THREE, root, 'sandbox_override')).toEqual([])
    expect(root.userData.proceduralModelCapabilityManifest.capabilities.spatial.colliders[0].blocksMovement).toBeUndefined()
  })

  it('keeps overrides isolated to the targeted part and can explicitly enable blocking', () => {
    const root = new THREE.Group()
    for (const id of ['wall-a', 'wall-b']) {
      const part = new THREE.Group()
      part.userData.componentId = id
      root.add(part)
    }
    root.userData.proceduralModelCapabilityManifest = {
      version: 1, capabilities: { spatial: { colliders: ['wall-a', 'wall-b'].map(id => ({
        id: id + '-collider', targetPartId: id, shape: 'box',
        blocksMovement: false, size: { x: 2, y: 2, z: 0.3 },
      })) } },
    }
    root.userData.proceduralModelCapabilityControlDocument = {
      version: 1, inference: { proposals: [] }, diagnostics: [],
      overrides: [{
        capabilityId: 'spatial.collider.wall-a-collider.blocksMovement',
        scope: { targetType: 'part', targetId: 'wall-a' },
        action: 'set', value: { blocksMovement: true },
      }],
    }
    const result = collectModelMovementObstacles(THREE, root, 'sandbox_scope')
    expect(result).toHaveLength(1)
    expect(result[0].ownerId).toBe('sandbox_scope')
  })

  it('toggles a door-leaf collider from closed to open using persisted model state', () => {
    const root = new THREE.Group()
    const door = new THREE.Group()
    door.userData.componentId = 'door-panel'
    root.add(door)
    root.userData.worldState = { doorOpen: false }
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      capabilities: { spatial: { colliders: [{
        id: 'door-leaf-collider', targetPartId: 'door-panel', shape: 'box',
        size: { x: 0.9, y: 2, z: 0.12 }, blocksMovement: true,
        stateCondition: { key: 'doorOpen', equals: false, defaultValue: false },
      }] } },
    }

    expect(collectModelMovementObstacles(THREE, root, 'door-model')).toHaveLength(1)
    root.userData.worldState = { doorOpen: true }
    expect(collectModelMovementObstacles(THREE, root, 'door-model')).toEqual([])
  })

  it('lets an explicit user collider override take precedence over door state', () => {
    const root = new THREE.Group()
    const door = new THREE.Group()
    door.userData.componentId = 'door-panel'
    root.add(door)
    root.userData.worldState = { doorOpen: true }
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      capabilities: { spatial: { colliders: [{
        id: 'door-leaf-collider', targetPartId: 'door-panel', shape: 'box',
        size: { x: 0.9, y: 2, z: 0.12 }, blocksMovement: true,
        stateCondition: { key: 'doorOpen', equals: false, defaultValue: false },
      }] } },
    }
    root.userData.proceduralModelCapabilityControlDocument = {
      version: 1, inference: { proposals: [] }, diagnostics: [],
      overrides: [{
        capabilityId: 'spatial.collider.door-leaf-collider.blocksMovement',
        scope: { targetType: 'part', targetId: 'door-panel' },
        action: 'set', value: { blocksMovement: true },
      }],
    }

    expect(collectModelMovementObstacles(THREE, root, 'door-override')).toHaveLength(1)
  })

  it('lets a dynamic model parameter control a bound spatial collider', () => {
    const root = new THREE.Group()
    const wall = new THREE.Group()
    wall.userData.componentId = 'wall-panel'
    root.add(wall)
    const capabilityId = 'spatial.collider.wall-panel-collider.blocksMovement'
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      parameters: [{
        id: 'wallBlocksPlayer',
        label: '墙体阻挡玩家',
        type: 'boolean',
        default: true,
        bindings: [{ capabilityId, property: 'blocksMovement' }],
      }],
      capabilities: { spatial: { colliders: [{
        id: 'wall-panel-collider', targetPartId: 'wall-panel', shape: 'box',
        size: { x: 2, y: 2, z: 0.25 }, blocksMovement: true,
      }] } },
    }
    root.userData.proceduralModelParameterValues = { wallBlocksPlayer: true }

    expect(collectModelMovementObstacles(THREE, root, 'parameter-bound')).toHaveLength(1)
    root.userData.proceduralModelParameterValues.wallBlocksPlayer = false
    expect(collectModelMovementObstacles(THREE, root, 'parameter-bound')).toEqual([])
  })

  it('keeps explicit user capability overrides above parameter bindings', () => {
    const root = new THREE.Group()
    const wall = new THREE.Group()
    wall.userData.componentId = 'wall-panel'
    root.add(wall)
    const capabilityId = 'spatial.collider.wall-panel-collider.blocksMovement'
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      parameters: [{
        id: 'wallBlocksPlayer', type: 'boolean', default: false,
        bindings: [{ capabilityId, property: 'blocksMovement' }],
      }],
      capabilities: { spatial: { colliders: [{
        id: 'wall-panel-collider', targetPartId: 'wall-panel', shape: 'box',
        size: { x: 2, y: 2, z: 0.25 }, blocksMovement: false,
      }] } },
    }
    root.userData.proceduralModelParameterValues = { wallBlocksPlayer: false }
    root.userData.proceduralModelCapabilityControlDocument = {
      version: 1, inference: { proposals: [] }, diagnostics: [],
      overrides: [{
        capabilityId,
        scope: { targetType: 'part', targetId: 'wall-panel' },
        action: 'set',
        value: { blocksMovement: true },
      }],
    }

    expect(collectModelMovementObstacles(THREE, root, 'parameter-priority')).toHaveLength(1)
  })

  it('keeps models without spatial declarations non-blocking', () => {
    const root = new THREE.Group()
    expect(collectModelMovementObstacles(THREE, root, 'sandbox_3')).toEqual([])
  })
})


describe('collectModelSupportSurfaces', () => {
  it('registers real mesh geometry as a standing and walkable surface', async () => {
    const { collectModelSupportSurfaces } = await import('./modelSpatialRuntime.js')
    const root = new THREE.Group()
    const platform = new THREE.Group()
    platform.userData.componentId = 'platform-top'
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), new THREE.MeshBasicMaterial())
    platform.add(mesh)
    root.add(platform)
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      capabilities: { spatial: { surfaces: [{
        id: 'platform-surface', targetPartId: 'platform-top', shape: 'mesh',
        supportsStanding: true, walkable: true,
      }] } },
    }
    const result = collectModelSupportSurfaces(root, 'sandbox_platform')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      ownerId: 'sandbox_platform', surfaceId: 'platform-surface',
      targetPartId: 'platform-top', supportsStanding: true, walkable: true,
    })
    expect(result[0].meshes).toEqual([mesh])
  })

  it('ignores disabled, unresolved, empty and unsupported declarations', async () => {
    const { collectModelSupportSurfaces } = await import('./modelSpatialRuntime.js')
    const root = new THREE.Group()
    const group = new THREE.Group()
    group.userData.componentId = 'empty-part'
    root.add(group)
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      capabilities: { spatial: { surfaces: [
        { id: 'disabled', targetPartId: 'empty-part', shape: 'mesh', enabled: false, walkable: true },
        { id: 'unresolved', targetPartId: 'missing', shape: 'mesh', walkable: true },
        { id: 'no-geometry', targetPartId: 'empty-part', shape: 'mesh', walkable: true },
        { id: 'not-surface', targetPartId: 'empty-part', shape: 'mesh' },
        { id: 'unsupported-shape', targetPartId: 'empty-part', shape: 'box', walkable: true },
      ] } },
    }
    expect(collectModelSupportSurfaces(root, 'sandbox_invalid')).toEqual([])
  })

  it('resolves descendant meshes through a stable component group ID', async () => {
    const { collectModelSupportSurfaces } = await import('./modelSpatialRuntime.js')
    const root = new THREE.Group()
    const stairs = new THREE.Group()
    stairs.userData.componentId = 'traversal-part'
    const steps = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshBasicMaterial())
    stairs.add(steps)
    root.add(stairs)
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      capabilities: { spatial: { surfaces: [{
        id: 'stair-traversal', targetPartId: 'traversal-part', shape: 'mesh',
        supportsStanding: true, walkable: true,
      }] } },
    }
    expect(collectModelSupportSurfaces(root, 'sandbox_stairs')[0].meshes).toEqual([steps])
  })
})


describe('refreshModelSpatialRegistration', () => {
  function createSpatialModel(id = 'instance-a') {
    const root = new THREE.Group()
    root.userData.sandboxModelId = id
    const wall = new THREE.Group()
    wall.userData.componentId = 'wall-v1'
    root.add(wall)
    const floor = new THREE.Group()
    floor.userData.componentId = 'floor-v1'
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), new THREE.MeshBasicMaterial())
    floor.add(mesh)
    root.add(floor)
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      capabilities: { spatial: {
        colliders: [{ id: 'wall-v1-collider', targetPartId: 'wall-v1', shape: 'box', center: { x: 0, y: 1, z: 0 }, size: { x: 2, y: 2, z: 0.3 } }],
        surfaces: [{ id: 'floor-v1-surface', targetPartId: 'floor-v1', shape: 'mesh', supportsStanding: true, walkable: true }],
      } },
    }
    return { root, mesh }
  }

  it('rebuilds live obstacles and support mesh handles from the replacement manifest', () => {
    const collisionWorld = new CollisionWorld({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 })
    const { root, mesh: oldMesh } = createSpatialModel()
    expect(refreshModelSpatialRegistration(THREE, root, collisionWorld)).toBe(1)
    expect(collisionWorld.obstacles).toHaveLength(1)
    expect(collisionWorld.supportSurfaces).toHaveLength(1)
    expect(collisionWorld.supportSurfaces[0].meshes).toEqual([oldMesh])

    const oldWall = root.children.find(part => part.userData.componentId === 'wall-v1')
    const oldFloor = root.children.find(part => part.userData.componentId === 'floor-v1')
    root.remove(oldWall, oldFloor)
    const newWall = new THREE.Group()
    newWall.userData.componentId = 'wall-v2'
    root.add(newWall)
    const newFloor = new THREE.Group()
    newFloor.userData.componentId = 'floor-v2'
    const newMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 6), new THREE.MeshBasicMaterial())
    newFloor.add(newMesh)
    root.add(newFloor)
    root.userData.proceduralModelCapabilityManifest.capabilities.spatial = {
      colliders: [{ id: 'wall-v2-collider', targetPartId: 'wall-v2', shape: 'box', center: { x: 3, y: 1, z: 0 }, size: { x: 2, y: 2, z: 0.3 } }],
      surfaces: [{ id: 'floor-v2-surface', targetPartId: 'floor-v2', shape: 'mesh', supportsStanding: true, walkable: true }],
    }

    expect(refreshModelSpatialRegistration(THREE, root, collisionWorld)).toBe(1)
    expect(collisionWorld.obstacles).toHaveLength(1)
    expect(collisionWorld.obstacles[0]).toMatchObject({ ownerId: 'instance-a', minX: 2, maxX: 4 })
    expect(collisionWorld.supportSurfaces).toHaveLength(1)
    expect(collisionWorld.supportSurfaces[0]).toMatchObject({
      ownerId: 'instance-a', surfaceId: 'floor-v2-surface', targetPartId: 'floor-v2',
    })
    expect(collisionWorld.supportSurfaces[0].meshes).toEqual([newMesh])
    expect(collisionWorld.supportSurfaces[0].meshes).not.toContain(oldMesh)
  })

  it('removes prior registrations when the replacement no longer declares spatial capabilities', () => {
    const collisionWorld = new CollisionWorld({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 })
    const { root } = createSpatialModel()
    refreshModelSpatialRegistration(THREE, root, collisionWorld)
    root.userData.proceduralModelCapabilityManifest.capabilities.spatial = {}
    expect(refreshModelSpatialRegistration(THREE, root, collisionWorld)).toBe(0)
    expect(collisionWorld.obstacles).toEqual([])
    expect(collisionWorld.supportSurfaces).toEqual([])
  })

  it('updates world matrices before rebuilding transformed collider bounds', () => {
    const collisionWorld = new CollisionWorld({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 })
    const { root } = createSpatialModel()
    root.position.set(10, 0, 5)
    refreshModelSpatialRegistration(THREE, root, collisionWorld)
    expect(collisionWorld.obstacles[0]).toMatchObject({ minX: 9, maxX: 11, minZ: 4.85, maxZ: 5.15 })
  })
})


describe('spatial registration persistence', () => {
  it('restores the same collider, support surface and user override from Object3D JSON', () => {
    const collisionWorld = new CollisionWorld({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 })
    const root = new THREE.Group()
    root.userData.sandboxModelId = 'persisted-instance'
    const door = new THREE.Group()
    door.userData.componentId = 'door-leaf'
    root.add(door)
    const wall = new THREE.Group()
    wall.userData.componentId = 'wall-main'
    root.add(wall)
    const floor = new THREE.Group()
    floor.userData.componentId = 'floor-main'
    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 8), new THREE.MeshBasicMaterial())
    floor.add(floorMesh)
    root.add(floor)
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      capabilities: { spatial: {
        colliders: [
          { id: 'door-leaf', targetPartId: 'door-leaf', shape: 'box', center: { x: 0, y: 1, z: 0 }, size: { x: 1, y: 2, z: 0.2 } },
          { id: 'wall-main', targetPartId: 'wall-main', shape: 'box', center: { x: 2, y: 1, z: 0 }, size: { x: 1, y: 2, z: 0.2 } },
        ],
        surfaces: [{ id: 'floor-main-surface', targetPartId: 'floor-main', shape: 'mesh', supportsStanding: true, walkable: true }],
      } },
    }
    root.userData.proceduralModelCapabilityControlDocument = {
      version: 1,
      inference: { proposals: [] },
      overrides: [{
        capabilityId: 'spatial.collider.door-leaf.blocksMovement',
        scope: { targetType: 'part', targetId: 'door-leaf' },
        action: 'set',
        value: { blocksMovement: false },
      }],
      diagnostics: [],
    }

    refreshModelSpatialRegistration(THREE, root, collisionWorld)
    expect(collisionWorld.obstacles).toHaveLength(1)
    expect(collisionWorld.obstacles[0]).toMatchObject({ minX: 1.5, maxX: 2.5 })
    expect(collisionWorld.supportSurfaces).toHaveLength(1)

    const restored = new THREE.ObjectLoader().parse(root.toJSON())
    let restoredFloor = null
    restored.traverse(object => {
      if (object.userData?.componentId === 'floor-main') restoredFloor = object
    })
    expect(restoredFloor).toBeTruthy()
    const restoredFloorMesh = restoredFloor.children[0]
    const restoredWorld = new CollisionWorld({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 })
    expect(refreshModelSpatialRegistration(THREE, restored, restoredWorld)).toBe(1)
    expect(restoredWorld.obstacles).toHaveLength(1)
    expect(restoredWorld.obstacles[0]).toMatchObject({ minX: 1.5, maxX: 2.5 })
    expect(restoredWorld.supportSurfaces).toHaveLength(1)
    expect(restoredWorld.supportSurfaces[0]).toMatchObject({
      ownerId: 'persisted-instance',
      surfaceId: 'floor-main-surface',
      targetPartId: 'floor-main',
      supportsStanding: true,
      walkable: true,
    })
    expect(restoredWorld.supportSurfaces[0].meshes).toEqual([restoredFloorMesh])
    expect(restoredWorld.supportSurfaces[0].meshes).not.toContain(floorMesh)
    expect(restored.userData.proceduralModelCapabilityControlDocument.overrides).toEqual(
      root.userData.proceduralModelCapabilityControlDocument.overrides,
    )
  })
})


describe('refreshModelPhysicsRegistration', () => {
  function createPhysicsModel() {
    const root = new THREE.Group()
    root.userData.sandboxModelId = 'physics-model'
    const upperWall = new THREE.Group()
    upperWall.userData.componentId = 'upper-wall'
    upperWall.position.y = 4
    root.add(upperWall)
    const door = new THREE.Group()
    door.userData.componentId = 'door-panel'
    root.add(door)
    root.userData.worldState = { doorOpen: false }
    root.userData.proceduralModelCapabilityManifest = {
      version: 1,
      parameters: [],
      capabilities: { spatial: { colliders: [
        { id: 'upper-wall-box', targetPartId: 'upper-wall', shape: 'box', center: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 2, z: 0.4 } },
        { id: 'door-box', targetPartId: 'door-panel', shape: 'box', center: { x: 0, y: 1, z: 0 }, size: { x: 1, y: 2, z: 0.15 }, stateCondition: { key: 'doorOpen', equals: false, defaultValue: false } },
      ] } },
    }
    return root
  }

  it('registers full-height Rapier boxes, including elevated colliders', () => {
    const model = createPhysicsModel()
    model.position.set(10, 0, 5)
    const calls = []
    const runtime = {
      removeOwner: id => calls.push({ type: 'remove', id }),
      createStaticBox: options => calls.push({ type: 'create', options }),
    }
    expect(refreshModelPhysicsRegistration(THREE, model, runtime)).toBe(2)
    const boxes = calls.filter(item => item.type === 'create').map(item => item.options)
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toMatchObject({
      ownerId: 'physics-model',
      translation: { x: 10, y: 4, z: 5 },
    })
    expect(boxes[0].halfExtents.x).toBeCloseTo(2)
    expect(boxes[0].halfExtents.y).toBeCloseTo(1)
    expect(boxes[0].halfExtents.z).toBeCloseTo(0.2)
  })

  it('compiles declared stair Mesh geometry into world-space triangle buffers', () => {
    const model = new THREE.Group()
    const stairs = new THREE.Group()
    stairs.userData.componentId = 'stairs-main'
    stairs.position.set(3, 1, 2)
    stairs.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 1), new THREE.MeshBasicMaterial()))
    model.add(stairs)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: {
        traversability: { stairs: [{ id: 'main-stairs', targetPartId: 'stairs-main' }] },
        colliders: [{ id: 'stairs-box', targetPartId: 'stairs-main', shape: 'box', size: { x: 2, y: 0.2, z: 1 } }],
      } },
    }
    const result = collectModelTraversalTrimeshes(THREE, model, 'stairs-instance')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      ownerId: 'stairs-instance', surfaceId: 'main-stairs',
      targetPartId: 'stairs-main', type: 'stairs',
    })
    expect(result[0].vertices.length).toBeGreaterThanOrEqual(9)
    expect(result[0].indices.length).toBeGreaterThanOrEqual(3)
    expect(result[0].vertices[0]).toBeCloseTo(2)
    expect(result[0].vertices[1]).toBeCloseTo(0.9)
  })

  it('registers stair geometry as a Rapier trimesh instead of an overlapping box', () => {
    const model = new THREE.Group()
    model.userData.sandboxModelId = 'stairs-instance'
    const stairs = new THREE.Group()
    stairs.userData.componentId = 'stairs-main'
    stairs.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 1), new THREE.MeshBasicMaterial()))
    model.add(stairs)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: {
        traversability: { stairs: [{ id: 'main-stairs', targetPartId: 'stairs-main' }] },
        colliders: [{ id: 'stairs-box', targetPartId: 'stairs-main', shape: 'box', size: { x: 2, y: 0.2, z: 1 } }],
      } },
    }
    const calls = []
    const runtime = {
      removeOwner: id => calls.push({ type: 'remove', id }),
      createStaticBox: options => calls.push({ type: 'box', options }),
      createStaticTrimesh: options => calls.push({ type: 'trimesh', options }),
    }
    expect(refreshModelPhysicsRegistration(THREE, model, runtime)).toBe(1)
    expect(calls.filter(item => item.type === 'trimesh')).toHaveLength(1)
    expect(calls.filter(item => item.type === 'box')).toHaveLength(0)
  })

  it('honors state-conditioned door colliders and removes stale owner bodies', () => {
    const model = createPhysicsModel()
    const calls = []
    const runtime = {
      removeOwner: id => calls.push({ type: 'remove', id }),
      createStaticBox: options => calls.push({ type: 'create', options }),
    }
    expect(refreshModelPhysicsRegistration(THREE, model, runtime)).toBe(2)
    model.userData.worldState.doorOpen = true
    expect(refreshModelPhysicsRegistration(THREE, model, runtime)).toBe(1)
    expect(calls.filter(item => item.type === 'remove')).toHaveLength(2)
    const ids = calls.filter(item => item.type === 'create').slice(-1).map(item => item.options.id)
    expect(ids[0]).toContain('upper-wall-box')
  })
})
