import { describe, expect, it, vi } from 'vitest'
import { cloneSandboxMaterial } from './sandboxModelLifecycle.js'

describe('cloneSandboxMaterial', () => {
  it('clones texture properties instead of sharing source texture references', () => {
    const texture = { isTexture: true, clone: vi.fn(() => ({ isTexture: true, source: 'copy' })) }
    const source = {
      map: texture,
      alphaMap: texture,
      color: { isColor: true },
      clone() { return { ...this } },
    }

    const result = cloneSandboxMaterial(source)

    expect(result).not.toBe(source)
    expect(result.map).not.toBe(texture)
    expect(result.alphaMap).not.toBe(texture)
    expect(result.map).not.toBe(result.alphaMap)
    expect(result.color).toBe(source.color)
    expect(texture.clone).toHaveBeenCalledTimes(2)
  })

  it('returns materials without a clone method unchanged', () => {
    const value = { isMaterial: true }
    expect(cloneSandboxMaterial(value)).toBe(value)
    expect(cloneSandboxMaterial(null)).toBeNull()
  })
})
