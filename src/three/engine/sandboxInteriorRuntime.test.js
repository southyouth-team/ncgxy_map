import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { resolveSandboxInteriorEntryPoint } from './sandboxInteriorRuntime.js'

describe('resolveSandboxInteriorEntryPoint', () => {
  it('resolves a local floor point through nested part and model transforms', () => {
    const model = new THREE.Group()
    model.position.set(10, 2, -4)
    model.rotation.y = Math.PI / 2
    const marker = new THREE.Group()
    marker.position.set(1, 0, 2)
    marker.userData.componentId = 'interior-spawn'
    model.add(marker)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { interior: { entryPoints: [{ id: 'ground-floor', targetPartId: 'interior-spawn', position: { x: 0, y: 0, z: -1 } }] } },
    }
    const result = resolveSandboxInteriorEntryPoint(THREE, model, 'ground-floor')
    const expected = marker.localToWorld(new THREE.Vector3(0, 0, -1))
    expect(result.position.x).toBeCloseTo(expected.x)
    expect(result.position.y).toBeCloseTo(expected.y)
    expect(result.position.z).toBeCloseTo(expected.z)
  })

  it('fails closed when the manifest entry or stable target part is missing', () => {
    const model = new THREE.Group()
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { interior: { entryPoints: [{ id: 'inside', targetPartId: 'missing' }] } },
    }
    expect(resolveSandboxInteriorEntryPoint(THREE, model, 'inside')).toBeNull()
    expect(resolveSandboxInteriorEntryPoint(THREE, model, 'unknown')).toBeNull()
  })

  it('rejects non-finite local entry coordinates', () => {
    const model = new THREE.Group()
    const marker = new THREE.Group()
    marker.userData.componentId = 'spawn'
    model.add(marker)
    model.userData.proceduralModelCapabilityManifest = {
      capabilities: { interior: { entryPoints: [{ id: 'inside', targetPartId: 'spawn', position: { x: Number.NaN } }] } },
    }
    expect(resolveSandboxInteriorEntryPoint(THREE, model, 'inside')).toBeNull()
  })
})
