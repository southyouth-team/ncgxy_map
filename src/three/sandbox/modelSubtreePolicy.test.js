import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { assertSandboxModelSubtreeAssetOnly } from './modelSubtreePolicy.js'

describe('assertSandboxModelSubtreeAssetOnly', () => {
  it('accepts an asset-only subtree including functional point and spot lights', () => {
    const root = new THREE.Group()
    const lampPart = new THREE.Group()
    lampPart.userData.componentId = 'lamp-part'
    lampPart.add(new THREE.PointLight())
    lampPart.add(new THREE.SpotLight())
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
    root.add(lampPart)

    expect(() => assertSandboxModelSubtreeAssetOnly(root)).not.toThrow()
  })

  it.each([
    ['AmbientLight', () => new THREE.AmbientLight()],
    ['HemisphereLight', () => new THREE.HemisphereLight()],
    ['DirectionalLight', () => new THREE.DirectionalLight()],
    ['PerspectiveCamera', () => new THREE.PerspectiveCamera()],
    ['OrthographicCamera', () => new THREE.OrthographicCamera()],
    ['GridHelper', () => new THREE.GridHelper(10, 10)],
    ['AxesHelper', () => new THREE.AxesHelper(5)],
  ])('rejects a host-owned %s attached to the model', (typeName, factory) => {
    const root = new THREE.Group()
    const node = factory()
    node.name = 'forbidden-node'
    root.add(node)

    expect(() => assertSandboxModelSubtreeAssetOnly(root)).toThrow(new RegExp(typeName))
    expect(() => assertSandboxModelSubtreeAssetOnly(root)).toThrow(/forbidden-node/)
  })

  it('rejects forbidden environment nodes nested deep in the subtree', () => {
    const root = new THREE.Group()
    const inner = new THREE.Group()
    const sun = new THREE.DirectionalLight()
    sun.name = 'sun'
    inner.add(sun)
    root.add(inner)

    expect(() => assertSandboxModelSubtreeAssetOnly(root)).toThrow(/DirectionalLight/)
  })

  it('rejects a THREE.Scene used as the model root', () => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#87ceeb')
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))

    expect(() => assertSandboxModelSubtreeAssetOnly(scene)).toThrow(/Scene/)
  })

  it('reports every violation in one error with an actionable hint', () => {
    const root = new THREE.Group()
    root.add(new THREE.AmbientLight())
    root.add(new THREE.DirectionalLight())

    const assert = () => assertSandboxModelSubtreeAssetOnly(root)
    expect(assert).toThrow(/AmbientLight/)
    expect(assert).toThrow(/DirectionalLight/)
    expect(assert).toThrow(/PointLight/)
  })
})
