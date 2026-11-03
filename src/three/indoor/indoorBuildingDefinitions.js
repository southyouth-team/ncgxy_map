import { validateIndoorFloor } from './indoorScene.js'
/** 室内建筑数据定义（演示样板），未经测绘不得标注为真实校园数据。 */
export const indoorBuildingDefinitions = {
  teachingBlockPrototype: {
    id: 'teaching-block-prototype', name: '教学楼空间样板', prototype: true, floorHeight: 4.2,
    bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
    floors: [
      { level: 1, width: 24, depth: 18, wallHeight: 3.4, doors: [{ wall: 'south', offset: 0, width: 2.2 }],
        rooms: [
          { id: 'classroom-101', name: '教室 101', x: -5.4, z: -1.2, width: 7.2, depth: 6.2, doorWall: 'south', doorWidth: 1.5, furniture: [
            { id: 'teacher-desk', type: 'podium', x: 0, z: -1.9, width: 1.5, depth: 0.7, height: 0.85 },
            { id: 'student-desk-1', type: 'desk', x: -1.5, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'student-desk-2', type: 'desk', x: 0, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'student-desk-3', type: 'desk', x: 1.5, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'storage', type: 'cabinet', x: 2.7, z: -1.8, width: 0.7, depth: 1.1, height: 1.8 },
            { id: 'blackboard', type: 'board', x: 0, z: -2.5, width: 3.4, depth: 0.12, height: 1.1 },
          ] },
          { id: 'classroom-102', name: '教室 102', x: 5.4, z: -1.2, width: 7.2, depth: 6.2, doorWall: 'south', doorWidth: 1.5, furniture: [
            { id: 'teacher-desk', type: 'podium', x: 0, z: -1.9, width: 1.5, depth: 0.7, height: 0.85 },
            { id: 'student-desk-1', type: 'desk', x: -1.5, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'student-desk-2', type: 'desk', x: 0, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'student-desk-3', type: 'desk', x: 1.5, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'blackboard', type: 'board', x: 0, z: -2.5, width: 3.4, depth: 0.12, height: 1.1 },
          ] },
        ], spawnPoint: { x: 0, y: 1.7, z: 5.2 }, stairPoint: { x: 10.5, z: 0 } },
      { level: 2, width: 24, depth: 18, wallHeight: 3.4, doors: [],
        rooms: [
          { id: 'classroom-201', name: '教室 201', x: -5.4, z: -1.2, width: 7.2, depth: 6.2, doorWall: 'south', doorWidth: 1.5, furniture: [
            { id: 'teacher-desk', type: 'podium', x: 0, z: -1.9, width: 1.5, depth: 0.7, height: 0.85 },
            { id: 'student-desk-1', type: 'desk', x: -1.5, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'student-desk-2', type: 'desk', x: 0, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'student-desk-3', type: 'desk', x: 1.5, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'blackboard', type: 'board', x: 0, z: -2.5, width: 3.4, depth: 0.12, height: 1.1 },
          ] },
          { id: 'classroom-202', name: '教室 202', x: 5.4, z: -1.2, width: 7.2, depth: 6.2, doorWall: 'south', doorWidth: 1.5, furniture: [
            { id: 'teacher-desk', type: 'podium', x: 0, z: -1.9, width: 1.5, depth: 0.7, height: 0.85 },
            { id: 'student-desk-1', type: 'desk', x: -1.5, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'student-desk-2', type: 'desk', x: 0, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'student-desk-3', type: 'desk', x: 1.5, z: 0.5, width: 1.2, depth: 0.65, height: 0.72 },
            { id: 'blackboard', type: 'board', x: 0, z: -2.5, width: 3.4, depth: 0.12, height: 1.1 },
          ] },
        ], spawnPoint: { x: 0, y: 1.7, z: 5.2 }, stairPoint: { x: 10.5, z: 0 } },
    ],
  },
}
export function validateIndoorBuilding(building) {
  const errors = []
  if (!building || typeof building !== 'object') return ['建筑配置必须是对象']
  if (!building.id) errors.push('建筑必须包含 id')
  if (!Number.isFinite(building.floorHeight) || building.floorHeight < 2.5) errors.push('floorHeight 必须大于等于 2.5')
  if (!Array.isArray(building.floors) || building.floors.length === 0) errors.push('建筑必须至少包含一个楼层')
  const levels = new Set()
  const floors = Array.isArray(building.floors) ? building.floors : []
  for (const floor of floors) {
    if (levels.has(floor.level)) errors.push('楼层编号重复：' + floor.level)
    levels.add(floor.level)
    for (const error of validateIndoorFloor(floor)) errors.push('楼层 ' + floor.level + '：' + error)
  }
  const linkedStairs = floors.filter(floor => floor.stairPoint)
  if (floors.length > 1 && linkedStairs.length !== floors.length) errors.push('多层建筑的每个楼层都必须配置楼梯连接点')
  if (linkedStairs.length > 1) {
    const reference = linkedStairs[0].stairPoint
    for (const floor of linkedStairs.slice(1)) {
      const point = floor.stairPoint
      if (Math.hypot(point.x - reference.x, point.z - reference.z) > 0.25) {
        errors.push('楼层 ' + floor.level + ' 的楼梯连接点未与其他楼层对齐')
      }
    }
  }
  return errors
}

