import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { validateIndoorFloor, createIndoorFloor, getRoomInteractionPoints, createIndoorInteractionData, getStairLandingPoint, getStairTraversalPoints, createStairPath, getStairStepHeight, buildIndoorNavigationGraph, planIndoorFloorRoute } from './indoorScene.js'
import { CollisionWorld } from '../physics/CollisionWorld.js'
import { indoorBuildingDefinitions, validateIndoorBuilding, createIndoorBuildingFromFootprint, expandIndoorBuilding, resolveIndoorEntrance } from './indoorBuildingDefinitions.js'


const sample = {
  level: 1, width: 24, depth: 18, wallHeight: 3.4,
  rooms: [{ id: 'classroom-101', name: '教室 101', x: -5, z: 0, width: 8, depth: 6, doorWall: 'south', doorWidth: 1.4 }],
  doors: [{ wall: 'south', offset: 0, width: 2 }],
}

describe('stair traversal endpoints', () => {
  const path = { start: { x: 4, z: -2 }, end: { x: 4, z: 2 } }

  it('enters from the lower landing when ascending and upper landing when descending', () => {
    expect(getStairTraversalPoints(path, 1)).toEqual({ entry: path.start, exit: path.end })
    expect(getStairTraversalPoints(path, -1)).toEqual({ entry: path.end, exit: path.start })
  })

  it('rejects invalid directions or incomplete stair paths', () => {
    expect(getStairTraversalPoints(path, 0)).toBeNull()
    expect(getStairTraversalPoints({ start: path.start }, 1)).toBeNull()
  })
})

describe('stair path geometry', () => {
  it('matches the four rendered stair orientations', () => {
    expect(createStairPath({ x: 3, z: 5, direction: 'south' })).toEqual({
      start: { x: 3, z: 2.9 }, end: { x: 3, z: 7.1 }, rise: 4.2, direction: 'south',
    })
    expect(createStairPath({ x: 3, z: 5, direction: 'north' })).toEqual({
      start: { x: 3, z: 7.1 }, end: { x: 3, z: 2.9 }, rise: 4.2, direction: 'north',
    })
    expect(createStairPath({ x: 3, z: 5, direction: 'east' })).toEqual({
      start: { x: 0.9, z: 5 }, end: { x: 5.1, z: 5 }, rise: 4.2, direction: 'east',
    })
    expect(createStairPath({ x: 3, z: 5, direction: 'west' })).toEqual({
      start: { x: 5.1, z: 5 }, end: { x: 0.9, z: 5 }, rise: 4.2, direction: 'west',
    })
  })

  it('uses the configured building floor height', () => {
    expect(createStairPath({ x: 3, z: 5, direction: 'south' }, 3.6)).toEqual({
      start: { x: 3, z: 2.9 }, end: { x: 3, z: 7.1 }, rise: 3.6, direction: 'south',
    })
    expect(createStairPath({ x: 3, z: 5 }, 0)).toBeNull()
  })

  it('rejects invalid stair configuration', () => {
    expect(createStairPath({ x: 1, z: 2, direction: 'diagonal' })).toBeNull()
    expect(createStairPath({ x: NaN, z: 2 })).toBeNull()
  })
})

describe('stair step elevation profile', () => {
  it('keeps the player on each tread and raises smoothly at each riser', () => {
    expect(getStairStepHeight(0, 4.2)).toBe(0)
    expect(getStairStepHeight(0.05, 4.2)).toBe(0)
    expect(getStairStepHeight(1 / 12, 4.2)).toBeCloseTo(0.35)
    expect(getStairStepHeight(0.5, 4.2)).toBeCloseTo(2.1)
    expect(getStairStepHeight(1, 4.2)).toBe(4.2)
    expect(getStairStepHeight(1.2, 4.2)).toBe(4.2)
  })

  it('is monotonic, supports variable floor heights and rejects invalid inputs', () => {
    const samples = Array.from({ length: 101 }, (_, index) => getStairStepHeight(index / 100, 3.6))
    expect(samples.every((height, index) => index === 0 || height >= samples[index - 1])).toBe(true)
    expect(samples[100]).toBeCloseTo(3.6)
    expect(getStairStepHeight(0.5, 3.6)).toBeCloseTo(1.8)
    expect(getStairStepHeight(Number.NaN, 4.2)).toBeNull()
    expect(getStairStepHeight(0.5, -1)).toBeNull()
  })
})

