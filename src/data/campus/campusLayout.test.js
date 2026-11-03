import { describe, expect, it } from 'vitest'
import {
  CAMPUS_AREAS,
  CAMPUS_BUILDING_FOOTPRINTS,
  CAMPUS_PLAN_REFERENCE,
  CAMPUS_PLAYER_SPAWN_PIXEL,
  CAMPUS_ROAD_CENTERLINES,
  CAMPUS_ROAD_WIDTHS,
  mapPixelToWorld,
  mapRectToWorld,
  mapPolylineToWorld,
  mapRoadToWorld,
  getCampusFootprintBounds,
  mapPolygonToWorld,
  pointInCampusArea,
  pointInCampusPolygon,
  circleIntersectsCampusPolygon,
} from './campusLayout.js'

describe('南昌工学院像素校园主空间底图', () => {
  it('使用 2026 校园平面图的图像坐标基准', () => {
    expect(CAMPUS_PLAN_REFERENCE.image).toMatchObject({ width: 1000, height: 500 })
    expect(CAMPUS_PLAN_REFERENCE).toMatchObject({
      publishedAt: '2026-08-28',
      sourcePageUrl: 'https://app.gaokaozhitongche.com/newsguide/h/Rg1KJO0N',
    })
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
    for (const field of CAMPUS_AREAS.filter(area => area.type === 'sports' && area.rect)) {
      const [left, top, right, bottom] = field.rect
      expect(spawnX > left && spawnX < right && spawnY > top && spawnY < bottom).toBe(false)
    }
  })

  it('建筑 footprint 包围盒兼容矩形与多边形数据', () => {
    expect(getCampusFootprintBounds({ rect: [10, 20, 40, 60] })).toEqual([10, 20, 40, 60])
    expect(getCampusFootprintBounds({ polygon: [[12, 8], [30, 10], [26, 35], [8, 24]] })).toEqual([8, 8, 30, 35])
    expect(getCampusFootprintBounds({ id: 'invalid' })).toBeNull()
  })

  it('建筑多边形可转换到世界空间且保留顶点顺序', () => {
    const polygon = [[153, 49], [200, 49], [190, 90], [153, 80]]
    const mapped = mapPolygonToWorld(polygon)
    expect(mapped).toHaveLength(4)
    expect(mapped[0]).toEqual(mapPixelToWorld(153, 49))
    expect(mapped[2]).toEqual(mapPixelToWorld(190, 90))
  })

  it('道路中心线和宽度可转换为统一的 Three.js 世界空间数据', () => {
    const road = CAMPUS_ROAD_CENTERLINES.find(item => item.id === 'north-perimeter-road')
    const worldRoad = mapRoadToWorld(road)
    expect(worldRoad.id).toBe(road.id)
    expect(worldRoad.points).toEqual(mapPolylineToWorld(road.points))
    expect(worldRoad.points).toHaveLength(road.points.length)
    expect(worldRoad.width).toBeCloseTo(15 * (CAMPUS_PLAN_REFERENCE.worldWidth / 691))
    expect(mapRoadToWorld({ id: 'unknown-road', points: [[153, 49], [844, 466]] }).width).toBeCloseTo(12 * (CAMPUS_PLAN_REFERENCE.worldWidth / 691))
    expect(mapRoadToWorld(null)).toBeNull()
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
  it('区域命中检测会排除中央湖区内部的岛屿洞区', () => {
    const centralLake = CAMPUS_AREAS.find(area => area.id === 'central-lake')
    const islandPoint = [540, 230]
    const waterPoint = [470, 220]
    expect(pointInCampusPolygon(islandPoint, centralLake.holes[0])).toBe(true)
    expect(pointInCampusArea(islandPoint, centralLake)).toBe(false)
    expect(pointInCampusArea(waterPoint, centralLake)).toBe(true)
  })

  it('检测角色圆形碰撞体与多边形边界的相交，而不只检测采样点是否在内部', () => {
    const footprint = [[10, 10], [30, 10], [30, 30], [10, 30]]
    expect(circleIntersectsCampusPolygon([8, 20], 2.1, footprint)).toBe(true)
    expect(circleIntersectsCampusPolygon([7, 20], 2.1, footprint)).toBe(false)
    expect(circleIntersectsCampusPolygon([20, 20], 1, footprint)).toBe(true)
    expect(circleIntersectsCampusPolygon([8, 20], -1, footprint)).toBe(false)
  })

})
