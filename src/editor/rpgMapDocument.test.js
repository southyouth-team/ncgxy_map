import { describe, expect, it } from 'vitest'
import {
  createRpgMapDocument,
  paintTile,
  validateRpgMapDocument,
} from './rpgMapDocument.js'

describe('RPG map document', () => {
  it('creates a dimensionally consistent map with independent tile layers', () => {
    const document = createRpgMapDocument({ width: 12, height: 8, tileSize: 16 })
    expect(document.grid).toEqual({ width: 12, height: 8, tileSize: 16, unit: 'editor-tile' })
    expect(document.layers[0].tiles).toHaveLength(8)
    expect(document.layers[0].tiles[0]).toHaveLength(12)
    expect(document.layers[1].tiles[0][0]).toBeNull()
    expect(validateRpgMapDocument(document)).toEqual([])
  })

  it('paints only valid cells on unlocked tile layers', () => {
    const document = createRpgMapDocument({ width: 4, height: 3 })
    expect(paintTile(document, 'roads', 2, 1, 'water')).toBe(true)
    expect(document.layers[1].tiles[1][2]).toBe('water')
    expect(paintTile(document, 'roads', 4, 1, 'water')).toBe(false)
    document.layers[1].locked = true
    expect(paintTile(document, 'roads', 1, 1, 'road')).toBe(false)
  })

  it('rejects malformed tile grids and unbound GIS feature objects', () => {
    const document = createRpgMapDocument({ width: 4, height: 3 })
    document.layers[0].tiles.pop()
    document.objects.push({ id: 'feature-1', kind: 'feature', x: 1, y: 1 })
    expect(validateRpgMapDocument(document)).toContain('图层 ground 的瓦片网格尺寸不匹配')
    expect(validateRpgMapDocument(document)).toContain('GIS 关联对象必须提供 featureId')
  })
})
