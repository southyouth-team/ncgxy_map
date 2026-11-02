/**
 * RPG 俯视地图文档。
 *
 * Tile layer 用于地表/道路/水域的像素化表现；
 * buildings 等空间实体仍以 GIS Feature.geometry 为平面位置唯一事实来源，
 * 本文档只保存 featureId 和编辑器表现参数，不复制 footprint。
 */
export const RPG_MAP_SCHEMA_VERSION = 1

export const TILE_PALETTE = Object.freeze([
  { id: 'grass', label: '草地', color: '#6eaa55', category: 'ground' },
  { id: 'grass-dark', label: '深草地', color: '#4f8745', category: 'ground' },
  { id: 'dirt', label: '泥土', color: '#b58a55', category: 'ground' },
  { id: 'sand', label: '沙地', color: '#d7c17c', category: 'ground' },
  { id: 'stone', label: '石砖', color: '#a5a69a', category: 'ground' },
  { id: 'road', label: '道路', color: '#77796f', category: 'road' },
  { id: 'road-edge', label: '道路边缘', color: '#aaa58c', category: 'road' },
  { id: 'water', label: '水面', color: '#4c9db5', category: 'water' },
  { id: 'water-deep', label: '深水', color: '#367c9d', category: 'water' },
])

export const RPG_OBJECT_PALETTE = Object.freeze([
  { id: 'tree', label: '树木', width: 1, height: 1, glyph: '♣', color: '#285c3b' },
  { id: 'flower', label: '花坛', width: 1, height: 1, glyph: '✿', color: '#e8b75c' },
  { id: 'lamp', label: '路灯', width: 1, height: 1, glyph: '†', color: '#f2d98a' },
  { id: 'bridge', label: '桥梁', width: 3, height: 1, glyph: '▤', color: '#b98b55' },
])

export function createRpgMapDocument(options = {}) {
  const width = positiveInteger(options.width, 80)
  const height = positiveInteger(options.height, 60)
  const tileSize = positiveInteger(options.tileSize, 16)
  const ground = Array.from({ length: height }, () => Array(width).fill('grass'))
  return {
    schemaVersion: RPG_MAP_SCHEMA_VERSION,
    id: options.id || 'ncgxy-rpg-map',
    name: options.name || '南昌工学院 · 俯视地图',
    coordinateSystem: 'campus-local',
    grid: { width, height, tileSize, unit: 'editor-tile' },
    layers: [
      { id: 'ground', name: '地面', type: 'tile', visible: true, locked: false, tiles: ground },
      { id: 'roads', name: '道路与水域', type: 'tile', visible: true, locked: false, tiles: createEmptyGrid(width, height) },
    ],
    objects: [],
    metadata: { status: 'draft', source: 'rpg-map-editor' },
  }
}

export function validateRpgMapDocument(document) {
  const errors = []
  if (!document || typeof document !== 'object') return ['地图文档必须是对象']
  if (document.schemaVersion !== RPG_MAP_SCHEMA_VERSION) errors.push('不支持的 RPG 地图版本')
  const width = document.grid?.width
  const height = document.grid?.height
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) errors.push('地图网格尺寸无效')
  if (!Array.isArray(document.layers)) errors.push('layers 必须是数组')
  for (const layer of document.layers || []) {
    if (layer.type === 'tile' && (!Array.isArray(layer.tiles) || layer.tiles.length !== height || layer.tiles.some(row => !Array.isArray(row) || row.length !== width))) {
      errors.push(`图层 ${layer.id} 的瓦片网格尺寸不匹配`)
    }
  }
  for (const object of document.objects || []) {
    if (!Number.isFinite(object.x) || !Number.isFinite(object.y)) errors.push(`对象 ${object.id || '(unknown)'} 坐标无效`)
    if (object.kind === 'feature' && !object.featureId) errors.push('GIS 关联对象必须提供 featureId')
  }
  return errors
}

export function paintTile(document, layerId, x, y, tileId) {
  const layer = document.layers.find(item => item.id === layerId && item.type === 'tile')
  if (!layer || layer.locked) return false
  if (!Number.isInteger(x) || !Number.isInteger(y) || y < 0 || x < 0 || y >= document.grid.height || x >= document.grid.width) return false
  layer.tiles[y][x] = tileId
  return true
}

function createEmptyGrid(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null))
}
function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}
