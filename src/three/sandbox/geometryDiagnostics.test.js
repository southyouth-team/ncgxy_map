import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectProceduralModelGeometryDiagnostics } from './geometryDiagnostics.js'

describe('collectProceduralModelGeometryDiagnostics', () => {
  it('collects local and world bounds for ordinary meshes and keeps intentional overlaps informational', () => {
    const root = new THREE.Group()
    const first = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    first.userData.componentId = 'part-a'
    const second = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    second.userData.componentId = 'part-b'
    second.position.x = 0.5
    root.add(first, second)

    const result = collectProceduralModelGeometryDiagnostics(THREE, root)
    expect(result.summary).toMatchObject({ meshCount: 2, vertexCount: 48, diagnosticCount: 0 })
    expect(result.meshes[0].componentId).toBe('part-a')
    expect(result.meshes[1].worldBounds.min.x).toBeCloseTo(0)
    expect(result.diagnostics).toEqual([])
  })

  it('reports empty geometry and degenerate point geometry without treating a planar surface as invalid', () => {
    const root = new THREE.Group()
    const empty = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    empty.userData.componentId = 'empty'
    const pointGeometry = new THREE.BufferGeometry()
    pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute([1, 1, 1], 3))
    const point = new THREE.Mesh(pointGeometry, new THREE.MeshBasicMaterial())
    point.userData.componentId = 'point'
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial())
    plane.userData.componentId = 'plane'
    root.add(empty, point, plane)

    const result = collectProceduralModelGeometryDiagnostics(THREE, root)
    expect(result.diagnostics.map(item => item.code)).toEqual(['missing-position-attribute', 'degenerate-geometry-bounds'])
    expect(result.meshes[2].worldBounds).not.toBeNull()
  })

  it('reports non-finite vertices and world transforms without throwing', () => {
    const root = new THREE.Group()
    const invalidGeometry = new THREE.BufferGeometry()
    invalidGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, NaN, 1, 1, 1, 0, 0], 3))
    const invalidVertex = new THREE.Mesh(invalidGeometry, new THREE.MeshBasicMaterial())
    invalidVertex.userData.componentId = 'invalid-vertex'
    const invalidTransform = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    invalidTransform.userData.componentId = 'invalid-transform'
    invalidTransform.position.x = Infinity
    root.add(invalidVertex, invalidTransform)

    const result = collectProceduralModelGeometryDiagnostics(THREE, root)
    expect(result.diagnostics.map(item => item.code)).toContain('non-finite-vertex')
    expect(result.diagnostics.map(item => item.code)).toContain('non-finite-transform')
  })

  it('preserves diagnostics across arbitrary component IDs and does not depend on object names', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    mesh.name = 'chimney-or-anything'
    mesh.userData.componentId = 'stable-id-001'
    root.add(mesh)

    const result = collectProceduralModelGeometryDiagnostics(THREE, root)
    expect(result.meshes[0].componentId).toBe('stable-id-001')
    expect(result.diagnostics).toEqual([])
  })
})
