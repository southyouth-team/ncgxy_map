import { describe, expect, it, vi } from 'vitest'
import { CAMPUS_BUILDING_ASSET_CATALOG, CAMPUS_BUILDING_TEMPLATES, drawPixelBuildingPreview, selectBuildingEntranceEdge, getBuildingFloorLayout } from './campusAssetLibrary.js'

describe('shared campus building assets', () => {
  it('calculates consistent floor heights, window levels and floor bands', () => {
    const layout = getBuildingFloorLayout(12, 4, 0.8)
    expect(layout.floors).toBe(4)
    expect(layout.floorHeight).toBe(3)
    layout.windowCenters.forEach((center, index) => expect(center).toBeCloseTo(1.68 + index * 3, 8))
    expect(layout.bandHeights).toEqual([3, 6, 9])
    expect(layout.windowHeight).toBeLessThanOrEqual(1.26)
  })
  it('rejects non-positive building height', () => {
    expect(() => getBuildingFloorLayout(0, 3)).toThrow('建筑总高度必须大于 0')
  })
  it('uses a configured entrance edge and falls back to the longest edge', () => {
    const edges = [{ index: 0, length: 4 }, { index: 1, length: 9 }, { index: 2, length: 6 }]
    expect(selectBuildingEntranceEdge(edges, 2)).toBe(edges[2])
    expect(selectBuildingEntranceEdge(edges, 99)).toBe(edges[1])
    expect(selectBuildingEntranceEdge(edges, null)).toBe(edges[1])
    expect(selectBuildingEntranceEdge([])).toBeNull()
  })
  it('exposes one editor asset for every 3D building template', () => {
    expect(CAMPUS_BUILDING_ASSET_CATALOG.map(item => item.template)).toEqual(Object.keys(CAMPUS_BUILDING_TEMPLATES))
    expect(CAMPUS_BUILDING_ASSET_CATALOG.every(item => item.id.startsWith('building-'))).toBe(true)
  })

  it('draws a pixel preview using the selected building template', () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    }
    Object.defineProperty(context, 'fillStyle', { set: vi.fn() })
    Object.defineProperty(context, 'strokeStyle', { set: vi.fn() })
    Object.defineProperty(context, 'lineWidth', { set: vi.fn() })

    drawPixelBuildingPreview(context, {
      x: 2, y: 3, width: 5, height: 4, tileSize: 16, template: '图书馆', selected: true,
    })

    expect(context.save).toHaveBeenCalledOnce()
    expect(context.fillRect).toHaveBeenCalled()
    expect(context.strokeRect).toHaveBeenCalledOnce()
    expect(context.restore).toHaveBeenCalledOnce()
  })

  it('rejects invalid canvas geometry', () => {
    expect(() => drawPixelBuildingPreview({}, { x: 0, y: 0, width: 0, height: 4, tileSize: 16 })).toThrow('建筑二维预览参数无效')
  })
})
