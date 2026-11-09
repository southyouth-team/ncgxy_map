import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { testModelTraversalRoutes } from './modelTraversalTester.js'

beforeAll(async () => {
  await RAPIER.init()
})

describe('testModelTraversalRoutes', () => {
  it('does not certify a stair route without explicit start and end points', async () => {
    const model = new THREE.Group()
    const stairs = new THREE.Group()
    stairs.userData.componentId = 'stairs-main'
    stairs.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 1), new THREE.MeshBasicMaterial()))
    model.add(stairs)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { traversability: {
        stairs: [{ id: 'stairs', targetPartId: 'stairs-main' }],
      } } },
    }

    const result = await testModelTraversalRoutes(THREE, RAPIER, model)
    expect(result.status).toBe('needs-route-endpoints')
    expect(result.certifiedWalkable).toBe(false)
    expect(result.routes[0].reason).toBe('startPoint/endPoint-required')
  })

  it('probes an actual stepped mesh using the Rapier character controller', async () => {
    const model = new THREE.Group()
    const stairs = new THREE.Group()
    stairs.userData.componentId = 'stairs-main'
    for (let index = 0; index < 4; index += 1) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.18, 2),
        new THREE.MeshBasicMaterial(),
      )
      step.position.set(index * 0.45, 0.09 + index * 0.18, 0)
      stairs.add(step)
    }
    const landing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 2), new THREE.MeshBasicMaterial())
    landing.position.set(2, 0.62, 0)
    stairs.add(landing)
    model.add(stairs)

    const ground = new THREE.Group()
    ground.userData.componentId = 'ground'
    ground.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 3), new THREE.MeshBasicMaterial()))
    model.add(ground)

    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: {
        surfaces: [{ id: 'ground-surface', targetPartId: 'ground', shape: 'mesh', supportsStanding: true, walkable: true }],
        traversability: {
          stairs: [{
            id: 'main-stair-run',
            targetPartId: 'stairs-main',
            startPoint: { x: -0.8, y: 0, z: 0 },
            endPoint: { x: 2.3, y: 0.72, z: 0 },
          }],
        },
      } },
    }

    const result = await testModelTraversalRoutes(THREE, RAPIER, model, {
      // Deliberately attempt to override character dimensions. The probe must
      // ignore this and use the same global profile as the live player.
      traversalProfile: { radius: 1.4, height: 3, maxStepHeight: 0.01 },
      maxDuration: 8,
      speed: 2.2,
    })
    expect(result.summary.testedCount).toBe(1)
    expect(result.routes[0].status).toBe('passed')
    expect(result.declaredRoutesPassed).toBe(true)
    expect(result.certifiedWalkable).toBe(true)
  })
})
