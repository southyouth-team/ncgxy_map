import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createBlankSandboxScene } from './createBlankSandboxScene.js'

describe('createBlankSandboxScene expandable world', () => {
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

  it('rejects incompatible or incomplete saved grids without changing the world', () => {
    const world = createBlankSandboxScene(THREE)
    const initial = world.userData.getWorldState()
    expect(world.userData.restoreWorldState({
      ...initial,
      chunkSize: { width: 99, depth: 99 },
    })).toBe(false)
    expect(world.userData.restoreWorldState({
      ...initial,
      chunks: [{ x: 0, z: 0 }, { x: 2, z: 0 }],
    })).toBe(false)
    expect(world.userData.getWorldState()).toEqual(initial)
  })


  it('reclaims complete outer rows and columns without creating holes', () => {
    const world = createBlankSandboxScene(THREE)
    for (const direction of ['north', 'east', 'south', 'west']) {
      expect(world.userData.expandWorld(direction)).toBe(true)
    }

    expect(world.userData.removeWorldEdge('north')).toBe(true)
    expect(world.userData.removeWorldEdge('west')).toBe(true)
    expect(world.userData.removeWorldEdge('south')).toBe(true)
    expect(world.userData.removeWorldEdge('east')).toBe(true)

    const state = world.userData.getWorldState()
    expect(state.chunks).toHaveLength(1)
    expect(state.chunks).toContainEqual({ x: 0, z: 0 })
    expect(state.bounds).toEqual({ minX: -27, maxX: 27, minZ: -21, maxZ: 21 })
    expect(world.userData.sampleBounds).toMatchObject({ width: 54, depth: 42, centerX: 0, centerZ: 0 })
  })

  it('rejects reclaiming the origin anchor or reducing either dimension below one chunk', () => {
    const world = createBlankSandboxScene(THREE)
    expect(world.userData.removeWorldEdge('north')).toBe(false)
    expect(world.userData.removeWorldEdge('west')).toBe(false)

    world.userData.expandWorld('north')
    world.userData.expandWorld('south')
    expect(world.userData.removeWorldEdge('north')).toBe(true)
    expect(world.userData.removeWorldEdge('south')).toBe(true)
    expect(world.userData.removeWorldEdge('north')).toBe(false)
    expect(world.userData.getWorldState().chunks).toHaveLength(1)
  })

  it('persists a reclaimed world and restores the same compacted bounds', () => {
    const source = createBlankSandboxScene(THREE)
    source.userData.expandWorld('east', 2)
    source.userData.expandWorld('south', 2)
    source.userData.removeWorldEdge('east')
    source.userData.removeWorldEdge('south')
    const snapshot = source.userData.getWorldState()

    const restored = createBlankSandboxScene(THREE)
    expect(restored.userData.restoreWorldState(snapshot)).toBe(true)
    expect(restored.userData.getWorldState()).toEqual(snapshot)
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
