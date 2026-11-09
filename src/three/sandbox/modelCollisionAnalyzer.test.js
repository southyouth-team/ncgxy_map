import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { analyzeModelCollisionCompleteness } from './modelCollisionAnalyzer.js'

function makePart(id, collisionPolicy = 'required') {
  const part = new THREE.Group()
  part.userData.componentId = id
  if (collisionPolicy) part.userData.collisionPolicy = collisionPolicy
  part.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
  return part
}

describe('analyzeModelCollisionCompleteness', () => {
  it('reports complete when required parts bind to executable Box and Mesh colliders', () => {
    const root = new THREE.Group()
    const wall = makePart('wall')
    const rock = makePart('rock')
    const leaves = makePart('leaves', 'none')
    root.add(wall, rock, leaves)
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { colliders: [
        { id: 'wall-box', targetPartId: 'wall', shape: 'box', size: { x: 2, y: 3, z: 0.2 } },
        { id: 'rock-mesh', targetPartId: 'rock', shape: 'mesh' },
      ] } },
    }
    const result = analyzeModelCollisionCompleteness(root)
    expect(result.status).toBe('complete')
    expect(result.canRegisterDeclaredColliders).toBe(true)
    expect(result.summary.missingRequiredCount).toBe(0)
  })

  it('blocks readiness when a required solid part has no active collider', () => {
    const root = new THREE.Group()
    root.add(makePart('wall'))
    root.userData.proceduralModelCapabilityManifest = { capabilities: { spatial: { colliders: [] } } }
    const result = analyzeModelCollisionCompleteness(root)
    expect(result.status).toBe('invalid')
    expect(result.canRegisterDeclaredColliders).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'collision.required.missing',
      path: 'component:wall',
      severity: 'error',
    }))
  })

  it('rejects missing targets, duplicate component ids, unsupported shapes and invalid box dimensions', () => {
    const root = new THREE.Group()
    root.add(makePart('duplicate'), makePart('duplicate'), makePart('bad-box'))
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { colliders: [
        { id: 'missing', targetPartId: 'absent', shape: 'mesh' },
        { id: 'unknown', targetPartId: 'bad-box', shape: 'convex' },
        { id: 'bad-size', targetPartId: 'bad-box', shape: 'box', size: { x: 1, y: 0, z: 1 } },
        { id: 'bad-center', targetPartId: 'bad-box', shape: 'box', size: { x: 1, y: 1, z: 1 }, center: { x: 0, y: Number.NaN, z: 0 } },
      ] } },
    }
    const result = analyzeModelCollisionCompleteness(root)
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'collision.component-id.duplicate',
      'collision.target.ambiguous',
      'collision.target.missing',
      'collision.shape.unsupported',
      'collision.box.size.invalid',
      'collision.box.center.invalid',
    ]))
  })

  it('requires usable triangle geometry for Mesh colliders and validates state conditions', () => {
    const root = new THREE.Group()
    const empty = new THREE.Group()
    empty.userData.componentId = 'empty'
    const meshPart = makePart('mesh-part')
    root.add(empty, meshPart)
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { colliders: [
        { id: 'empty-mesh', targetPartId: 'empty', shape: 'mesh' },
        { id: 'bad-state', targetPartId: 'mesh-part', shape: 'mesh', stateCondition: { key: 'open', equals: 'yes' } },
      ] } },
    }
    const result = analyzeModelCollisionCompleteness(root)
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'collision.mesh.geometry.missing',
      'collision.state-condition.invalid',
    ]))
  })

  it('reports unclassified components for review and conflicting visual-only declarations', () => {
    const root = new THREE.Group()
    const unknown = makePart('unknown', null)
    const visual = makePart('visual', 'none')
    root.add(unknown, visual)
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { colliders: [
        { id: 'visual-collider', targetPartId: 'visual', shape: 'mesh' },
      ] } },
    }
    const result = analyzeModelCollisionCompleteness(root)
    expect(result.status).toBe('needs-review')
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'collision.policy.unclassified',
      'collision.policy.conflict',
    ]))
  })

  it('does not let an explicitly disabled declaration satisfy required collision intent', () => {
    const root = new THREE.Group()
    root.add(makePart('wall'))
    root.userData.proceduralModelCapabilityManifest = {
      capabilities: { spatial: { colliders: [
        { id: 'disabled-wall', targetPartId: 'wall', shape: 'mesh', enabled: false },
      ] } },
    }
    expect(analyzeModelCollisionCompleteness(root).issues).toContainEqual(expect.objectContaining({
      code: 'collision.required.missing',
      severity: 'error',
    }))
  })
})
