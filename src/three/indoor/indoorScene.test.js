import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { validateIndoorFloor, createIndoorFloor, getRoomInteractionPoints, createIndoorInteractionData } from './indoorScene.js'
import { CollisionWorld } from '../physics/CollisionWorld.js'
import { indoorBuildingDefinitions, validateIndoorBuilding, createIndoorBuildingFromFootprint, expandIndoorBuilding } from './indoorBuildingDefinitions.js'


const sample = {
  level: 1, width: 24, depth: 18, wallHeight: 3.4,
  rooms: [{ id: 'classroom-101', name: '教室 101', x: -5, z: 0, width: 8, depth: 6, doorWall: 'south', doorWidth: 1.4 }],
  doors: [{ wall: 'south', offset: 0, width: 2 }],
}

describe('indoor interaction contract', () => {
  it('normalizes inspect and navigation interaction metadata', () => {
    expect(createIndoorInteractionData({ id: 'door-101', name: '教室入口', objectType: 'door', interactionType: 'navigate', action: 'enter-room', operationHint: '按 E 进入' })).toMatchObject({ id: 'door-101', interactionType: 'navigate', action: 'enter-room', operationHint: '按 E 进入' })
    expect(() => createIndoorInteractionData({ id: 'x', name: '对象', objectType: 'fixture', interactionType: 'teleport' })).toThrow('室内交互类型必须是 inspect/use/navigate')
  })
})

