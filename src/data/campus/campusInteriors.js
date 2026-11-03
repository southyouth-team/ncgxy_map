/**
 * 校园建筑室内场景数据契约。
 * 入口坐标、楼层数量和室内布局必须来自现场采集或可信平面资料。
 * 未采集的建筑保留空数组，不根据建筑外轮廓猜测入口和楼层。
 */
import { CAMPUS_BUILDING_FOOTPRINTS } from './campusLayout.js'

const BUILDING_IDS = new Set(CAMPUS_BUILDING_FOOTPRINTS.map(building => building.id))
const INTERIOR_STATUSES = new Set(['unmapped', 'mapping', 'ready'])

export const CAMPUS_BUILDING_INTERIORS = Object.freeze(
  Object.fromEntries(CAMPUS_BUILDING_FOOTPRINTS.map(building => [
    building.id,
    Object.freeze({
      buildingId: building.id,
      status: 'unmapped',
      sceneId: null,
      entrances: Object.freeze([]),
      floors: Object.freeze([]),
    }),
  ])),
)

/** 获取建筑室内数据；未知建筑返回 null，避免静默创建错误场景。 */
export function getCampusInteriorData(buildingId) {
  return CAMPUS_BUILDING_INTERIORS[buildingId] || null
}

/**
 * 校验可采集室内数据，确保入口、楼层与引擎楼层定义之间的引用一致。
 * ready 状态必须同时具备场景 ID、有效楼层和至少一个启用入口。
 */
export function validateCampusInteriorData(interior) {
  const errors = []
  if (!interior || typeof interior !== 'object' || Array.isArray(interior)) {
    return { valid: false, errors: ['室内数据必须是对象'] }
  }

  if (!BUILDING_IDS.has(interior.buildingId)) errors.push('buildingId 不属于当前校园建筑')
  if (!INTERIOR_STATUSES.has(interior.status)) errors.push('status 必须是 unmapped/mapping/ready')
  if (interior.sceneId !== null && (typeof interior.sceneId !== 'string' || !interior.sceneId.trim())) {
    errors.push('sceneId 必须是非空字符串或 null')
  }
  if (!Array.isArray(interior.entrances)) errors.push('entrances 必须是数组')
  if (!Array.isArray(interior.floors)) errors.push('floors 必须是数组')

  const floors = Array.isArray(interior.floors) ? interior.floors : []
  const entrances = Array.isArray(interior.entrances) ? interior.entrances : []
  const floorIds = new Set()
  const floorLevels = new Set()

  floors.forEach((floor, index) => {
    const prefix = `floors[${index}]`
    if (!floor || typeof floor !== 'object') {
      errors.push(`${prefix} 必须是对象`)
      return
    }
    if (typeof floor.id !== 'string' || !floor.id.trim()) errors.push(`${prefix}.id 必须是非空字符串`)
    else if (floorIds.has(floor.id)) errors.push(`${prefix}.id 不能重复`)
    else floorIds.add(floor.id)
    if (!Number.isInteger(floor.level) || floor.level < 1) errors.push(`${prefix}.level 必须是正整数`)
    else if (floorLevels.has(floor.level)) errors.push(`${prefix}.level 不能重复`)
    else floorLevels.add(floor.level)
    if (!Number.isFinite(floor.width) || floor.width < 6) errors.push(`${prefix}.width 必须大于等于 6`)
    if (!Number.isFinite(floor.depth) || floor.depth < 6) errors.push(`${prefix}.depth 必须大于等于 6`)
    if (!Number.isFinite(floor.wallHeight) || floor.wallHeight < 2) errors.push(`${prefix}.wallHeight 必须大于等于 2`)
    if (!Array.isArray(floor.rooms)) errors.push(`${prefix}.rooms 必须是数组`)
    if (floor.spawnPoint !== undefined && (!floor.spawnPoint ||
      !Number.isFinite(floor.spawnPoint.x) || !Number.isFinite(floor.spawnPoint.y) || !Number.isFinite(floor.spawnPoint.z) ||
      Math.abs(floor.spawnPoint.x) > floor.width / 2 || Math.abs(floor.spawnPoint.z) > floor.depth / 2 ||
      floor.spawnPoint.y < 0.5 || floor.spawnPoint.y > floor.wallHeight)) {
      errors.push(`${prefix}.spawnPoint 必须位于楼层范围内且高度有效`)
    }
  })

  const entranceIds = new Set()
  entrances.forEach((entrance, index) => {
    const prefix = `entrances[${index}]`
    if (!entrance || typeof entrance !== 'object') {
      errors.push(`${prefix} 必须是对象`)
      return
    }
    if (typeof entrance.id !== 'string' || !entrance.id.trim()) errors.push(`${prefix}.id 必须是非空字符串`)
    else if (entranceIds.has(entrance.id)) errors.push(`${prefix}.id 不能重复`)
    else entranceIds.add(entrance.id)
    if (!Array.isArray(entrance.pixel) || entrance.pixel.length !== 2 || !entrance.pixel.every(Number.isFinite) ||
      entrance.pixel[0] < 0 || entrance.pixel[0] > 1000 || entrance.pixel[1] < 0 || entrance.pixel[1] > 500) {
      errors.push(`${prefix}.pixel 必须是校园地图范围内的 [x, y] 坐标`)
    }
    if (typeof entrance.enabled !== 'boolean') errors.push(`${prefix}.enabled 必须是布尔值`)
    if (entrance.floorId && !floorIds.has(entrance.floorId)) errors.push(`${prefix}.floorId 未引用已定义楼层`)
  })

  if (interior.status === 'ready') {
    if (typeof interior.sceneId !== 'string' || !interior.sceneId.trim()) errors.push('ready 状态必须配置 sceneId')
    if (!floors.length) errors.push('ready 状态至少需要一个楼层')
    if (!entrances.some(entrance => entrance?.enabled === true)) errors.push('ready 状态至少需要一个启用入口')
    entrances.forEach((entrance, index) => {
      if (entrance?.enabled === true && (!entrance.floorId || !floorIds.has(entrance.floorId))) {
        errors.push(`ready 状态的 entrances[${index}] 必须引用有效楼层`)
      }
    })
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 查找角色附近已采集的建筑入口。
 * 仅 ready 状态且显式 enabled 的入口参与交互，未采集数据不会触发进入提示。
 */
export function findNearestCampusEntrance(x, y, maxDistance = 18) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(maxDistance) || maxDistance < 0) return null
  let nearest = null
  for (const building of CAMPUS_BUILDING_FOOTPRINTS) {
    const interior = getCampusInteriorData(building.id)
    if (interior?.status !== 'ready') continue
    for (const entrance of interior.entrances || []) {
      if (entrance.enabled !== true || !Array.isArray(entrance.pixel) || entrance.pixel.length !== 2) continue
      const [entranceX, entranceY] = entrance.pixel
      if (!Number.isFinite(entranceX) || !Number.isFinite(entranceY)) continue
      const distance = Math.hypot(x - entranceX, y - entranceY)
      if (distance <= maxDistance && (!nearest || distance < nearest.distance)) {
        nearest = { building, entrance, interior, distance }
      }
    }
  }
  return nearest
}
