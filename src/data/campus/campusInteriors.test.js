import { describe, expect, it } from 'vitest'
import {
  CAMPUS_BUILDING_INTERIORS,
  findNearestCampusEntrance,
  getCampusInteriorData,
  validateCampusInteriorData,
} from './campusInteriors.js'

describe('campus interior data contract', () => {
  it('keeps uncollected buildings unavailable for entrance interaction', () => {
    const buildingId = Object.keys(CAMPUS_BUILDING_INTERIORS)[0]
    expect(getCampusInteriorData(buildingId).status).toBe('unmapped')
    expect(findNearestCampusEntrance(420, 315)).toBeNull()
  })

  it('rejects ready interiors without a scene, floor and enabled entrance', () => {
    const result = validateCampusInteriorData({
      buildingId: Object.keys(CAMPUS_BUILDING_INTERIORS)[0],
      status: 'ready',
      sceneId: null,
      entrances: [],
      floors: [],
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('ready 状态必须配置 sceneId')
    expect(result.errors).toContain('ready 状态至少需要一个楼层')
    expect(result.errors).toContain('ready 状态至少需要一个启用入口')
  })

  it('accepts a structurally complete, explicitly mapped interior', () => {
    const buildingId = Object.keys(CAMPUS_BUILDING_INTERIORS)[0]
    const result = validateCampusInteriorData({
      buildingId,
      status: 'ready',
      sceneId: 'interior-scene-01',
      entrances: [{ id: 'main-gate', label: '主入口', pixel: [200, 200], floorId: 'floor-1', enabled: true }],
      floors: [{
        id: 'floor-1',
        level: 1,
        width: 20,
        depth: 16,
        wallHeight: 3.2,
        rooms: [],
        spawnPoint: { x: 0, y: 1.7, z: 5 },
      }],
    })
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('rejects entrance references to unknown floors', () => {
    const buildingId = Object.keys(CAMPUS_BUILDING_INTERIORS)[0]
    const result = validateCampusInteriorData({
      buildingId,
      status: 'mapping',
      sceneId: null,
      entrances: [{ id: 'side-door', pixel: [210, 205], floorId: 'missing-floor', enabled: false }],
      floors: [],
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('entrances[0].floorId 未引用已定义楼层')
  })
})
