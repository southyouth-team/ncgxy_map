/**
 * 校园建筑室内场景数据契约。
 * 入口坐标、楼层数量和室内布局必须来自现场采集或可信平面资料。
 * 未采集的建筑保留空数组，不根据建筑外轮廓猜测入口和楼层。
 */
import { CAMPUS_BUILDING_FOOTPRINTS } from './campusLayout.js'

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
 * 查找角色附近已采集的建筑入口。
 * entrance.pixel 为校园底图像素坐标；只有显式标记 enabled 的入口参与交互。
 */
export function findNearestCampusEntrance(x, y, maxDistance = 18) {
  let nearest = null
  for (const building of CAMPUS_BUILDING_FOOTPRINTS) {
    const interior = getCampusInteriorData(building.id)
    for (const entrance of interior?.entrances || []) {
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
