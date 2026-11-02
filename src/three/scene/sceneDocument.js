/**
 * 三维场景文档数据契约。
 *
 * 该模块只负责可持久化的业务数据，不依赖 Three.js。
 * 渲染层应根据 Scene Object 创建/更新 Object3D，不能反向把网格当作唯一数据源。
 */

export const SCENE_SCHEMA_VERSION = 1

export const SCENE_OBJECT_TYPES = Object.freeze([
  'building',
  'road',
  'terrain',
  'water',
  'vegetation',
  'facility',
])

export const BUILDING_TEMPLATES = Object.freeze([
  { id: 'academic-building', name: '教学楼', category: 'building', source: 'parametric', defaultSize: [18, 12], defaultFloors: 5, defaultFloorHeight: 3.6 },
  { id: 'dormitory', name: '宿舍楼', category: 'building', source: 'parametric', defaultSize: [14, 10], defaultFloors: 6, defaultFloorHeight: 3.2 },
  { id: 'canteen', name: '食堂', category: 'building', source: 'parametric', defaultSize: [20, 14], defaultFloors: 2, defaultFloorHeight: 4 },
  { id: 'library', name: '图书馆', category: 'building', source: 'parametric', defaultSize: [22, 16], defaultFloors: 4, defaultFloorHeight: 4 },
])

export const CAMPUS_ASSET_CATEGORIES = Object.freeze([
  { id: 'building', name: '建筑' },
  { id: 'road', name: '道路' },
  { id: 'terrain', name: '地面' },
  { id: 'water', name: '水体' },
  { id: 'vegetation', name: '植被' },
  { id: 'facility', name: '设施' },
])

export function createSceneDocument(options = {}) {
  const now = options.createdAt || new Date().toISOString()
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: options.id || 'campus-scene',
    name: options.name || '未命名校园场景',
    campusId: options.campusId || null,
    coordinateSystem: 'campus-local',
    coordinateMapping: { groundPlane: 'XZ', verticalAxis: 'Y', unit: options.unit || 'scene-unit' },
    revision: 0,
    objects: [],
    layers: [
      { id: 'default', name: '默认图层', visible: true, locked: false },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

export function createSceneObject(type, options = {}) {
  if (!SCENE_OBJECT_TYPES.includes(type)) {
    throw new TypeError(`不支持的场景对象类型：${type}`)
  }

  const transform = options.transform || {}
  const object = {
    id: options.id || createObjectId(),
    type,
    name: options.name || defaultObjectName(type),
    templateId: options.templateId || null,
    layerId: options.layerId || 'default',
    transform: {
      position: vector3(transform.position, [0, 0, 0]),
      rotation: vector3(transform.rotation, [0, 0, 0]),
      scale: vector3(transform.scale, [1, 1, 1]),
    },
    properties: structuredClone(options.properties || {}),
    source: options.source || 'editor',
  }

  if (type === 'building') {
    object.properties = {
      floors: 3,
      floorHeight: 3.3,
      footprint: [16, 12],
      constructionMode: options.templateId ? 'template' : 'blocks',
      ...object.properties,
    }
  }

  return object
}

export function validateSceneDocument(document) {
  const errors = []
  if (!document || typeof document !== 'object') return ['场景文档必须是对象']
  if (document.schemaVersion !== SCENE_SCHEMA_VERSION) errors.push('不支持的场景文档版本')
  if (!Array.isArray(document.objects)) errors.push('objects 必须是数组')
  if (!Array.isArray(document.layers)) errors.push('layers 必须是数组')

  const ids = new Set()
  for (const object of Array.isArray(document.objects) ? document.objects : []) {
    if (!object || typeof object !== 'object') {
      errors.push('场景对象必须是对象')
      continue
    }
    if (!object.id || ids.has(object.id)) errors.push('场景对象 ID 缺失或重复')
    ids.add(object.id)
    if (!SCENE_OBJECT_TYPES.includes(object.type)) errors.push(`对象 ${object.id || '(unknown)'} 类型无效`)
    for (const key of ['position', 'rotation', 'scale']) {
      const vector = object.transform?.[key]
      if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) {
        errors.push(`对象 ${object.id || '(unknown)'} 的 transform.${key} 无效`)
      }
    }
  }
  return errors
}

function vector3(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return [...fallback]
  return [...value]
}

function defaultObjectName(type) {
  return ({
    building: '未命名建筑',
    road: '未命名道路',
    terrain: '未命名地面区域',
    water: '未命名水域',
    vegetation: '植被',
    facility: '校园设施',
  })[type]
}

function createObjectId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `scene-object-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