describe('indoor floor contract', () => {
  it('accepts a configured floor with rooms and an entrance opening', () => {
    expect(validateIndoorFloor(sample)).toEqual([])
  })

  it('rejects invalid floor dimensions', () => {
    expect(validateIndoorFloor({ ...sample, width: 2 })).toContain('楼层 width 必须大于等于 6')
  })

  it('rejects rooms without valid dimensions', () => {
    expect(validateIndoorFloor({ ...sample, rooms: [{ id: 'r1', name: '房间', x: 0, z: 0, width: 0, depth: 4 }] }))
      .toContain('房间 r1 的平面尺寸无效')
  })

  it('keeps configured exterior and room doorways passable in collision geometry', () => {
    const group = createIndoorFloor(THREE, sample)
    const collision = new CollisionWorld(
      { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
      group.userData.collisionObstacles,
      0.35,
    )
    const exit = collision.move({ x: 0, z: 5.2 }, 0, 5)
    expect(exit.z).toBeGreaterThan(8)
    expect(exit.blockedZ).toBe(false)
    const roomDoor = collision.move({ x: -5, z: 4.2 }, 0, -2.5)
    expect(roomDoor.z).toBeLessThan(2)
    expect(roomDoor.blockedZ).toBe(false)
  })

  it('validates custom partition walls and their door openings', () => {
    const floor = { ...sample, walls: [{ id: 'wall-a', axis: 'x', x: 0, z: 0, length: 10, thickness: 0.2, doorWidth: 1.4, doorOffset: 0 }] }
    expect(validateIndoorFloor(floor)).toEqual([])
    expect(validateIndoorFloor({ ...sample, walls: [{ id: 'wall-b', axis: 'x', x: 0, z: 10, length: 10, thickness: 0.2 }] }))
      .toContain('墙体 wall-b 超出楼层边界')
    expect(validateIndoorFloor({ ...sample, walls: [{ id: 'wall-c', axis: 'x', x: 0, z: 0, length: 10, doorWidth: 3, doorOffset: 4.5 }] }))
      .toContain('墙体 wall-c 的门洞尺寸无效')
  })

  it('builds polygon floor slabs and one exterior wall per footprint edge', () => {
    const polygonFloor = {
      ...sample,
      rooms: [],
      doors: [],
      footprintPolygon: [
        { x: -12, z: -9 }, { x: 12, z: -9 }, { x: 12, z: 5 },
        { x: 4, z: 9 }, { x: -12, z: 9 },
      ],
    }
    const group = createIndoorFloor(THREE, polygonFloor)
    const slab = group.children.find(child => child.name === 'indoor-floor-slab')
    const exteriorWalls = group.children.filter(child => child.name.startsWith('indoor-wall-outline-'))
    expect(slab).toBeTruthy()
    expect(slab.geometry.attributes.position.count).toBeGreaterThanOrEqual(5)
    expect(exteriorWalls).toHaveLength(5)
    expect(group.userData.collisionObstacles.length).toBeGreaterThanOrEqual(5)
  })

  it('builds partition geometry with a passable doorway opening', () => {
    const floor = { ...sample, rooms: [], walls: [{ id: 'partition-a', axis: 'x', x: 0, z: 0, length: 10, thickness: 0.2, doorWidth: 1.4, doorOffset: 0 }] }
    const group = createIndoorFloor(THREE, floor)
    const collision = new CollisionWorld({ minX: -12, maxX: 12, minZ: -9, maxZ: 9 }, group.userData.collisionObstacles, 0.25)
    const result = collision.move({ x: 0, z: -3 }, 0, 6)
    expect(result.z).toBeGreaterThan(2)
    expect(result.blockedZ).toBe(false)
  })

  it('rejects doors outside the floor wall and rooms outside floor bounds', () => {
    expect(validateIndoorFloor({ ...sample, doors: [{ wall: 'south', offset: 20, width: 2 }] }))
      .toContain('门洞 offset 超出墙体范围')
    expect(validateIndoorFloor({ ...sample, rooms: [{ id: 'r2', name: '越界房间', x: 10, z: 0, width: 8, depth: 4 }] }))
      .toContain('房间 r2 超出楼层边界')
  })

  it('rejects spawn and stair interaction points outside the floor bounds', () => {
    expect(validateIndoorFloor({ ...sample, spawnPoint: { x: 20, y: 1.7, z: 0 } })).toContain('spawnPoint 必须位于楼层范围内且高度有效')
    expect(validateIndoorFloor({ ...sample, stairPoint: { x: 20, z: 0 } })).toContain('stairPoint 必须位于楼层范围内并预留楼梯空间')
  })

  it('calculates room door approach and interior interaction points', () => {
    const points = getRoomInteractionPoints({ rooms: [
      { id: 'south', name: '南侧房间', x: 0, z: 0, width: 8, depth: 6, doorWall: 'south', doorWidth: 1.4, doorOffset: 0.5 },
      { id: 'west', name: '西侧房间', x: 10, z: 0, width: 6, depth: 8, doorWall: 'west', doorWidth: 1.2, doorOffset: -1 },
      { id: 'closed', name: '无门房间', x: 0, z: 10, width: 6, depth: 6 },
    ] })
    expect(points).toHaveLength(2)
    expect(points[0].approach).toEqual({ x: 0.5, z: 4.15 })
    expect(points[0].inside).toEqual({ x: 0.5, z: 1.85 })
    expect(points[1].approach).toEqual({ x: 5.85, z: -1 })
    expect(points[1].inside).toEqual({ x: 8.15, z: -1 })
  })

  it('renders room furniture and registers solid furniture as collision obstacles', () => {
    const furnished = { ...sample, rooms: [{ ...sample.rooms[0], furniture: [
      { id: 'desk-1', type: 'desk', x: 0, z: 0, width: 1.4, depth: 0.7, height: 0.75 },
      { id: 'board-1', type: 'board', x: 0, z: -2.5, width: 3, depth: 0.12, height: 1.1 },
    ] }] }
    const group = createIndoorFloor(THREE, furnished)
    const desk = group.children.find(child => child.name === 'indoor-furniture-classroom-101-desk-1')
    expect(desk).toBeTruthy()
    expect(desk.userData.interactionData).toMatchObject({ id: 'desk-1', objectType: 'desk', roomId: 'classroom-101', roomName: '教室 101' })
    expect(group.children.some(child => child.name === 'indoor-furniture-classroom-101-board-1')).toBe(true)
    expect(group.userData.collisionObstacles.some(item => item.minX === -5.7 && item.maxX === -4.3)).toBe(true)
    expect(validateIndoorFloor({ ...sample, rooms: [{ ...sample.rooms[0], furniture: [{ id: 'bad', type: 'desk', x: 5, z: 0, width: 2, depth: 1, height: 1 }] }] }))
      .toContain('房间 classroom-101 的家具超出房间范围')
  })

  it('requires integer floor levels', () => {
    expect(validateIndoorFloor({ ...sample, level: 1.5 })).toContain('楼层 level 必须是整数')
  })
})

describe('indoor building definition', () => {
  it('provides unique, ordered prototype floors with valid geometry', () => {
    const building = indoorBuildingDefinitions.teachingBlockPrototype
    expect(validateIndoorBuilding(building)).toEqual([])
    expect(building.floors.map(floor => floor.level)).toEqual([1, 2, 3, 4])
    expect(building.floors.every(floor => floor.stairPoint)).toBe(true)
    for (const floor of building.floors) expect(validateIndoorFloor(floor)).toEqual([])
  })

  it('rejects unsupported exterior roof styles and unsafe floor heights', () => {
    const building = indoorBuildingDefinitions.teachingBlockPrototype
    expect(validateIndoorBuilding({ ...building, exterior: { roofStyle: 'unknown' } }))
      .toContain('exterior.roofStyle 必须是 flat/glass/pitched/span')
    expect(validateIndoorBuilding({ ...building, floorHeight: 12 }))
      .toContain('floorHeight 必须在 2.5 至 10 之间')
  })

  it('rejects duplicate floor levels', () => {
    const building = indoorBuildingDefinitions.teachingBlockPrototype
    expect(validateIndoorBuilding({ ...building, floors: [building.floors[0], building.floors[0]] }))
      .toContain('楼层编号重复：1')
  })
})

describe('indoor stair construction', () => {
  it('creates a stair interaction point and visible stair steps', () => {
    const group = createIndoorFloor(THREE, { ...sample, stairPoint: { x: 10.5, z: 0 } })
    expect(group.userData.stairPoint).toEqual({ x: 10.5, z: 0 })
    expect(group.userData.roomInteractions).toHaveLength(1)
    expect(group.userData.exitInteractions).toEqual([{ x: 0, z: 7.85 }])
    expect(group.userData.roomInteractions[0].roomId).toBe('classroom-101')
    expect(group.userData.stairPath.start).toEqual({ x: 10.5, z: -2.1 })
    expect(group.userData.stairPath.end).toEqual({ x: 10.5, z: 2.1 })
    expect(group.userData.stairPath.rise).toBe(4.2)
    expect(group.children.filter(child => child.name === 'indoor-stair-step')).toHaveLength(12)
    expect(group.children.find(child => child.name === 'indoor-stair-step' && child.userData.interactionData)?.userData.interactionData).toMatchObject({ objectType: 'stairs', interactionType: 'navigate', action: 'change-floor' })
    expect(group.children.find(child => child.name === 'indoor-room-door-classroom-101')?.userData.interactionData).toMatchObject({ objectType: 'door', interactionType: 'navigate', action: 'enter-room' })
    expect(group.children.filter(child => child.name === 'indoor-stair-rail')).toHaveLength(2)
    const collision = new CollisionWorld({ minX: -12, maxX: 12, minZ: -12, maxZ: 12 }, group.userData.collisionObstacles, 0.48)
    const throughCenter = collision.move({ x: 10.5, z: -2.5 }, 0, 4.8)
    expect(throughCenter.z).toBeGreaterThan(2)
    expect(throughCenter.blockedZ).toBe(false)
    const intoRail = collision.move({ x: 8.8, z: 0 }, 1, 0)
    expect(intoRail.blockedX).toBe(true)
  })
})


describe('campus footprint indoor generation', () => {
  it('creates editable procedural floors from an approximate campus footprint', () => {
    const building = createIndoorBuildingFromFootprint({
      id: 'west-north-01',
      label: '西北组团 01',
      bounds: { minX: -6.5, maxX: 6.5, minZ: -1.5, maxZ: 1.5 },
    }, { floors: 3, floorHeight: 3.8 })
    expect(building.id).toBe('west-north-01')
    expect(building.floors.map(floor => floor.level)).toEqual([1, 2, 3])
    expect(building.layoutStatus).toBe('procedural-template')
    expect(building.exterior).toEqual({ roofStyle: 'flat' })
    expect(building.floorHeight).toBe(3.8)
    expect(building.interiorNormalized).toBe(true)
    expect(building.footprintSize).toEqual({ width: 13, depth: 3 })
    for (const floor of building.floors) expect(validateIndoorFloor(floor)).toEqual([])
    expect(validateIndoorBuilding(building)).toEqual([])
  })

  it('rejects invalid wall geometry inside a building document', () => {
    const building = { id: 'building-a', floorHeight: 3.6, floors: [{ ...sample, walls: [{ id: 'bad-wall', axis: 'x', x: 0, z: 20, length: 8 }] }] }
    expect(validateIndoorBuilding(building).some(error => error.includes('墙体 bad-wall 超出楼层边界'))).toBe(true)
  })

  it('creates and validates editable polygon building footprints', () => {
    const definition = createIndoorBuildingFromFootprint({
      id: 'polygon-campus-building',
      bounds: { minX: -8, maxX: 8, minZ: -6, maxZ: 6 },
    }, { floors: 2 })
    expect(definition.footprint.type).toBe('polygon')
    expect(definition.footprint.polygon).toHaveLength(4)
    expect(validateIndoorBuilding(definition)).toEqual([])

    const concave = JSON.parse(JSON.stringify(definition))
    concave.footprint.polygon = [
      { x: -8, z: -6 }, { x: 8, z: -6 }, { x: 1, z: 0 },
      { x: 8, z: 6 }, { x: -8, z: 6 },
    ]
    expect(validateIndoorBuilding(concave)).toEqual([])

    const selfIntersecting = JSON.parse(JSON.stringify(definition))
    selfIntersecting.footprint.polygon = [
      { x: -8, z: -6 }, { x: 8, z: 6 }, { x: -8, z: 6 }, { x: 8, z: -6 },
    ]
    expect(validateIndoorBuilding(selfIntersecting).join(' ')).toContain('自相交')
  })

  it('expands the shared footprint and all floors while preserving existing room world positions', () => {
    const original = createIndoorBuildingFromFootprint({
      id: 'expandable-building',
      label: '可扩建建筑',
      bounds: { minX: -6, maxX: 6, minZ: -5, maxZ: 5 },
    }, { floors: 2 })
    const originalRoom = original.floors[0].rooms[0]
    const expanded = expandIndoorBuilding(original, { side: 'east', amount: 4 })
    expect(expanded.footprintSize).toEqual({ width: 16, depth: 10 })
    expect(expanded.footprint.expansion.east).toBe(4)
    expect(expanded.floors.map(floor => floor.width)).toEqual([16, 16])
    expect(expanded.floors.every(floor => floor.depth === 10)).toBe(true)
    expect(expanded.floors[0].rooms[0].x).toBeCloseTo(originalRoom.x - 2)
    expect(expanded.footprint.bounds).toEqual({ minX: -8, maxX: 8, minZ: -5, maxZ: 5 })
    expect(Math.min(...expanded.footprint.polygon.map(point => point.x))).toBe(-8)
    expect(Math.max(...expanded.footprint.polygon.map(point => point.x))).toBe(8)
    expect(validateIndoorBuilding(expanded)).toEqual([])
    const balanced = expandIndoorBuilding(expanded, { side: 'west', amount: 4 })
    expect(balanced.footprintSize).toEqual({ width: 20, depth: 10 })
    expect(balanced.footprint.expansion).toMatchObject({ east: 4, west: 4 })
    expect(balanced.floors[0].rooms[0].x).toBeCloseTo(originalRoom.x)
    expect(original.footprintSize).toEqual({ width: 12, depth: 10 })
  })

  it('expands north/south/west with centered local bounds and rejects invalid expansion', () => {
    const original = createIndoorBuildingFromFootprint({
      id: 'direction-building',
      bounds: { minX: -5, maxX: 5, minZ: -4, maxZ: 4 },
    }, { floors: 1 })
    for (const side of ['north', 'south', 'west']) {
      const expanded = expandIndoorBuilding(original, { side, amount: 2 })
      expect(expanded.footprintSize.width).toBe(side === 'west' ? 12 : 10)
      expect(expanded.footprintSize.depth).toBe(side === 'north' || side === 'south' ? 10 : 8)
      expect(validateIndoorBuilding(expanded)).toEqual([])
    }
    expect(() => expandIndoorBuilding(original, { side: 'up', amount: 2 })).toThrow('扩建方向')
    expect(() => expandIndoorBuilding(original, { side: 'east', amount: 0 })).toThrow('扩建尺寸')
  })

  it('requires stair connection points to align across building floors', () => {
    const building = {
      id: 'linked-building', floorHeight: 3.6,
      floors: [
        { ...sample, level: 1, stairPoint: { x: 8, z: 0, direction: 'south' } },
        { ...sample, level: 2, stairPoint: { x: 8, z: 0, direction: 'south' } },
      ],
    }
    expect(validateIndoorBuilding(building)).toEqual([])
    const misaligned = { ...building, floors: [building.floors[0], { ...building.floors[1], stairPoint: { x: 4, z: 0 } }] }
    expect(validateIndoorBuilding(misaligned)).toContain('楼层 2 的楼梯连接点未与其他楼层对齐')
    const missing = { ...building, floors: [building.floors[0], { ...building.floors[1], stairPoint: undefined }] }
    expect(validateIndoorBuilding(missing)).toContain('多层建筑的每个楼层都必须配置楼梯连接点')
  })

  it('rejects invalid campus footprints', () => {
    expect(() => createIndoorBuildingFromFootprint({ id: 'bad', bounds: { minX: 2, maxX: 1, minZ: 0, maxZ: 2 } }))
      .toThrow('建筑轮廓尺寸无效')
  })
})