/**
 * 从校园建筑轮廓创建可编辑室内空间。
 * footprint 仅提供建筑占地边界；房间布局是明确标注的程序化初始模板，不代表实测室内图。
 */
export function createIndoorBuildingFromFootprint(footprint, options = {}) {
  if (!footprint?.id || !footprint?.bounds) throw new TypeError('建筑轮廓必须包含 id 和 bounds')
  const footprintWidth = Number(footprint.bounds.maxX) - Number(footprint.bounds.minX)
  const footprintDepth = Number(footprint.bounds.maxZ) - Number(footprint.bounds.minZ)
  if (!Number.isFinite(footprintWidth) || !Number.isFinite(footprintDepth) || footprintWidth <= 0 || footprintDepth <= 0) {
    throw new TypeError('建筑轮廓尺寸无效，无法生成室内空间')
  }
  // 当前底图为视觉数字化近似图，狭长轮廓无法直接作为可玩室内尺寸；仅对室内模板做最小空间归一化。
  const width = Math.max(8, footprintWidth)
  const depth = Math.max(8, footprintDepth)
  const floorCount = Math.max(1, Math.min(30, Math.floor(Number(options.floors) || 1)))
  const floorHeight = Math.max(2.8, Math.min(6, Number(options.floorHeight) || 3.6))
  const corridorDepth = Math.max(2.4, Math.min(3.6, depth * 0.2))
  const roomDepth = Math.max(3, (depth - corridorDepth - 2) / 2)
  const roomWidth = Math.max(3, (width - 3) / 2)
  const floors = Array.from({ length: floorCount }, (_, index) => {
    const level = index + 1
    return {
      level, width, depth, wallHeight: floorHeight - 0.45,
      doors: level === 1 ? [{ wall: 'south', offset: 0, width: Math.min(2.4, width * 0.18) }] : [],
      rooms: [
        { id: `${footprint.id}-${level}-room-a`, name: `空间 ${level}A`, x: -roomWidth / 2 - 0.5, z: -depth / 2 + roomDepth / 2 + 0.6, width: roomWidth, depth: roomDepth, doorWall: 'south', doorWidth: Math.min(1.5, roomWidth * 0.35), furniture: [] },
        { id: `${footprint.id}-${level}-room-b`, name: `空间 ${level}B`, x: roomWidth / 2 + 0.5, z: -depth / 2 + roomDepth / 2 + 0.6, width: roomWidth, depth: roomDepth, doorWall: 'south', doorWidth: Math.min(1.5, roomWidth * 0.35), furniture: [] },
      ],
      spawnPoint: { x: 0, y: 1.7, z: depth / 2 - 1.6 },
      stairPoint: { x: width / 2 - 1.5, z: 0 },
    }
  })
  return {
    id: footprint.id,
    name: options.name || footprint.name || footprint.label || '未命名建筑',
    prototype: true,
    generatedFromFootprint: true,
    layoutStatus: 'procedural-template',
    footprintSize: { width: footprintWidth, depth: footprintDepth },
    footprint: {
      type: 'rect',
      source: footprint.source || 'campus-plan',
      bounds: { minX: -footprintWidth / 2, maxX: footprintWidth / 2, minZ: -footprintDepth / 2, maxZ: footprintDepth / 2 },
      expansion: { north: 0, south: 0, east: 0, west: 0 },
    },
    interiorNormalized: width !== footprintWidth || depth !== footprintDepth,
    floorHeight,
    bounds: { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 },
    floors,
  }
}

