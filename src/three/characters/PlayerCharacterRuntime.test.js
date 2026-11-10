import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { PlayerCharacterRuntime } from './PlayerCharacterRuntime.js'

function createAnchor() {
  const anchor = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.3), new THREE.MeshBasicMaterial())
  body.name = 'avatar-body'
  anchor.add(body)
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5), new THREE.MeshBasicMaterial())
  marker.name = 'avatar-ground-marker'
  anchor.add(marker)
  anchor.userData.updateAnimation = vi.fn()
  return anchor
}

describe('PlayerCharacterRuntime', () => {
  it('keeps the movement anchor stable while replacing only its visual model', () => {
    const anchor = createAnchor()
    anchor.position.set(4, 0, 7)
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()))

    const info = runtime.setModel(model, [], { assetId: 'character-test' })

    expect(anchor.position.toArray()).toEqual([4, 0, 7])
    expect(info).toMatchObject({ assetId: 'character-test', hasExternalModel: true })
    const assetMeshes = []
    anchor.getObjectByName('player-character-asset').traverse(object => { if (object.isMesh) assetMeshes.push(object) })
    expect(assetMeshes.length).toBe(1)
    expect(assetMeshes[0].castShadow).toBe(true)
    expect(assetMeshes[0].receiveShadow).toBe(true)
    expect(anchor.getObjectByName('avatar-ground-marker')).toBeTruthy()
    expect(anchor.getObjectByName('player-character-asset')).toBeTruthy()
    expect(anchor.getObjectByName('avatar-body')).toBeTruthy()
    expect(runtime.fallbackVisual.visible).toBe(false)
  })

  it('reports normalized visual dimensions and derives a stable movement footprint', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.8), new THREE.MeshStandardMaterial()))

    const info = runtime.setModel(model, [], { assetId: 'dimensioned-character', targetHeight: 2.4 })

    expect(info.dimensions.height).toBeCloseTo(2.4)
    expect(info.dimensions.width).toBeCloseTo(1.2)
    expect(info.dimensions.depth).toBeCloseTo(0.96)
    expect(info.dimensions.eyeHeight).toBeCloseTo(1.824)
    expect(info.dimensions.colliderRadius).toBeCloseTo(0.336)
  })

  it('maps named clips to idle, walk and run states', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()))
    const clips = [
      new THREE.AnimationClip('Idle', 1, []),
      new THREE.AnimationClip('Walk Cycle', 1, []),
      new THREE.AnimationClip('Run', 1, []),
    ]

    const info = runtime.setModel(model, clips, { assetId: 'animated-character' })
    expect(info.animations).toEqual(['idle', 'walk', 'run'])
    expect(runtime.setAnimationState('run')).toBe(true)
    runtime.update(1 / 60)
    expect(runtime.getInfo().animationState).toBe('run')
  })

  it('restores the built-in placeholder and delegates its original animation callback', () => {
    const anchor = createAnchor()
    const updater = anchor.userData.updateAnimation
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    const model = new THREE.Group()
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial()))
    runtime.setModel(model)

    expect(runtime.restoreFallback()).toBe(true)
    anchor.userData.updateAnimation.call(anchor, true, 1, 0.2, 0.1)
    expect(updater).toHaveBeenCalled()
    expect(runtime.getInfo()).toMatchObject({ assetId: 'builtin-placeholder', hasExternalModel: false })
  })

  it('keeps walk intent active while blocked and forwards a low gait rate', () => {
    const anchor = createAnchor()
    const updater = anchor.userData.updateAnimation
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    anchor.userData.updateAnimation.call(anchor, true, 1, 0, 0, false, 0.42)
    expect(updater).toHaveBeenCalledWith(true, 1, 0, 0, 0.42)
    runtime.dispose()
  })

  it('rejects invalid or already-mounted models', () => {
    const anchor = createAnchor()
    const runtime = new PlayerCharacterRuntime(THREE, anchor)
    expect(() => runtime.setModel(new THREE.Group())).toThrow('有效的三维尺寸')
    const parent = new THREE.Group()
    const child = new THREE.Group()
    parent.add(child)
    expect(() => runtime.setModel(child)).toThrow('未挂载')
  })
})