describe('stair mesh alignment', () => {
  it('aligns first and last risers and the upper landing to a 3.6-unit floor height', () => {
    const group = createIndoorFloor(THREE, { ...sample, rooms: [], stairPoint: { x: 8, z: 0, direction: 'south' } }, 3.6)
    const steps = group.children.filter(child => child.name === 'indoor-stair-step')
    const landings = group.children.filter(child => child.name === 'indoor-stair-landing')
    expect(steps).toHaveLength(12)
    expect(steps[0].position.y).toBeCloseTo(0.33)
    expect(steps[11].position.y + steps[11].geometry.parameters.height / 2).toBeCloseTo(3.78)
    expect(landings).toHaveLength(2)
    const upperLanding = landings.find(item => item.position.z > 0)
    expect(upperLanding.position.y + upperLanding.geometry.parameters.height / 2).toBeCloseTo(3.78)
  })
})

describe('multi-floor navigation planning', () => {
  const building = {
    floorHeight: 4.2,
    floors: [
      { level: 1, stairPoint: { x: 8, z: 0, direction: 'south' } },
      { level: 2, stairPoint: { x: 8, z: 0, direction: 'north' } },
      { level: 3, stairPoint: { x: 8, z: 0, direction: 'south' } },
      { level: 4, stairPoint: { x: 8, z: 0, direction: 'north' } },
    ],
  }

  it('plans every adjacent floor transition when ascending or descending', () => {
    expect(planIndoorFloorRoute(building, 1, 4)).toMatchObject({
      levels: [1, 2, 3, 4],
      transitions: [
        { fromLevel: 1, toLevel: 2, direction: 1, connector: { rise: 4.2, from: { level: 1, point: { x: 8, z: -2.1 } }, to: { level: 2, point: { x: 8, z: 2.1 } } } },
        { fromLevel: 2, toLevel: 3, direction: 1, connector: { from: { level: 2, point: { x: 8, z: 2.1 } }, to: { level: 3, point: { x: 8, z: -2.1 } } } },
        { fromLevel: 3, toLevel: 4, direction: 1, connector: { from: { level: 3, point: { x: 8, z: -2.1 } }, to: { level: 4, point: { x: 8, z: 2.1 } } } },
      ],
    })
    expect(planIndoorFloorRoute(building, 4, 1)?.transitions[0].connector).toEqual({
      from: { level: 4, point: { x: 8, z: -2.1 } },
      to: { level: 3, point: { x: 8, z: 2.1 } },
      rise: 4.2,
    })
    expect(planIndoorFloorRoute(building, 4, 1)?.levels).toEqual([4, 3, 2, 1])
    const ascending = planIndoorFloorRoute(building, 1, 4).transitions
    expect(ascending[0].connector.to.point).toEqual(ascending[1].connector.from.point)
    expect(ascending[1].connector.to.point).toEqual(ascending[2].connector.from.point)
    expect(planIndoorFloorRoute(building, 2, 2)).toEqual({ levels: [2], transitions: [] })
  })

  it('rejects unknown floors and misaligned stair connections', () => {
    expect(planIndoorFloorRoute(building, 0, 3)).toBeNull()
    expect(planIndoorFloorRoute({ floors: [building.floors[0], { ...building.floors[2], level: 3 }] }, 1, 3)).toBeNull()
    expect(planIndoorFloorRoute({ floors: [{ level: 1 }, { level: 2 }] }, 1, 2)).toBeNull()
    const misaligned = { floors: [building.floors[0], { level: 2, stairPoint: { x: 8.2, z: 0 } }] }
    expect(planIndoorFloorRoute(misaligned, 1, 2)).toBeNull()
  })
})

describe('indoor interaction contract', () => {
  it('normalizes inspect and navigation interaction metadata', () => {
    expect(createIndoorInteractionData({ id: 'door-101', name: '教室入口', objectType: 'door', interactionType: 'navigate', action: 'enter-room', operationHint: '按 E 进入' })).toMatchObject({ id: 'door-101', interactionType: 'navigate', action: 'enter-room', operationHint: '按 E 进入' })
    expect(() => createIndoorInteractionData({ id: 'x', name: '对象', objectType: 'fixture', interactionType: 'teleport' })).toThrow('室内交互类型必须是 inspect/use/navigate')
  })
})

