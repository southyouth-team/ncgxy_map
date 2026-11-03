import { describe, expect, it, vi } from 'vitest'
import { CAMPUS_BUILDING_ASSET_CATALOG, CAMPUS_BUILDING_TEMPLATES, drawPixelBuildingPreview } from './campusAssetLibrary.js'

describe('shared campus building assets', () => {
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
