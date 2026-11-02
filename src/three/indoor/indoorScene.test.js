import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { validateIndoorFloor, createIndoorFloor, getRoomInteractionPoints, createIndoorInteractionData } from './indoorScene.js'
import { CollisionWorld } from '../physics/CollisionWorld.js'
import { indoorBuildingDefinitions, validateIndoorBuilding } from './indoorBuildingDefinitions.js'


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
    expect(building.floors.map(floor => floor.level)).toEqual([1, 2])
    expect(building.floors.every(floor => floor.stairPoint)).toBe(true)
    for (const floor of building.floors) expect(validateIndoorFloor(floor)).toEqual([])
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
