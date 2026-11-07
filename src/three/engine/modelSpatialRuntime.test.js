import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectModelMovementObstacles } from './modelSpatialRuntime.js'

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
