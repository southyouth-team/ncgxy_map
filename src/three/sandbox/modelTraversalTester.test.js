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



  it('allows a character to enter a building through its actual doorway opening', async () => {
    const model = new THREE.Group()
    const shell = new THREE.Group()
    shell.userData.componentId = 'building-shell'
    const jamb = new THREE.BoxGeometry(0.3, 2.2, 0.4)
    const left = new THREE.Mesh(jamb, new THREE.MeshBasicMaterial())
    left.position.set(-1.15, 1.1, 0)
    const right = new THREE.Mesh(jamb, new THREE.MeshBasicMaterial())
    right.position.set(1.15, 1.1, 0)
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2, 0.35, 0.4), new THREE.MeshBasicMaterial())
    lintel.position.set(0, 2.125, 0)
    shell.add(left, right, lintel)
    model.add(shell)
    const route = new THREE.Group()
    route.userData.componentId = 'building-entry-route'
    model.add(route)
    const ground = new THREE.Group()
    ground.userData.componentId = 'building-ground'
    ground.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 4), new THREE.MeshBasicMaterial()))
    model.add(ground)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: {
        colliders: [{ id: 'building-shell-mesh', targetPartId: 'building-shell', shape: 'mesh' }],
        surfaces: [{ id: 'building-ground-surface', targetPartId: 'building-ground', shape: 'mesh', supportsStanding: true, walkable: true }],
        traversability: { passages: [{
          id: 'building-entry', targetPartId: 'building-entry-route',
          startPoint: { x: 0, y: 0.1, z: 1.5 }, endPoint: { x: 0, y: 0.1, z: -1.5 },
        }] },
      } },
    }
    const result = await testModelTraversalRoutes(THREE, RAPIER, model, { maxDuration: 5, speed: 2 })
    expect(result.routes[0]).toMatchObject({ status: 'passed', type: 'passages' })
    expect(result.certifiedWalkable).toBe(true)
  })

  it('prevents a character from passing through a solid mountain Mesh', async () => {
    const model = new THREE.Group()
    const mountain = new THREE.Group()
    mountain.userData.componentId = 'mountain-body'
    mountain.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.8), new THREE.MeshBasicMaterial()))
    model.add(mountain)
    const route = new THREE.Group()
    route.userData.componentId = 'mountain-crossing-route'
    model.add(route)
    const ground = new THREE.Group()
    ground.userData.componentId = 'mountain-ground'
    ground.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 4), new THREE.MeshBasicMaterial()))
    model.add(ground)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: {
        colliders: [{ id: 'mountain-mesh', targetPartId: 'mountain-body', shape: 'mesh' }],
        surfaces: [{ id: 'mountain-ground-surface', targetPartId: 'mountain-ground', shape: 'mesh', supportsStanding: true, walkable: true }],
        traversability: { passages: [{
          id: 'mountain-crossing', targetPartId: 'mountain-crossing-route',
          startPoint: { x: 0, y: 0.1, z: 1.5 }, endPoint: { x: 0, y: 0.1, z: -1.5 },
        }] },
      } },
    }
    const result = await testModelTraversalRoutes(THREE, RAPIER, model, { maxDuration: 4, speed: 2 })
    expect(result.routes[0]).toMatchObject({ status: 'failed', reason: 'blocked-or-stuck' })
    expect(result.certifiedWalkable).toBe(false)
  })

  it('blocks entry into a water volume while keeping an elevated bridge route open', async () => {
    const model = new THREE.Group()
    const shoreline = new THREE.Group()
    shoreline.userData.componentId = 'water-boundary'
    shoreline.add(new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.2), new THREE.MeshBasicMaterial()))
    shoreline.position.y = 1
    model.add(shoreline)
    const bridge = new THREE.Group()
    bridge.userData.componentId = 'water-bridge'
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), new THREE.MeshBasicMaterial())
    deck.position.y = 2.2
    bridge.add(deck)
    model.add(bridge)
    const ground = new THREE.Group()
    ground.userData.componentId = 'water-bank-ground'
    ground.add(new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 4), new THREE.MeshBasicMaterial()))
    model.add(ground)
    const waterRoute = new THREE.Group()
    waterRoute.userData.componentId = 'water-entry-route'
    model.add(waterRoute)
    const bridgeRoute = new THREE.Group()
    bridgeRoute.userData.componentId = 'bridge-crossing-route'
    model.add(bridgeRoute)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: {
        colliders: [
          { id: 'shoreline-wall', targetPartId: 'water-boundary', shape: 'mesh' },
          { id: 'bridge-deck-collider', targetPartId: 'water-bridge', shape: 'mesh' },
        ],
        surfaces: [
          { id: 'bank-ground-surface', targetPartId: 'water-bank-ground', shape: 'mesh', supportsStanding: true, walkable: true },
          { id: 'bridge-surface', targetPartId: 'water-bridge', shape: 'mesh', supportsStanding: true, walkable: true },
        ],
        traversability: { passages: [
          {
            id: 'enter-water', targetPartId: 'water-entry-route',
            startPoint: { x: 0, y: 0.1, z: 1.5 }, endPoint: { x: 0, y: 0.1, z: -1.5 },
          },
          {
            id: 'cross-over-bridge', targetPartId: 'bridge-crossing-route',
            startPoint: { x: 0, y: 2.3, z: 1.5 }, endPoint: { x: 0, y: 2.3, z: -1.5 },
          },
        ] },
      } },
    }
    const result = await testModelTraversalRoutes(THREE, RAPIER, model, { maxDuration: 5, speed: 2 })
    expect(result.routes.find(item => item.id === 'enter-water')).toMatchObject({
      status: 'failed', reason: 'blocked-or-stuck',
    })
    expect(result.routes.find(item => item.id === 'cross-over-bridge')).toMatchObject({
      status: 'passed',
    })
    expect(result.certifiedWalkable).toBe(true)
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


it('requires a real grounded landing on the destination platform for jump routes', async () => {
  const model = new THREE.Group()
  const frame = new THREE.Group()
  frame.userData.componentId = 'jump-frame'
  model.add(frame)
  const startPlatform = new THREE.Group()
  startPlatform.userData.componentId = 'jump-start'
  const startMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 4), new THREE.MeshBasicMaterial())
  startMesh.position.set(-1.5, 0, 0)
  startPlatform.add(startMesh)
  model.add(startPlatform)
  const landingPlatform = new THREE.Group()
  landingPlatform.userData.componentId = 'jump-landing'
  const landingMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 4), new THREE.MeshBasicMaterial())
  landingMesh.position.set(1.5, 0, 0)
  landingPlatform.add(landingMesh)
  model.add(landingPlatform)
  model.userData.proceduralModelCapabilityManifest = {
    capabilities: { spatial: {
      surfaces: [
        { id: 'start-surface', targetPartId: 'jump-start', shape: 'mesh', supportsStanding: true, walkable: true },
        { id: 'landing-surface', targetPartId: 'jump-landing', shape: 'mesh', supportsStanding: true, walkable: true },
      ],
      traversability: { jumps: [{
        id: 'gap-jump', targetPartId: 'jump-frame',
        startPoint: { x: -1.1, y: 0.1, z: 0 }, endPoint: { x: 1.1, y: 0.1, z: 0 },
      }] },
    } },
  }
  const result = await testModelTraversalRoutes(THREE, RAPIER, model, { maxDuration: 3 })
  expect(result.routes[0].type).toBe('jumps')
  expect(result.routes[0].status).toBe('passed')
  expect(result.routes[0].finalState.grounded).toBe(true)
})
