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

  it('keeps models without spatial declarations non-blocking', () => {
    const root = new THREE.Group()
    expect(collectModelMovementObstacles(THREE, root, 'sandbox_3')).toEqual([])
  })
})
