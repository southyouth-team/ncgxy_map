import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  clonePlacedSandboxModel,
  cloneSandboxMaterial,
  cloneSandboxObjectResources,
  disposeSandboxMaterial,
  disposeSandboxObjectResources,
} from './sandboxModelLifecycle.js'

describe('sandbox model material lifecycle', () => {
  it('clones each referenced texture once and preserves shared texture slots', () => {
    const clonedTexture = { isTexture: true, dispose: vi.fn() }
    const texture = { isTexture: true, clone: vi.fn(() => clonedTexture) }
    const source = {
      map: texture,
      alphaMap: texture,
      color: { isColor: true },
      clone() { return { ...this } },
    }

    const result = cloneSandboxMaterial(source)

    expect(result).not.toBe(source)
    expect(result.map).toBe(clonedTexture)
    expect(result.alphaMap).toBe(clonedTexture)
    expect(result.map).not.toBe(texture)
    expect(result.color).toBe(source.color)
    expect(texture.clone).toHaveBeenCalledTimes(1)
  })

  it('disposes all unique texture properties and the material once', () => {
    const disposeTexture = vi.fn()
    const texture = { isTexture: true, dispose: disposeTexture }
    const disposeMaterial = vi.fn()
    disposeSandboxMaterial({ map: texture, alphaMap: texture, customTexture: texture, dispose: disposeMaterial })
    expect(disposeTexture).toHaveBeenCalledTimes(1)
    expect(disposeMaterial).toHaveBeenCalledTimes(1)
  })

  it('handles materials without clone methods and null values', () => {
    const value = { isMaterial: true }
    expect(cloneSandboxMaterial(value)).toBe(value)
    expect(cloneSandboxMaterial(null)).toBeNull()
    expect(() => disposeSandboxMaterial(null)).not.toThrow()
  })
})

describe('sandbox model object lifecycle', () => {
  it('clones geometry, materials and textures while preserving serializable model metadata', () => {
    const texture = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ map: texture })
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'animated-mesh'
    mesh.userData.componentId = 'animated-part'
    const root = new THREE.Group()
    root.userData.proceduralModelSource = 'export function createModelAnimation() {}'
    root.userData.proceduralModelParameterValues = { amplitude: 0.4 }
    root.add(mesh)

    const preview = cloneSandboxObjectResources(root)
    const previewMesh = preview.getObjectByName('animated-mesh')

    expect(preview).not.toBe(root)
    expect(previewMesh).not.toBe(mesh)
    expect(previewMesh.geometry).not.toBe(geometry)
    expect(previewMesh.geometry.getAttribute('position')).not.toBe(geometry.getAttribute('position'))
    expect(previewMesh.material).not.toBe(material)
    expect(previewMesh.material.map).not.toBe(texture)
    expect(preview.userData.proceduralModelSource).toBe(root.userData.proceduralModelSource)
    expect(preview.userData.proceduralModelParameterValues).toEqual({ amplitude: 0.4 })
    expect(previewMesh.userData.componentId).toBe('animated-part')
    expect(() => structuredClone(preview.userData)).not.toThrow()
  })

  it('disposes only preview-owned resources and keeps shared source resources intact', () => {
    const texture = new THREE.Texture()
    const sourceMaterial = new THREE.MeshStandardMaterial({ map: texture })
    const sourceGeometry = new THREE.BoxGeometry(1, 1, 1)
    const source = new THREE.Mesh(sourceGeometry, sourceMaterial)
    const preview = cloneSandboxObjectResources(source)
    const disposeSourceGeometry = vi.spyOn(sourceGeometry, 'dispose')
    const disposeSourceMaterial = vi.spyOn(sourceMaterial, 'dispose')
    const disposeSourceTexture = vi.spyOn(texture, 'dispose')
    const previewGeometry = preview.geometry
    const previewMaterial = preview.material
    const previewTexture = previewMaterial.map
    const disposePreviewGeometry = vi.spyOn(previewGeometry, 'dispose')
    const disposePreviewMaterial = vi.spyOn(previewMaterial, 'dispose')
    const disposePreviewTexture = vi.spyOn(previewTexture, 'dispose')

    disposeSandboxObjectResources(preview)

    expect(disposePreviewGeometry).toHaveBeenCalledTimes(1)
    expect(disposePreviewMaterial).toHaveBeenCalledTimes(1)
    expect(disposePreviewTexture).toHaveBeenCalledTimes(1)
    expect(disposeSourceGeometry).not.toHaveBeenCalled()
    expect(disposeSourceMaterial).not.toHaveBeenCalled()
    expect(disposeSourceTexture).not.toHaveBeenCalled()
  })

  it('builds a placed duplicate from the clean baseline without animated poses or runtime-added nodes', () => {
    const source = new THREE.Group()
    source.userData.proceduralModelSource = 'export function createModelAnimation() {}'
    const target = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    target.name = 'animated-target'
    source.add(target)
    source.updateWorldMatrix(true, true)
    // The Runtime captures this snapshot before generated code runs.
    const baseline = source.toJSON()

    // Simulate controller activity after the snapshot: deformed pose and a runtime Points helper.
    target.rotation.y = 1.25
    const particles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial())
    particles.name = 'runtime-particles'
    source.add(particles)

    const copy = clonePlacedSandboxModel(source, baseline)

    expect(copy).not.toBe(source)
    expect(copy.getObjectByName('runtime-particles')).toBeUndefined()
    expect(copy.getObjectByName('animated-target').rotation.y).toBe(0)
    expect(copy.userData.proceduralModelSource).toBe(source.userData.proceduralModelSource)
    expect(source.getObjectByName('runtime-particles')).toBe(particles)
  })

  it('falls back to an independent live-graph clone when no serialized baseline exists', () => {
    const texture = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ map: texture })
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const source = new THREE.Mesh(geometry, material)
    source.name = 'static-model'

    const copy = clonePlacedSandboxModel(source, null)

    expect(copy).not.toBe(source)
    expect(copy.geometry).not.toBe(geometry)
    expect(copy.material).not.toBe(material)
    expect(copy.material.map).not.toBe(texture)
  })

  it('clones ShaderMaterial uniform textures as preview-owned resources and disposes only the clone', () => {
    const sourceTexture = new THREE.Texture()
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: sourceTexture }, uScale: { value: 2 } },
      vertexShader: 'void main() { gl_Position = vec4(0.0); }',
      fragmentShader: 'uniform sampler2D uMap; void main() { gl_FragColor = texture2D(uMap, vec2(0.0)); }',
    })

    const cloned = cloneSandboxMaterial(material)

    expect(cloned.uniforms.uMap.value).not.toBe(sourceTexture)
    expect(cloned.uniforms.uMap.value.isTexture).toBe(true)
    expect(cloned.uniforms.uScale.value).toBe(2)
    const clonedTexture = cloned.uniforms.uMap.value
    const disposeClonedTexture = vi.spyOn(clonedTexture, 'dispose')
    const disposeSourceTexture = vi.spyOn(sourceTexture, 'dispose')

    disposeSandboxMaterial(cloned)

    expect(disposeClonedTexture).toHaveBeenCalledTimes(1)
    expect(disposeSourceTexture).not.toHaveBeenCalled()
  })
})
