import { describe, expect, it } from 'vitest'
import {
  CAMPUS_AREAS,
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_PLAN_REFERENCE,
  CAMPUS_PLAYER_SPAWN_PIXEL,
  CAMPUS_ROAD_CENTERLINES,
  mapPixelToWorld,
  mapRectToWorld,
} from './campusLayout.js'

describe('南昌工学院像素校园主空间底图', () => {
  it('使用 2026 校园平面图的图像坐标基准', () => {
    expect(CAMPUS_PLAN_REFERENCE.image).toMatchObject({ width: 1000, height: 500 })
    const center = mapPixelToWorld(
      (CAMPUS_PLAN_REFERENCE.mapBounds.left + CAMPUS_PLAN_REFERENCE.mapBounds.right) / 2,
      (CAMPUS_PLAN_REFERENCE.mapBounds.top + CAMPUS_PLAN_REFERENCE.mapBounds.bottom) / 2,
    )
    expect(center.x).toBeCloseTo(0)
    expect(center.z).toBeCloseTo(0)
    expect(CAMPUS_PLAN_REFERENCE.worldDepth).toBeGreaterThan(80)
    expect(CAMPUS_PLAN_REFERENCE.worldDepth).toBeLessThan(100)
  })

  it('包含全校主要组团的建筑轮廓，而不是少量样板楼', () => {
    expect(CAMPUS_BUILDING_FOOTPRINTS.length).toBeGreaterThanOrEqual(45)
    const ids = CAMPUS_BUILDING_FOOTPRINTS.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of CAMPUS_BUILDING_FOOTPRINTS) {
      const [left, top, right, bottom] = item.rect
      expect(right).toBeGreaterThan(left)
      expect(bottom).toBeGreaterThan(top)
      expect(left).toBeGreaterThanOrEqual(CAMPUS_PLAN_REFERENCE.mapBounds.left)
      expect(top).toBeGreaterThanOrEqual(CAMPUS_PLAN_REFERENCE.mapBounds.top)
      expect(right).toBeLessThanOrEqual(CAMPUS_PLAN_REFERENCE.mapBounds.right)
      expect(bottom).toBeLessThanOrEqual(CAMPUS_PLAN_REFERENCE.mapBounds.bottom)
      const world = mapRectToWorld(item.rect)
      expect(world.width).toBeGreaterThan(0)
      expect(world.depth).toBeGreaterThan(0)
    }
  })

  it('中央湖区保留可步行岛屿，并将出生点放在校园陆地区域', () => {
    const centralLake = CAMPUS_AREAS.find(area => area.id === 'central-lake')
    expect(centralLake?.holes).toHaveLength(1)
    expect(centralLake.holes[0].length).toBeGreaterThanOrEqual(3)
    const [spawnX, spawnY] = CAMPUS_PLAYER_SPAWN_PIXEL
    expect(spawnX).toBeGreaterThan(CAMPUS_PLAN_REFERENCE.mapBounds.left)
    expect(spawnX).toBeLessThan(CAMPUS_PLAN_REFERENCE.mapBounds.right)
    expect(spawnY).toBeGreaterThan(CAMPUS_PLAN_REFERENCE.mapBounds.top)
    expect(spawnY).toBeLessThan(CAMPUS_PLAN_REFERENCE.mapBounds.bottom)
    expect(centralLake.polygon.some(([x, y]) => Math.hypot(x - spawnX, y - spawnY) < 20)).toBe(false)
  })

  it('道路和水体控制点均位于校园底图范围内', () => {
    const { width, height } = CAMPUS_PLAN_REFERENCE.image
    for (const road of CAMPUS_ROAD_CENTERLINES) {
      expect(road.points.length).toBeGreaterThanOrEqual(2)
      for (const [x, y] of road.points) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(width)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(height)
      }
    }
    for (const area of CAMPUS_AREAS.filter(item => item.polygon)) {
      expect(area.polygon.length).toBeGreaterThanOrEqual(3)
      for (const [x, y] of area.polygon) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(width)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(height)
      }
    }
  })
})
