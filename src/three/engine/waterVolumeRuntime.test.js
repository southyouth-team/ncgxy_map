import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectModelWaterVolumes, samplePlayerWaterState } from './waterVolumeRuntime.js'

function createWaterModel(depth = 0.6) {
  const root = new THREE.Group()
  const basin = new THREE.Group()
  basin.userData.componentId = 'basin'
  const surface = new THREE.Group()
  surface.userData.componentId = 'water-surface'
  surface.position.y = depth
  basin.add(surface)
  root.add(basin)
  root.userData.sandboxModelId = 'sandbox_water'
  root.userData.proceduralModelCapabilityManifest = {
    version: 1,
    parameters: [{
      id: 'waterDepth',
      default: depth,
      bindings: [{ capabilityId: 'spatial.waterVolume.main.depth', property: 'depth' }],
    }],
    capabilities: {
      spatial: {
        waterVolumes: [{
          id: 'main',
          targetPartId: 'basin',
          surfacePartId: 'water-surface',
          shape: 'box',
          center: { x: 0, z: 0 },
          size: { x: 8, z: 6 },
          bottomY: 0,
          depth,
          enabled: true,
        }],
      },
    },
  }
  return root
}

describe('waterVolumeRuntime', () => {
  it('samples immersion from the volume bottom and adjustable water depth', () => {
    const model = createWaterModel(0.6)
    const volumes = collectModelWaterVolumes(THREE, model, 'sandbox_water')
    model.userData.proceduralModelParameterValues = { waterDepth: 1.2 }
    const updatedVolumes = collectModelWaterVolumes(THREE, model, 'sandbox_water')
    const state = samplePlayerWaterState(THREE, updatedVolumes, { x: 0, y: 1.7, z: 0 }, 1.7)
    expect(model.getObjectByName('water-surface').position.y).toBeCloseTo(1.2)

    expect(state).toMatchObject({
      volumeId: 'main',
      modelId: 'sandbox_water',
      bottomHeight: 0,
      surfaceHeight: 1.2,
      depth: 1.2,
      immersionDepth: 1.2,
      depthRatio: 1,
    })
  })

  it('caps character immersion at avatar height when the water is deeper than the character', () => {
    const volumes = collectModelWaterVolumes(THREE, createWaterModel(3), 'sandbox_water')
    const state = samplePlayerWaterState(THREE, volumes, { x: 0, y: 1.7, z: 0 }, 1.7)

    expect(state).toMatchObject({
      depth: 3,
      immersionDepth: 1.7,
      depthRatio: 1.7 / 3,
      characterImmersionRatio: 1,
    })
  })

  it('returns no immersion outside the water footprint or above its surface', () => {
    const volumes = collectModelWaterVolumes(THREE, createWaterModel(0.8), 'sandbox_water')
    expect(samplePlayerWaterState(THREE, volumes, { x: 5, y: 1.7, z: 0 }, 1.7)).toBeNull()
    expect(samplePlayerWaterState(THREE, volumes, { x: 0, y: 2.7, z: 0 }, 1.7)).toBeNull()
  })

  it('ignores invalid, duplicate and missing-target declarations', () => {
    const model = createWaterModel(0.8)
    model.userData.proceduralModelCapabilityManifest.capabilities.spatial.waterVolumes.push(
      { id: 'missing', targetPartId: 'missing', shape: 'box', size: { x: 2, z: 2 }, bottomY: 0, depth: 1 },
      { id: 'bad', targetPartId: 'basin', shape: 'box', size: { x: 0, z: 2 }, bottomY: 0, depth: 1 },
    )
    expect(collectModelWaterVolumes(THREE, model, 'sandbox_water')).toHaveLength(1)
  })
})
