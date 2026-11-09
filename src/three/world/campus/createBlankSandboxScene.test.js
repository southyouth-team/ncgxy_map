import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createBlankSandboxScene } from './createBlankSandboxScene.js'

describe('createBlankSandboxScene expandable world', () => {
  it('shows real ground chunk boundaries and selected fills only in management mode', () => {
    const world = createBlankSandboxScene(THREE)
    const fill = world.getObjectByName('sandbox-chunk-selection-fill-0:0')
    const outline = world.getObjectByName('sandbox-chunk-selection-outline-0:0')

    expect(fill).toBeTruthy()
    expect(outline).toBeTruthy()
    expect(fill.visible).toBe(false)
    expect(outline.visible).toBe(false)

    world.userData.setChunkManagementState(true, [{ x: 0, z: 0 }])
    expect(outline.visible).toBe(true)
    expect(fill.visible).toBe(true)

    world.userData.setChunkManagementState(false, [])
    expect(outline.visible).toBe(false)
    expect(fill.visible).toBe(false)
  })

  it('updates in-scene selection overlays when chunks are added and reclaimed', () => {
    const world = createBlankSandboxScene(THREE)
    world.userData.expandWorld('east')
    world.userData.setChunkManagementState(true, [{ x: 1, z: 0 }])

    const addedFill = world.getObjectByName('sandbox-chunk-selection-fill-1:0')
    expect(addedFill?.visible).toBe(true)

    expect(world.userData.removeWorldChunk(1, 0)).toBe(true)
    expect(world.getObjectByName('sandbox-chunk-selection-fill-1:0')).toBeUndefined()
  })

  it('expands complete adjacent rows and columns in all four directions', () => {
    const world = createBlankSandboxScene(THREE)
    const expand = world.userData.expandWorld

    expect(expand('north')).toBe(true)
    expect(expand('east')).toBe(true)
    expect(expand('south')).toBe(true)
    expect(expand('west')).toBe(true)

    const state = world.userData.getWorldState()
    expect(state.chunks).toHaveLength(9)
    expect(state.bounds).toEqual({ minX: -81, maxX: 81, minZ: -63, maxZ: 63 })
    expect(world.userData.sampleBounds).toMatchObject({
      width: 162, depth: 126, centerX: 0, centerZ: 0,
    })
    expect(new Set(state.chunks.map(({ x, z }) => x + ':' + z)).size).toBe(9)
  })

  it('adds full edge layers when expanding multiple times in one direction', () => {
    const world = createBlankSandboxScene(THREE)
    world.userData.expandWorld('east', 3)
    world.userData.expandWorld('north', 2)

    const state = world.userData.getWorldState()
    expect(state.chunks).toHaveLength(12)
    expect(state.bounds).toEqual({ minX: -27, maxX: 189, minZ: -105, maxZ: 63 })
  })

  it('persists and restores the same chunk grid and world bounds', () => {
    const source = createBlankSandboxScene(THREE)
    source.userData.expandWorld('west', 2)
    source.userData.expandWorld('south', 3)
    const snapshot = source.userData.getWorldState()

    const restored = createBlankSandboxScene(THREE)
    expect(restored.userData.restoreWorldState(snapshot)).toBe(true)
    expect(restored.userData.getWorldState()).toEqual(snapshot)
  })

  it('rejects incompatible or duplicate saved chunks without changing the world', () => {
    const world = createBlankSandboxScene(THREE)
    const initial = world.userData.getWorldState()
    expect(world.userData.restoreWorldState({
      ...initial,
      chunkSize: { width: 99, depth: 99 },
    })).toBe(false)
    expect(world.userData.restoreWorldState({
      ...initial,
      chunks: [{ x: 0, z: 0 }, { x: 0, z: 0 }],
    })).toBe(false)
    expect(world.userData.getWorldState()).toEqual(initial)
  })


  it('reclaims one arbitrary interior chunk and keeps all other coordinates unchanged', () => {
    const world = createBlankSandboxScene(THREE)
    world.userData.expandWorld('east', 2)
    world.userData.expandWorld('south', 2)
    const before = world.userData.getWorldState().chunks

    expect(world.userData.removeWorldChunk(1, 1)).toBe(true)
    const after = world.userData.getWorldState()
    expect(after.chunks).toHaveLength(before.length - 1)
    expect(after.chunks).not.toContainEqual({ x: 1, z: 1 })
    expect(after.chunks).toContainEqual({ x: 0, z: 0 })
    expect(after.chunks.filter(item => item.x === 2 && item.z === 2)).toHaveLength(1)
    expect(world.userData.worldChunks).toEqual(after.chunks)
    expect(world.userData.removeWorldChunk(1, 1)).toBe(false)
  })

  it('protects the origin anchor and the final remaining chunk', () => {
    const world = createBlankSandboxScene(THREE)
    expect(world.userData.removeWorldChunk(0, 0)).toBe(false)
    expect(world.userData.removeWorldChunk(1, 0)).toBe(false)
    expect(world.userData.getWorldState().chunks).toEqual([{ x: 0, z: 0 }])
  })

  it('persists and restores a world containing an internal hole', () => {
    const source = createBlankSandboxScene(THREE)
    source.userData.expandWorld('east', 2)
    source.userData.expandWorld('south', 2)
    expect(source.userData.removeWorldChunk(1, 1)).toBe(true)
    const snapshot = source.userData.getWorldState()

    const restored = createBlankSandboxScene(THREE)
    expect(restored.userData.restoreWorldState(snapshot)).toBe(true)
    expect(restored.userData.getWorldState()).toEqual(snapshot)
    expect(restored.userData.removeWorldChunk(1, 1)).toBe(false)
  })

  it('expands around an existing hole without recreating or overwriting it', () => {
    const world = createBlankSandboxScene(THREE)
    world.userData.expandWorld('east', 2)
    world.userData.expandWorld('south', 2)
    expect(world.userData.removeWorldChunk(1, 1)).toBe(true)
    expect(world.userData.expandWorld('east')).toBe(true)
    expect(world.userData.getWorldState().chunks).not.toContainEqual({ x: 1, z: 1 })
    expect(world.userData.getWorldState().chunks).toContainEqual({ x: 3, z: 1 })
  })

  it('rejects an expansion beyond the chunk budget atomically', () => {
    const world = createBlankSandboxScene(THREE)
    world.userData.expandWorld('east', 20)
    world.userData.expandWorld('east', 20)
    world.userData.expandWorld('east', 9)
    world.userData.expandWorld('north', 20)
    world.userData.expandWorld('north', 20)
    world.userData.expandWorld('north', 9)
    const before = world.userData.getWorldState()

    expect(world.userData.expandWorld('east', 1)).toBe(false)
    expect(world.userData.getWorldState()).toEqual(before)
  })
})
