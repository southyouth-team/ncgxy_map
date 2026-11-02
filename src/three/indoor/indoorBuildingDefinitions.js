/** 室内建筑数据定义（演示样板），未经测绘不得标注为真实校园数据。 */
export const indoorBuildingDefinitions = {
  teachingBlockPrototype: {
    id: 'teaching-block-prototype', name: '教学楼空间样板', prototype: true, floorHeight: 4.2,
    bounds: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
    floors: [
      { level: 1, width: 24, depth: 18, wallHeight: 3.4, doors: [{ wall: 'south', offset: 0, width: 2.2 }],
        rooms: [
          { id: 'classroom-101', name: '教室 101', x: -5.4, z: -1.2, width: 7.2, depth: 6.2, doorWall: 'south', doorWidth: 1.5 },
          { id: 'classroom-102', name: '教室 102', x: 5.4, z: -1.2, width: 7.2, depth: 6.2, doorWall: 'south', doorWidth: 1.5 },
        ], spawnPoint: { x: 0, y: 1.7, z: 5.2 }, stairPoint: { x: 10.5, z: 0 } },
      { level: 2, width: 24, depth: 18, wallHeight: 3.4, doors: [],
        rooms: [
          { id: 'classroom-201', name: '教室 201', x: -5.4, z: -1.2, width: 7.2, depth: 6.2, doorWall: 'south', doorWidth: 1.5 },
          { id: 'classroom-202', name: '教室 202', x: 5.4, z: -1.2, width: 7.2, depth: 6.2, doorWall: 'south', doorWidth: 1.5 },
        ], spawnPoint: { x: 0, y: 1.7, z: 5.2 } },
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
  for (const floor of Array.isArray(building.floors) ? building.floors : []) {
    if (levels.has(floor.level)) errors.push('楼层编号重复：' + floor.level)
    levels.add(floor.level)
  }
  return errors
}