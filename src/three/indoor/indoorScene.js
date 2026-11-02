/**
 * 参数化室内楼层原型。
 * 坐标约定：建筑中心为 (0, 0)，平面使用 XZ，Y 为高度；尺寸单位沿用校园场景单位。
 * 这是可替换的空间构建器，不包含未经测绘的南昌工学院真实房间数据。
 */
export function validateIndoorFloor(floor) {
  const errors = []
  if (!floor || typeof floor !== 'object') return ['楼层配置必须是对象']
  if (!Number.isInteger(floor.level)) errors.push('楼层 level 必须是整数')
  if (!Number.isFinite(floor.width) || floor.width < 6) errors.push('楼层 width 必须大于等于 6')
  if (!Number.isFinite(floor.depth) || floor.depth < 6) errors.push('楼层 depth 必须大于等于 6')
  if (!Number.isFinite(floor.wallHeight) || floor.wallHeight < 2) errors.push('墙体高度必须大于等于 2')
  if (!Array.isArray(floor.rooms)) errors.push('rooms 必须是数组')
  for (const room of Array.isArray(floor.rooms) ? floor.rooms : []) {
    if (!room.id || !room.name) errors.push('房间必须包含 id 和 name')
    if (![room.x, room.z, room.width, room.depth].every(Number.isFinite) || room.width <= 0 || room.depth <= 0) {
      errors.push(`房间 ${room.id || '(unknown)'} 的平面尺寸无效`)
    }
  }
  return errors
}

function addBox(THREE, parent, name, x, y, z, width, height, depth, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
  mesh.name = name
  mesh.position.set(x, y + height / 2, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function addLabel(THREE, parent, text, x, z) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')
  context.fillStyle = '#f6edda'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#8a7258'
  context.lineWidth = 5
  context.strokeRect(2, 2, 252, 60)
  context.fillStyle = '#514637'
  context.font = 'bold 25px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, 128, 32, 230)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }))
  sprite.name = 'indoor-room-label'
  sprite.position.set(x, 2.35, z)
  sprite.scale.set(3.2, 0.8, 1)
  parent.add(sprite)
}

/**
 * 构建单层室内空间。doors 是外墙门洞定义：
 * { wall: 'north'|'south'|'east'|'west', offset, width }，offset 从墙体中心沿墙方向计。
 */
export function createIndoorFloor(THREE, floor) {
  const errors = validateIndoorFloor(floor)
  if (errors.length) throw new TypeError(errors.join('；'))
  const group = new THREE.Group()
  group.name = `IndoorFloor-${floor.level}`
  group.userData.floorLevel = floor.level
  const wall = new THREE.MeshStandardMaterial({ color: '#e9ddc5', roughness: 1 })
  const floorMaterial = new THREE.MeshStandardMaterial({ color: '#b7a98e', roughness: 1 })
  const trim = new THREE.MeshStandardMaterial({ color: '#826b52', roughness: 1 })
  const halfW = floor.width / 2
  const halfD = floor.depth / 2
  const h = floor.wallHeight
  const t = 0.28
  addBox(THREE, group, 'indoor-floor-slab', 0, -0.18, 0, floor.width, 0.36, floor.depth, floorMaterial)

  const doors = Array.isArray(floor.doors) ? floor.doors : []
  const wallSegments = (axis, fixed, length, name) => {
    const openings = doors.filter(door => door.wall === name).map(door => ({
      start: Math.max(-length / 2, Number(door.offset || 0) - Math.max(0.6, Number(door.width || 1.6)) / 2),
      end: Math.min(length / 2, Number(door.offset || 0) + Math.max(0.6, Number(door.width || 1.6)) / 2),
    })).sort((a, b) => a.start - b.start)
    let cursor = -length / 2
    const segments = []
    for (const opening of openings) {
      if (opening.start > cursor) segments.push([cursor, opening.start])
      cursor = Math.max(cursor, opening.end)
    }
    if (cursor < length / 2) segments.push([cursor, length / 2])
    for (const [start, end] of segments) {
      const span = end - start
      if (span <= 0) continue
      const x = axis === 'x' ? (start + end) / 2 : fixed
      const z = axis === 'z' ? (start + end) / 2 : fixed
      addBox(THREE, group, `indoor-wall-${name}`, x, 0, z,
        axis === 'x' ? span : t, h, axis === 'z' ? span : t, wall)
    }
  }
  wallSegments('x', -halfD, floor.width, 'north')
  wallSegments('x', halfD, floor.width, 'south')
  wallSegments('z', -halfW, floor.depth, 'west')
  wallSegments('z', halfW, floor.depth, 'east')

  const collision = [
    { minX: -halfW, maxX: halfW, minZ: -halfD - t / 2, maxZ: -halfD + t / 2 },
    { minX: -halfW, maxX: halfW, minZ: halfD - t / 2, maxZ: halfD + t / 2 },
    { minX: -halfW - t / 2, maxX: -halfW + t / 2, minZ: -halfD, maxZ: halfD },
    { minX: halfW - t / 2, maxX: halfW + t / 2, minZ: -halfD, maxZ: halfD },
  ]
  for (const room of floor.rooms) {
    const x = room.x, z = room.z, w = room.width, d = room.depth
    addBox(THREE, group, `room-partition-${room.id}-north`, x, 0, z - d / 2, w, h * 0.82, t, wall)
    addBox(THREE, group, `room-partition-${room.id}-south`, x, 0, z + d / 2, w, h * 0.82, t, wall)
    addBox(THREE, group, `room-partition-${room.id}-west`, x - w / 2, 0, z, t, h * 0.82, d, wall)
    addBox(THREE, group, `room-partition-${room.id}-east`, x + w / 2, 0, z, t, h * 0.82, d, wall)
    addBox(THREE, group, `room-floor-${room.id}`, x, 0.01, z, w - t, 0.04, d - t, trim)
    addLabel(THREE, group, room.name, x, z)
    collision.push(
      { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2 - t / 2, maxZ: z - d / 2 + t / 2 },
      { minX: x - w / 2, maxX: x + w / 2, minZ: z + d / 2 - t / 2, maxZ: z + d / 2 + t / 2 },
      { minX: x - w / 2 - t / 2, maxX: x - w / 2 + t / 2, minZ: z - d / 2, maxZ: z + d / 2 },
      { minX: x + w / 2 - t / 2, maxX: x + w / 2 + t / 2, minZ: z - d / 2, maxZ: z + d / 2 },
    )
  }
  group.userData.collisionObstacles = collision
  group.userData.spawnPoint = floor.spawnPoint || { x: 0, y: 1.7, z: 0 }
  group.userData.exits = doors.map(door => ({ ...door }))
  return group
}
