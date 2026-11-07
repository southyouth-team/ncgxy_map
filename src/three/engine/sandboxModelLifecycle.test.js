import { describe, expect, it, vi } from 'vitest'
import { cloneSandboxMaterial, disposeSandboxMaterial } from './sandboxModelLifecycle.js'

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
