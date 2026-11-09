import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { analyzeModelTraversability } from './modelTraversabilityAnalyzer.js'

function createRoot() {
  const root = new THREE.Group()
  root.userData.proceduralModelCapabilityManifest = {
    capabilities: { spatial: { traversability: {
      stairs: [{ id: 'stair-a', targetPartId: 'stair-part' }],
      ramps: [{ id: 'ramp-a', targetPartId: 'ramp-part', slopeDegrees: 15 }],
      passages: [{ id: 'passage-a', targetPartId: 'door-frame' }],
      connections: [{ id: 'floor-link', from: 'floor-1', to: 'floor-2', type: 'stairs' }],
    } } },
  }
  return root
}

describe('analyzeModelTraversability', () => {
  it('binds declarations to real Mesh geometry and reports measured surface evidence', () => {
    const root = createRoot()
    const stair = new THREE.Group()
    stair.userData.componentId = 'stair-part'
    stair.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 1), new THREE.MeshBasicMaterial()))
    root.add(stair)
    const ramp = new THREE.Group()
    ramp.userData.componentId = 'ramp-part'
    const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 3), new THREE.MeshBasicMaterial())
    rampMesh.rotation.z = -Math.atan(0.25)
    ramp.add(rampMesh)
    root.add(ramp)
    const door = new THREE.Group()
    door.userData.componentId = 'door-frame'
    door.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2), new THREE.MeshBasicMaterial()))
    root.add(door)

    const result = analyzeModelTraversability(THREE, root)
    expect(result.status).toBe('needs-review')
    expect(result.certifiedWalkable).toBe(false)
    expect(result.records.find(item => item.id === 'stair-a')).toMatchObject({
      bound: true, status: 'geometry-bound', meshCount: 1,
    })
    expect(result.records.find(item => item.id === 'ramp-a').medianSlopeDegrees).toBeGreaterThan(0)
    expect(result.issues.map(issue => issue.code)).toContain('traversability.stairs.step-continuity-unverified')
    expect(result.issues.map(issue => issue.code)).toContain('traversability.passage.clearance-unverified')
  })

  it('extracts approximate stair levels, riser height and tread depth from stepped Mesh geometry', () => {
    const root = new THREE.Group()
    const stairs = new THREE.Group()
    stairs.userData.componentId = 'stair-part'
    for (let index = 0; index < 4; index += 1) {
      const tread = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.18, 1),
        new THREE.MeshBasicMaterial(),
      )
      tread.position.set(index * 0.45, index * 0.18, 0)
      stairs.add(tread)
    }
    root.add(stairs)
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { traversability: {
        stairs: [{ id: 'stair-run', targetPartId: 'stair-part', riserHeight: 0.18, treadDepth: 0.4 }],
      } } },
    }

    const result = analyzeModelTraversability(THREE, root)
    const record = result.records[0]
    expect(record.stairProfile.detectedLevelCount).toBe(4)
    expect(record.stairProfile.averageRiserHeight).toBeCloseTo(0.18, 2)
    expect(record.stairProfile.averageTreadDepth).toBeCloseTo(0.4, 2)
    expect(result.issues.map(issue => issue.code)).toContain('traversability.stairs.step-continuity-unverified')
  })

  it('rejects missing and duplicate component ids rather than guessing a target', () => {
    const root = createRoot()
    const duplicateA = new THREE.Group()
    duplicateA.userData.componentId = 'stair-part'
    duplicateA.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const duplicateB = duplicateA.clone()
    root.add(duplicateA, duplicateB)
    const result = analyzeModelTraversability(THREE, root)
    expect(result.records.find(item => item.id === 'stair-a')).toMatchObject({ bound: false, status: 'invalid' })
    expect(result.issues.map(issue => issue.code)).toContain('traversability.target-part.duplicate')
    expect(result.issues.map(issue => issue.code)).toContain('traversability.target-part.missing')
  })

  it('does not certify an empty manifest or deferred spatial connections as walkable', () => {
    const root = new THREE.Group()
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { traversability: { connections: [{ id: 'link', from: 'a', to: 'b' }] } } },
    }
    const result = analyzeModelTraversability(THREE, root)
    expect(result.certifiedWalkable).toBe(false)
    expect(result.records[0]).toMatchObject({ type: 'connections', status: 'deferred', bound: false })
  })
})