describe('stair landing point', () => {
  it('uses the correct endpoint for ascending and descending on all stair orientations', () => {
    const cases = [
      { direction: 'south', start: { x: 2, z: -2 }, end: { x: 2, z: 2 } },
      { direction: 'west', start: { x: 4, z: 0 }, end: { x: 0, z: 0 } },
      { direction: 'north', start: { x: 2, z: 2 }, end: { x: 2, z: -2 } },
      { direction: 'east', start: { x: 0, z: 0 }, end: { x: 4, z: 0 } },
    ]
    for (const stairPath of cases) {
      expect(getStairLandingPoint(stairPath, 1)).toEqual(stairPath.end)
      expect(getStairLandingPoint(stairPath, -1)).toEqual(stairPath.start)
    }
    expect(getStairLandingPoint(null, 1)).toBeNull()
    expect(getStairLandingPoint(cases[0], 0)).toBeNull()
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

  it('registers both stair landings as reachable navigation landmarks', () => {
    const floor = { ...sample, rooms: [], stairPoint: { x: 8, z: 0, direction: 'south' } }
    const group = createIndoorFloor(THREE, floor)
    const graph = group.userData.navigationGraph
    const lower = graph.points.find(point => point.id === 'stairs:lower-landing')
    const upper = graph.points.find(point => point.id === 'stairs:upper-landing')
    expect(lower?.point).toEqual({ x: 8, z: -2.1 })
    expect(upper?.point).toEqual({ x: 8, z: 2.1 })
    expect(lower?.nodeId).not.toBeNull()
    expect(upper?.nodeId).not.toBeNull()
    expect(graph.findPath({ x: 0, z: 0 }, lower.point)).not.toBeNull()
    expect(graph.findPath({ x: 0, z: 0 }, upper.point)).not.toBeNull()
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

  it('rejects overlapping rooms and overlapping furniture footprints', () => {
    const overlappingRooms = { ...sample, rooms: [
      { id: 'room-a', name: 'A', x: 0, z: 0, width: 8, depth: 6 },
      { id: 'room-b', name: 'B', x: 2, z: 0, width: 8, depth: 6 },
    ] }
    expect(validateIndoorFloor(overlappingRooms).some(error => error.includes('room-a 与 room-b 存在重叠'))).toBe(true)
    const overlappingFurniture = { ...sample, rooms: [{ ...sample.rooms[0], furniture: [
      { id: 'desk-a', type: 'desk', x: 0, z: 0, width: 1, depth: 1, height: 0.8 },
      { id: 'desk-b', type: 'desk', x: 0.5, z: 0, width: 1, depth: 1, height: 0.8 },
    ] }] }
    expect(validateIndoorFloor(overlappingFurniture).some(error => error.includes('desk-a 与 desk-b 存在重叠'))).toBe(true)
  })

  it('keeps room entrance circulation clear of furniture', () => {
    const blocked = {
      ...sample,
      rooms: [{ ...sample.rooms[0], furniture: [
        { id: 'door-blocker', type: 'cabinet', x: 0, z: 2.2, width: 1, depth: 0.5, height: 1.8 },
      ] }],
    }
    expect(validateIndoorFloor(blocked).some(error => error.includes('door-blocker 堵塞门口通道'))).toBe(true)
  })

  it('keeps stair circulation and landing area clear of furniture', () => {
    const blocked = {
      ...sample,
      rooms: [{ id: 'stair-room', name: '楼梯间', x: 0, z: 0, width: 8, depth: 8, furniture: [
        { id: 'stair-blocker', type: 'cabinet', x: 0, z: 0, width: 1, depth: 1, height: 1.8 },
      ] }],
      stairPoint: { x: 0, z: 0, direction: 'south' },
    }
    expect(validateIndoorFloor(blocked).some(error => error.includes('stair-blocker 占用楼梯通行区域'))).toBe(true)
  })

  it('builds a collision-aware navigation graph linking spawn, room, and exit', () => {
    const group = createIndoorFloor(THREE, sample)
    const graph = group.userData.navigationGraph
    expect(graph.nodes.length).toBeGreaterThan(100)
    expect(graph.summary.spawnReachable).toBe(true)
    expect(graph.points.find(point => point.id === 'room:classroom-101:approach')?.reachableFromSpawn).toBe(true)
    expect(graph.points.find(point => point.id === 'room:classroom-101:inside')?.reachableFromSpawn).toBe(true)
    expect(graph.points.find(point => point.id === 'exit:0')?.reachableFromSpawn).toBe(true)
    const route = graph.findPath({ x: 0, z: 0 }, { x: -5, z: 1.85 })
    expect(route?.length).toBeGreaterThan(2)
    expect(route?.[0]).toMatchObject({ x: 0, z: 0 })
    expect(group.userData.navigationSummary).toEqual(graph.summary)
  })

  it('marks a room landmark disconnected when its doorway is blocked by a wall', () => {
    const blockedFloor = {
      ...sample,
      rooms: [],
      walls: [{ id: 'barrier', axis: 'z', x: -5, z: 0, length: 12, thickness: 0.3 }],
    }
    const graph = buildIndoorNavigationGraph(blockedFloor, [
      { minX: -5.15, maxX: -4.85, minZ: -9, maxZ: 9 },
    ], {
      roomInteractions: [{ roomId: 'isolated', approach: { x: -2, z: -2 }, inside: { x: -8, z: 2 } }],
    })
    expect(graph.points.find(point => point.id === 'room:isolated:inside')?.reachableFromSpawn).toBe(false)
    expect(graph.summary.disconnectedPoints).toContain('room:isolated:inside')
    expect(graph.findPath({ x: 0, z: 0 }, { x: -8, z: 2 })).toBeNull()
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
    const exitLandmark = group.userData.navigationGraph.points.find(point => point.type === 'exit')
    expect(exitLandmark?.point).toEqual(group.userData.exitInteractions[0])
    expect(exitLandmark?.nodeId).not.toBeNull()
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


describe('building-local entrance mapping', () => {
  const bounds = { minX: -7.5, maxX: 7.5, minZ: -4.5, maxZ: 4.5 }

  it('maps a south-facing exterior entrance to the matching indoor doorway and landing', () => {
    expect(resolveIndoorEntrance(bounds, { x: 0, z: 5.35 })).toMatchObject({
      wall: 'south', offset: 0, landing: { x: 0, z: 2.3 },
    })
  })

  it('maps entrances on each cardinal wall and clamps the door offset to the wall', () => {
    expect(resolveIndoorEntrance(bounds, { x: -8, z: 1.25 })).toMatchObject({
      wall: 'west', offset: 1.25, landing: { x: -5.3, z: 1.25 },
    })
    expect(resolveIndoorEntrance(bounds, { x: 8, z: -8 })).toMatchObject({
      wall: 'east', offset: -4.5, landing: { x: 5.3, z: -4.5 },
    })
    expect(resolveIndoorEntrance(bounds, { x: 2.4, z: -5 })).toMatchObject({
      wall: 'north', offset: 2.4, landing: { x: 2.4, z: -2.3 },
    })
  })

  it('rejects missing or invalid entrance coordinates', () => {
    expect(() => resolveIndoorEntrance(bounds, null)).toThrow()
    expect(() => resolveIndoorEntrance(bounds, { x: Number.NaN, z: 0 })).toThrow()
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
    const entranceAligned = createIndoorBuildingFromFootprint({
      id: 'teaching-building',
      bounds: { minX: -7.75, maxX: 7.75, minZ: -4.6, maxZ: 4.6 },
    }, { floors: 2, entrancePoint: { x: 0, z: 5.35 } })
    expect(entranceAligned.floors[0].doors[0]).toMatchObject({ wall: 'south', offset: 0 })
    expect(entranceAligned.floors[0].spawnPoint.x).toBe(0)
    expect(entranceAligned.floors[0].spawnPoint.z).toBeCloseTo(2.4)
    expect(entranceAligned.floors[1].doors).toEqual([])
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


describe('building expansion layout', () => {
  const createExpandableBuilding = () => createIndoorBuildingFromFootprint({
    id: 'test-expansion-building',
    name: '扩建测试楼',
    bounds: { minX: -10, maxX: 10, minZ: -8, maxZ: 8 },
  }, { floors: 2 })

  it.each(['north', 'south', 'east', 'west'])('creates a usable room when expanding to the %s', (side) => {
    const expanded = expandIndoorBuilding(createExpandableBuilding(), { side, amount: 4 })
    expect(expanded.floors).toHaveLength(2)
    for (const floor of expanded.floors) {
      const expansionRoom = floor.rooms.find(room => room.id.startsWith(`expansion-${side}-f${floor.level}-`))
      expect(expansionRoom).toBeTruthy()
      expect(expansionRoom.doorWidth).toBeGreaterThan(0)
      expect(expansionRoom.furniture).toEqual([])
      expect(expansionRoom.x - expansionRoom.width / 2).toBeGreaterThanOrEqual(-floor.width / 2)
      expect(expansionRoom.x + expansionRoom.width / 2).toBeLessThanOrEqual(floor.width / 2)
      expect(expansionRoom.z - expansionRoom.depth / 2).toBeGreaterThanOrEqual(-floor.depth / 2)
      expect(expansionRoom.z + expansionRoom.depth / 2).toBeLessThanOrEqual(floor.depth / 2)
    }
    expect(validateIndoorBuilding(expanded)).toEqual([])
  })

  it('keeps narrow extensions open instead of creating an unusably narrow room', () => {
    const expanded = expandIndoorBuilding(createExpandableBuilding(), { side: 'east', amount: 2 })
    expect(expanded.floors[0].rooms.some(room => room.id.startsWith('expansion-'))).toBe(false)
    expect(validateIndoorBuilding(expanded)).toEqual([])
  })
})
