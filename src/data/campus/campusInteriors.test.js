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


describe('campus interior spatial validation', () => {
  const buildingId = Object.keys(CAMPUS_BUILDING_INTERIORS)[0]
  const validInterior = () => ({
    buildingId,
    status: 'ready',
    sceneId: 'interior-scene-02',
    entrances: [{ id: 'main-gate', pixel: [200, 200], floorId: 'floor-1', enabled: true }],
    floors: [{ id: 'floor-1', level: 1, width: 20, depth: 16, wallHeight: 3.2, rooms: [], spawnPoint: { x: 0, y: 1.7, z: 5 } }],
  })

  it('rejects a ready entrance without a floor reference', () => {
    const interior = validInterior()
    delete interior.entrances[0].floorId
    const result = validateCampusInteriorData(interior)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('ready 状态的 entrances[0] 必须引用有效楼层')
  })

  it('rejects entrance pixels outside the campus map', () => {
    const interior = validInterior()
    interior.entrances[0].pixel = [1001, 200]
    const result = validateCampusInteriorData(interior)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('entrances[0].pixel 必须是校园地图范围内的 [x, y] 坐标')
  })

  it('rejects spawn points outside the interior floor bounds', () => {
    const interior = validInterior()
    interior.floors[0].spawnPoint.x = 11
    const result = validateCampusInteriorData(interior)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('floors[0].spawnPoint 必须位于楼层范围内且高度有效')
  })
})
