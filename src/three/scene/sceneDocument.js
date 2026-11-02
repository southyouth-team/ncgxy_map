/**
 * 三维场景文档数据契约。
 *
 * GIS Feature 是平面空间位置/轮廓的唯一事实来源。
 * Scene Object 只引用 Feature，并保存三维表现参数；不重复保存 X/Z 位置和 footprint。
 * 本模块不依赖 Three.js，便于服务端校验、版本迁移和单元测试。
 */
export const SCENE_SCHEMA_VERSION = 2

export const SCENE_OBJECT_TYPES = Object.freeze([
  'building', 'road', 'terrain', 'water', 'vegetation', 'facility',
])

export const BUILDING_TEMPLATES = Object.freeze([
  { id: 'academic-building', name: '教学楼', category: 'building', source: 'parametric', defaultFootprint: [18, 12], defaultFloors: 5, defaultFloorHeight: 3.6 },
  { id: 'dormitory', name: '宿舍楼', category: 'building', source: 'parametric', defaultFootprint: [14, 10], defaultFloors: 6, defaultFloorHeight: 3.2 },
  { id: 'canteen', name: '食堂', category: 'building', source: 'parametric', defaultFootprint: [20, 14], defaultFloors: 2, defaultFloorHeight: 4 },
  { id: 'library', name: '图书馆', category: 'building', source: 'parametric', defaultFootprint: [22, 16], defaultFloors: 4, defaultFloorHeight: 4 },
])

export const CAMPUS_ASSET_CATEGORIES = Object.freeze([
  { id: 'building', name: '建筑' }, { id: 'road', name: '道路' },
  { id: 'terrain', name: '地面' }, { id: 'water', name: '水体' },
  { id: 'vegetation', name: '植被' }, { id: 'facility', name: '设施' },
])

export function createSceneDocument(options = {}) {
  const now = options.createdAt || new Date().toISOString()
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: options.id || 'campus-scene',
    name: options.name || '未命名校园场景',
    campusId: options.campusId || null,
    mapId: options.mapId || null,
    coordinateSystem: 'campus-local',
    coordinateMapping: { groundPlane: 'XZ', verticalAxis: 'Y', unit: options.unit || 'scene-unit' },
    revision: 0,
    objects: [],
    layers: [{ id: 'default', name: '默认图层', visible: true, locked: false }],
    createdAt: now,
    updatedAt: now,
  }
}

export function createSceneObject(type, options = {}) {
  if (!SCENE_OBJECT_TYPES.includes(type)) throw new TypeError(`不支持的场景对象类型：${type}`)
  const object = {
    id: options.id || createObjectId(),
    type,
    name: options.name || defaultObjectName(type),
    // null 只允许编辑器尚未保存的临时草稿；持久化前必须创建并关联 GIS Feature。
    featureId: options.featureId ?? null,
    templateId: options.templateId || null,
    assetId: options.assetId || null,
    layerId: options.layerId || 'default',
    elevation: Number.isFinite(options.elevation) ? options.elevation : 0,
    // 模型局部变换不能改变 GIS Feature 的平面位置和 footprint。
    modelTransform: {
      rotation: vector3(options.modelTransform?.rotation, [0, 0, 0]),
      scale: vector3(options.modelTransform?.scale, [1, 1, 1]),
    },
    render: structuredClone(options.render || {}),
    properties: structuredClone(options.properties || {}),
    source: options.source || 'editor',
  }
  if (type === 'building') {
    object.properties = {
      floors: 3, floorHeight: 3.3,
      constructionMode: options.templateId ? 'template' : 'blocks',
      ...object.properties,
    }
  }
  return object
}

export function validateSceneDocument(document, options = {}) {
  const errors = []
  if (!document || typeof document !== 'object') return ['场景文档必须是对象']
  if (document.schemaVersion !== SCENE_SCHEMA_VERSION) errors.push('不支持的场景文档版本')
  if (!document.mapId) errors.push('场景文档必须关联 mapId')
  if (!Array.isArray(document.objects)) errors.push('objects 必须是数组')
  if (!Array.isArray(document.layers)) errors.push('layers 必须是数组')

  const ids = new Set()
  const featureIds = new Set()
  for (const object of Array.isArray(document.objects) ? document.objects : []) {
    if (!object || typeof object !== 'object') {
      errors.push('场景对象必须是对象')
      continue
    }
    if (!object.id || ids.has(object.id)) errors.push('场景对象 ID 缺失或重复')
    ids.add(object.id)
    if (!SCENE_OBJECT_TYPES.includes(object.type)) errors.push(`对象 ${object.id || '(unknown)'} 类型无效`)
    if (object.featureId === null || object.featureId === undefined || object.featureId === '') {
      if (options.allowDrafts !== true) errors.push(`对象 ${object.id || '(unknown)'} 尚未关联 GIS Feature`)
    } else {
      const key = String(object.featureId)
      if (featureIds.has(key)) errors.push(`GIS Feature ${key} 被多个主场景对象重复关联`)
      featureIds.add(key)
    }
    if (!Number.isFinite(object.elevation)) errors.push(`对象 ${object.id || '(unknown)'} 的 elevation 无效`)
    for (const key of ['rotation', 'scale']) {
      const vector = object.modelTransform?.[key]
      if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) {
        errors.push(`对象 ${object.id || '(unknown)'} 的 modelTransform.${key} 无效`)
      }
    }
  }
  return errors
}

function vector3(value, fallback) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? [...value] : [...fallback]
}
function defaultObjectName(type) {
  return ({ building: '未命名建筑', road: '未命名道路', terrain: '未命名地面区域', water: '未命名水域', vegetation: '植被', facility: '校园设施' })[type]
}
function createObjectId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `scene-object-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