/**
 * 按指定方向扩建矩形建筑占地，并同步平移室内构件的局部坐标。
 * amount 为场景单位；不伪造真实测绘尺寸，调用方应在保存前进行人工确认。
 */
export function expandIndoorBuilding(definition, { side, amount = 2 } = {}) {
  if (!definition || !['north', 'south', 'east', 'west'].includes(side)) {
    throw new TypeError('扩建方向必须是 north/south/east/west')
  }
  const distance = Number(amount)
  if (!Number.isFinite(distance) || distance <= 0 || distance > 50) {
    throw new RangeError('单次扩建尺寸必须大于 0 且不超过 50')
  }
  const next = JSON.parse(JSON.stringify(definition))
  const footprint = next.footprint || {
    type: 'rect',
    source: 'legacy-layout',
    bounds: { minX: -next.footprintSize.width / 2, maxX: next.footprintSize.width / 2, minZ: -next.footprintSize.depth / 2, maxZ: next.footprintSize.depth / 2 },
    expansion: { north: 0, south: 0, east: 0, west: 0 },
  }
  const expansion = { north: 0, south: 0, east: 0, west: 0, ...(footprint.expansion || {}) }
  expansion[side] += distance
  const oldBounds = footprint.bounds
  const bounds = { ...oldBounds }
  if (side === 'east') bounds.maxX += distance
  if (side === 'west') bounds.minX -= distance
  if (side === 'north') bounds.minZ -= distance
  if (side === 'south') bounds.maxZ += distance
  const shiftX = (bounds.minX + bounds.maxX - oldBounds.minX - oldBounds.maxX) / 2
  const shiftZ = (bounds.minZ + bounds.maxZ - oldBounds.minZ - oldBounds.maxZ) / 2
  const widthDelta = bounds.maxX - bounds.minX - (oldBounds.maxX - oldBounds.minX)
  const depthDelta = bounds.maxZ - bounds.minZ - (oldBounds.maxZ - oldBounds.minZ)

  next.footprint = { ...footprint, bounds, expansion }
  next.footprintSize = { width: bounds.maxX - bounds.minX, depth: bounds.maxZ - bounds.minZ }
  const nextWidth = next.bounds.maxX - next.bounds.minX + widthDelta
  const nextDepth = next.bounds.maxZ - next.bounds.minZ + depthDelta
  next.bounds = { minX: -nextWidth / 2, maxX: nextWidth / 2, minZ: -nextDepth / 2, maxZ: nextDepth / 2 }
  next.floors = next.floors.map(floor => ({
    ...floor,
    width: floor.width + widthDelta,
    depth: floor.depth + depthDelta,
    rooms: floor.rooms.map(room => ({ ...room, x: room.x - shiftX, z: room.z - shiftZ })),
    walls: (floor.walls || []).map(wall => ({ ...wall, x: wall.x - shiftX, z: wall.z - shiftZ })),
    spawnPoint: floor.spawnPoint ? { ...floor.spawnPoint, x: floor.spawnPoint.x - shiftX, z: floor.spawnPoint.z - shiftZ } : floor.spawnPoint,
    stairPoint: floor.stairPoint ? { ...floor.stairPoint, x: floor.stairPoint.x - shiftX, z: floor.stairPoint.z - shiftZ } : floor.stairPoint,
  }))
  next.interiorNormalized = false
  next.expansionStatus = 'user-expanded-unverified'
  return next
}
