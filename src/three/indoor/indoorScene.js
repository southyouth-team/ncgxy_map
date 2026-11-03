/**
 * 参数化室内楼层原型。
 * 坐标约定：建筑中心为 (0, 0)，平面使用 XZ，Y 为高度；尺寸单位沿用校园场景单位。
 * 这是可替换的空间构建器，不包含未经测绘的南昌工学院真实房间数据。
 */
/** 室内交互对象统一数据契约，供拾取、提示和后续服务端数据映射复用。 */
export function createIndoorInteractionData({ id, name, objectType, interactionType = 'inspect', action = 'inspect', operationHint = '点击查看详情', roomId = null, roomName = null, description = '' }) {
  if (!id || !name || !objectType) throw new TypeError('室内交互对象必须包含 id、name 和 objectType')
  if (!['inspect', 'use', 'navigate'].includes(interactionType)) throw new TypeError('室内交互类型必须是 inspect/use/navigate')
  return { id, name, objectType, interactionType, action, operationHint, roomId, roomName, description }
}


/** 根据楼层切换方向返回楼梯的实际落脚端点，避免旋转楼梯仍沿世界 Z 轴移动。 */
export function getStairLandingPoint(stairPath, direction) {
  if (!stairPath || ![-1, 1].includes(direction)) return null
  const point = direction > 0 ? stairPath.end : stairPath.start
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null
  return { x: point.x, z: point.z }
}

/** 返回当前楼层的楼梯入口与目标楼层落脚点。 */
export function getStairTraversalPoints(stairPath, direction) {
  if (![-1, 1].includes(direction)) return null
  const entry = getStairLandingPoint(stairPath, -direction)
  const exit = getStairLandingPoint(stairPath, direction)
  if (!entry || !exit) return null
  return { entry, exit }
}

/** 根据楼梯配置生成与楼梯模型一致的上下平台坐标。 */
export function createStairPath(stairPoint = {}, floorHeight = 4.2) {
  const x = Number(stairPoint.x)
  const z = Number(stairPoint.z)
  const direction = stairPoint.direction || 'south'
  const rotations = { south: 0, west: -Math.PI / 2, north: Math.PI, east: Math.PI / 2 }
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(floorHeight) || floorHeight <= 0 || !(direction in rotations)) return null
  const rotation = rotations[direction]
  const rotate = localZ => ({
    x: Number((x + Math.sin(rotation) * localZ).toFixed(3)),
    z: Number((z + Math.cos(rotation) * localZ).toFixed(3)),
  })
  return { start: rotate(-2.1), end: rotate(2.1), rise: floorHeight, direction }
}


/**
 * 生成建筑内跨楼层导航计划。楼层按编号排序，每次只跨越一个相邻楼层，
 * 由运行时在每层分别执行平面寻路，避免把不同高度的网格错误地投影到同一平面。
 */
export function planIndoorFloorRoute(building, startLevel, targetLevel) {
  if (!building || !Array.isArray(building.floors) ||
    !Number.isInteger(startLevel) || !Number.isInteger(targetLevel)) return null
  const floors = [...building.floors].sort((a, b) => a.level - b.level)
  const levels = floors.map(floor => floor.level)
  const startIndex = levels.indexOf(startLevel)
  const targetIndex = levels.indexOf(targetLevel)
  if (startIndex < 0 || targetIndex < 0) return null
  if (startIndex === targetIndex) return { levels: [startLevel], transitions: [] }
  const transitions = []
  const direction = targetIndex > startIndex ? 1 : -1
  for (let index = startIndex; index !== targetIndex; index += direction) {
    const from = floors[index]
    const to = floors[index + direction]
    if (Math.abs(to.level - from.level) !== 1 || !from.stairPoint || !to.stairPoint) return null
    const aligned = Math.hypot(from.stairPoint.x - to.stairPoint.x, from.stairPoint.z - to.stairPoint.z) <= 0.05
    if (!aligned) return null
    const fromPath = createStairPath(from.stairPoint, building.floorHeight || 4.2)
    const toPath = createStairPath(to.stairPoint, building.floorHeight || 4.2)
    if (!fromPath || !toPath) return null
    const fromLanding = direction > 0 ? fromPath.start : fromPath.end
    const toLanding = direction > 0 ? toPath.end : toPath.start
    transitions.push({
      fromLevel: from.level,
      toLevel: to.level,
      direction,
      stairPoint: { x: from.stairPoint.x, z: from.stairPoint.z },
      connector: {
        from: { level: from.level, point: fromLanding },
        to: { level: to.level, point: toLanding },
      },
    })
  }
  return { levels: transitions.length ? [startLevel, ...transitions.map(item => item.toLevel)] : [startLevel], transitions }
}

export function validateIndoorFloor(floor) {
  const errors = []
  if (!floor || typeof floor !== 'object') return ['楼层配置必须是对象']
  if (!Number.isInteger(floor.level)) errors.push('楼层 level 必须是整数')
  if (!Number.isFinite(floor.width) || floor.width < 6) errors.push('楼层 width 必须大于等于 6')
  if (!Number.isFinite(floor.depth) || floor.depth < 6) errors.push('楼层 depth 必须大于等于 6')
  if (!Number.isFinite(floor.wallHeight) || floor.wallHeight < 2) errors.push('墙体高度必须大于等于 2')
  if (!Array.isArray(floor.rooms)) errors.push('rooms 必须是数组')
  if (floor.doors !== undefined && !Array.isArray(floor.doors)) errors.push('doors 必须是数组')
  const spawn = floor.spawnPoint
  if (spawn !== undefined && (!spawn || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.y) || !Number.isFinite(spawn.z) ||
    Math.abs(spawn.x) > floor.width / 2 || Math.abs(spawn.z) > floor.depth / 2 || spawn.y < 0.5 || spawn.y > floor.wallHeight)) errors.push('spawnPoint 必须位于楼层范围内且高度有效')
  const stair = floor.stairPoint
  if (stair !== undefined && (!stair || !Number.isFinite(stair.x) || !Number.isFinite(stair.z) ||
    Math.abs(stair.x) > floor.width / 2 - (['east', 'west'].includes(stair.direction) ? 2.2 : 1) ||
    Math.abs(stair.z) > floor.depth / 2 - (['east', 'west'].includes(stair.direction) ? 1 : 2.2))) errors.push('stairPoint 必须位于楼层范围内并预留楼梯空间')
  if (stair && !['south', 'west', 'north', 'east'].includes(stair.direction || 'south')) errors.push('stairPoint direction 必须是 south/west/north/east')
  for (const door of Array.isArray(floor.doors) ? floor.doors : []) {
    if (!['north', 'south', 'east', 'west'].includes(door.wall)) errors.push('门洞 wall 必须是 north/south/east/west')
    const wallLength = ['north', 'south'].includes(door.wall) ? floor.width : floor.depth
    if (!Number.isFinite(door.width) || door.width < 0.7 || door.width > wallLength) errors.push('门洞 width 超出有效范围')
    if (!Number.isFinite(door.offset) || Math.abs(door.offset) + (Number(door.width) || 0) / 2 > wallLength / 2) errors.push('门洞 offset 超出墙体范围')
  }
  for (const wall of Array.isArray(floor.walls) ? floor.walls : []) {
    if (!wall.id || !['x', 'z'].includes(wall.axis)) errors.push('室内墙体必须包含 id 和有效 axis')
    if (![wall.x, wall.z, wall.length].every(Number.isFinite) || wall.length < 1) errors.push(`墙体 ${wall.id || '(unknown)'} 的位置或长度无效`)
    else {
      const halfLength = wall.length / 2
      const horizontal = wall.axis === 'x'
      const limit = horizontal ? floor.width / 2 : floor.depth / 2
      const center = horizontal ? wall.x : wall.z
      const crossLimit = horizontal ? floor.depth / 2 : floor.width / 2
      const cross = horizontal ? wall.z : wall.x
      if (Math.abs(center) + halfLength > limit || Math.abs(cross) > crossLimit) errors.push(`墙体 ${wall.id} 超出楼层边界`)
    }
    if (wall.doorWidth !== undefined && wall.doorWidth > 0 &&
      (!Number.isFinite(wall.doorWidth) || wall.doorWidth < 0.7 || wall.doorWidth > wall.length ||
       Math.abs(Number(wall.doorOffset) || 0) + wall.doorWidth / 2 > wall.length / 2)) errors.push(`墙体 ${wall.id} 的门洞尺寸无效`)
  }
  const roomList = Array.isArray(floor.rooms) ? floor.rooms : []
  for (let i = 0; i < roomList.length; i += 1) {
    const room = roomList[i]
    for (const other of roomList.slice(i + 1)) {
      const overlapX = (room.width + other.width) / 2 - Math.abs(room.x - other.x)
      const overlapZ = (room.depth + other.depth) / 2 - Math.abs(room.z - other.z)
      if (overlapX > 0.05 && overlapZ > 0.05) errors.push('房间 ' + room.id + ' 与 ' + other.id + ' 存在重叠')
    }
    const items = Array.isArray(room.furniture) ? room.furniture : []
    // 门洞内侧保留连续通行带，避免家具虽未越界却堵住实际入口。
    if (Number(room.doorWidth) > 0 && [room.x, room.z, room.width, room.depth, room.doorWidth].every(Number.isFinite)) {
      const wall = room.doorWall || 'south'
      const offset = Number(room.doorOffset) || 0
      const clearanceDepth = 1.5
      const clearance = wall === 'south'
        ? { x: offset, z: room.depth / 2 - clearanceDepth / 2, width: room.doorWidth, depth: clearanceDepth }
        : wall === 'north'
          ? { x: offset, z: -room.depth / 2 + clearanceDepth / 2, width: room.doorWidth, depth: clearanceDepth }
          : wall === 'east'
            ? { x: room.width / 2 - clearanceDepth / 2, z: offset, width: clearanceDepth, depth: room.doorWidth }
            : { x: -room.width / 2 + clearanceDepth / 2, z: offset, width: clearanceDepth, depth: room.doorWidth }
      for (const item of items) {
        if (![item.x, item.z, item.width, item.depth].every(Number.isFinite)) continue
        if (Math.abs(item.x - clearance.x) < (item.width + clearance.width) / 2 - 0.02 &&
            Math.abs(item.z - clearance.z) < (item.depth + clearance.depth) / 2 - 0.02) {
          errors.push('房间 ' + room.id + ' 的家具 ' + item.id + ' 堵塞门口通道')
        }
      }
    }
    for (let j = 0; j < items.length; j += 1) {
      const item = items[j]
      for (const other of items.slice(j + 1)) {
        const itemOverlapX = (item.width + other.width) / 2 - Math.abs(item.x - other.x)
        const itemOverlapZ = (item.depth + other.depth) / 2 - Math.abs(item.z - other.z)
        if (itemOverlapX > 0.05 && itemOverlapZ > 0.05) errors.push('房间 ' + room.id + ' 的家具 ' + item.id + ' 与 ' + other.id + ' 存在重叠')
      }
    }
  }
  for (const room of Array.isArray(floor.rooms) ? floor.rooms : []) {
    if (!room.id || !room.name) errors.push('房间必须包含 id 和 name')
    if (![room.x, room.z, room.width, room.depth].every(Number.isFinite) || room.width <= 0 || room.depth <= 0) {
      errors.push(`房间 ${room.id || '(unknown)'} 的平面尺寸无效`)
    } else if (Number.isFinite(floor.width) && Number.isFinite(floor.depth) &&
      (room.x - room.width / 2 < -floor.width / 2 || room.x + room.width / 2 > floor.width / 2 ||
       room.z - room.depth / 2 < -floor.depth / 2 || room.z + room.depth / 2 > floor.depth / 2)) {
      errors.push(`房间 ${room.id} 超出楼层边界`)
    }
    if (room.furniture !== undefined && !Array.isArray(room.furniture)) errors.push(`房间 ${room.id} 的 furniture 必须是数组`)
    for (const item of Array.isArray(room.furniture) ? room.furniture : []) {
      if (!item.id || !['desk', 'table', 'chair', 'cabinet', 'podium', 'board'].includes(item.type)) errors.push(`房间 ${room.id} 的家具定义无效`)
      if (![item.x, item.z, item.width, item.depth, item.height].every(Number.isFinite) || item.width <= 0 || item.depth <= 0 || item.height <= 0) errors.push(`房间 ${room.id} 的家具尺寸无效`)
      else if (Math.abs(item.x) + item.width / 2 > room.width / 2 - 0.25 || Math.abs(item.z) + item.depth / 2 > room.depth / 2 - 0.25) errors.push(`房间 ${room.id} 的家具超出房间范围`)
    }
    if (room.doorWidth !== undefined && room.doorWidth > 0) {
      if (!['north', 'south', 'east', 'west'].includes(room.doorWall || 'south')) errors.push(`房间 ${room.id} 的 doorWall 无效`)
      const wallLength = ['north', 'south'].includes(room.doorWall || 'south') ? room.width : room.depth
      if (!Number.isFinite(room.doorWidth) || room.doorWidth < 0.7 || room.doorWidth > wallLength) errors.push(`房间 ${room.id} 的 doorWidth 无效`)
      if (Math.abs(Number(room.doorOffset) || 0) + room.doorWidth / 2 > wallLength / 2) errors.push(`房间 ${room.id} 的 doorOffset 超出墙体`)
    }
  }
  // 楼梯主体占用约 1.7 × 4.4 单位；禁止家具侵入楼梯及上下楼落脚区域。
  if (stair && Number.isFinite(stair.x) && Number.isFinite(stair.z)) {
    const rotated = ['east', 'west'].includes(stair.direction || 'south')
    const stairWidth = rotated ? 4.4 : 1.7
    const stairDepth = rotated ? 1.7 : 4.4
    for (const room of roomList) {
      for (const item of Array.isArray(room.furniture) ? room.furniture : []) {
        if (![room.x, room.z, item.x, item.z, item.width, item.depth].every(Number.isFinite)) continue
        const worldX = room.x + item.x
        const worldZ = room.z + item.z
        if (Math.abs(worldX - stair.x) < (item.width + stairWidth) / 2 - 0.02 &&
            Math.abs(worldZ - stair.z) < (item.depth + stairDepth) / 2 - 0.02) {
          errors.push('房间 ' + room.id + ' 的家具 ' + item.id + ' 占用楼梯通行区域')
        }
      }
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
  // Node/Vitest 等无 DOM 环境只跳过视觉标签，空间几何与碰撞仍可正常构建。
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return
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

export function getRoomInteractionPoints(floor) {
  if (!floor || !Array.isArray(floor.rooms)) return []
  return floor.rooms.filter(room => Number(room.doorWidth) > 0).map(room => {
    const wall = room.doorWall || 'south'
    const offset = Number(room.doorOffset) || 0
    const distance = 1.15
    let approach, inside
    if (wall === 'south') {
      const z = room.z + room.depth / 2
      approach = { x: room.x + offset, z: z + distance }
      inside = { x: room.x + offset, z: z - distance }
    } else if (wall === 'north') {
      const z = room.z - room.depth / 2
      approach = { x: room.x + offset, z: z - distance }
      inside = { x: room.x + offset, z: z + distance }
    } else if (wall === 'east') {
      const x = room.x + room.width / 2
      approach = { x: x + distance, z: room.z + offset }
      inside = { x: x - distance, z: room.z + offset }
    } else {
      const x = room.x - room.width / 2
      approach = { x: x - distance, z: room.z + offset }
      inside = { x: x + distance, z: room.z + offset }
    }
    return { roomId: room.id, roomName: room.name, approach, inside }
  })
}

/**
 * 构建单层室内空间。doors 是外墙门洞定义：
 * { wall: 'north'|'south'|'east'|'west', offset, width }，offset 从墙体中心沿墙方向计。
 */
export function buildIndoorNavigationGraph(floor, obstacles = [], landmarks = {}) {
  const step = Math.max(0.25, Math.min(0.5, Math.max(floor.width, floor.depth) / 160))
  const clearance = 0.48
  const halfW = floor.width / 2
  const halfD = floor.depth / 2
  const polygon = Array.isArray(floor.footprintPolygon) ? floor.footprintPolygon : null
  const isInsidePolygon = (x, z) => {
    if (!polygon || polygon.length < 3) return true
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j]
      const crosses = (a.z > z) !== (b.z > z) &&
        x < ((b.x - a.x) * (z - a.z)) / ((b.z - a.z) || 1e-9) + a.x
      if (crosses) inside = !inside
    }
    return inside
  }
  const isBlocked = (x, z) => obstacles.some(obstacle => {
    if (![obstacle.minX, obstacle.maxX, obstacle.minZ, obstacle.maxZ].every(Number.isFinite)) return false
    return x + clearance > obstacle.minX && x - clearance < obstacle.maxX &&
      z + clearance > obstacle.minZ && z - clearance < obstacle.maxZ
  })
  const nodes = []
  const lookup = new Map()
  const columns = Math.floor(floor.width / step)
  const rows = Math.floor(floor.depth / step)
  for (let iz = 0; iz <= rows; iz += 1) {
    const z = -halfD + iz * step
    for (let ix = 0; ix <= columns; ix += 1) {
      const x = -halfW + ix * step
      if (!isInsidePolygon(x, z) || isBlocked(x, z)) continue
      const id = nodes.length
      nodes.push({ id, x: Number(x.toFixed(3)), z: Number(z.toFixed(3)), neighbors: [] })
      lookup.set(ix + ':' + iz, id)
    }
  }
  for (let iz = 0; iz <= rows; iz += 1) {
    for (let ix = 0; ix <= columns; ix += 1) {
      const id = lookup.get(ix + ':' + iz)
      if (id === undefined) continue
      const node = nodes[id]
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const neighbor = lookup.get((ix + dx) + ':' + (iz + dz))
        if (neighbor !== undefined) node.neighbors.push(neighbor)
      }
    }
  }
  const nearestNode = point => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z) || !nodes.length) return null
    let nearest = null, distanceSquared = Infinity
    for (const node of nodes) {
      const dx = node.x - point.x, dz = node.z - point.z
      const distance = dx * dx + dz * dz
      if (distance < distanceSquared) { nearest = node; distanceSquared = distance }
    }
    return distanceSquared <= 1.1 * 1.1 ? nearest.id : null
  }
  const components = new Int32Array(nodes.length).fill(-1)
  let componentCount = 0
  for (const node of nodes) {
    if (components[node.id] !== -1) continue
    const queue = [node.id]
    components[node.id] = componentCount
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = nodes[queue[cursor]]
      for (const neighbor of current.neighbors) {
        if (components[neighbor] !== -1) continue
        components[neighbor] = componentCount
        queue.push(neighbor)
      }
    }
    componentCount += 1
  }
  const points = [
    { id: 'spawn', type: 'spawn', point: floor.spawnPoint || { x: 0, z: 0 } },
    ...(landmarks.roomInteractions || []).flatMap(room => [
      { id: 'room:' + room.roomId + ':approach', type: 'room-approach', point: room.approach },
      { id: 'room:' + room.roomId + ':inside', type: 'room-inside', point: room.inside },
    ]),
    ...(landmarks.stairPoint ? [{ id: 'stairs', type: 'stairs', point: landmarks.stairPoint }] : []),
    ...(landmarks.stairPath ? [
      { id: 'stairs:lower-landing', type: 'stair-landing', point: landmarks.stairPath.start },
      { id: 'stairs:upper-landing', type: 'stair-landing', point: landmarks.stairPath.end },
    ] : []),
    ...(landmarks.exitInteractions || []).map((point, index) => ({ id: 'exit:' + index, type: 'exit', point })),
  ].map(item => {
    const nodeId = nearestNode(item.point)
    return { id: item.id, type: item.type, point: item.point, nodeId, reachableFromSpawn: false }
  })
  const findPath = (start, end) => {
    const startNode = nearestNode(start)
    const endNode = nearestNode(end)
    if (startNode === null || endNode === null) return null
    const previous = new Int32Array(nodes.length).fill(-1)
    const visited = new Uint8Array(nodes.length)
    const queue = [startNode]
    visited[startNode] = 1
    for (let cursor = 0; cursor < queue.length && !visited[endNode]; cursor += 1) {
      const current = nodes[queue[cursor]]
      for (const neighbor of current.neighbors) {
        if (visited[neighbor]) continue
        visited[neighbor] = 1
        previous[neighbor] = current.id
        queue.push(neighbor)
        if (neighbor === endNode) break
      }
    }
    if (!visited[endNode]) return null
    const path = []
    for (let current = endNode; current !== -1; current = previous[current]) {
      path.push({ x: nodes[current].x, z: nodes[current].z })
      if (current === startNode) break
    }
    return path.reverse()
  }
  const spawnNode = points.find(item => item.type === 'spawn')?.nodeId
  const spawnComponent = spawnNode === null || spawnNode === undefined ? -1 : components[spawnNode]
  for (const point of points) {
    point.reachableFromSpawn = point.nodeId !== null && spawnComponent >= 0 && components[point.nodeId] === spawnComponent
  }
  return {
    step,
    clearance,
    nodes,
    points,
    findPath,
    summary: {
      nodeCount: nodes.length,
      componentCount,
      spawnReachable: spawnNode !== null && spawnNode !== undefined,
      disconnectedPoints: points.filter(point => !point.reachableFromSpawn).map(point => point.id),
    },
  }
}

export function createIndoorFloor(THREE, floor, floorHeight = 4.2) {
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
  const footprintPolygon = Array.isArray(floor.footprintPolygon) && floor.footprintPolygon.length >= 3
    ? floor.footprintPolygon : null
  if (footprintPolygon) {
    const shape = new THREE.Shape()
    shape.moveTo(footprintPolygon[0].x, -footprintPolygon[0].z)
    footprintPolygon.slice(1).forEach(point => shape.lineTo(point.x, -point.z))
    shape.closePath()
    const geometry = new THREE.ShapeGeometry(shape)
    geometry.rotateX(-Math.PI / 2)
    const slab = new THREE.Mesh(geometry, floorMaterial)
    slab.name = 'indoor-floor-slab'
    slab.position.y = -0.18
    slab.receiveShadow = true
    group.add(slab)
  } else {
    addBox(THREE, group, 'indoor-floor-slab', 0, -0.18, 0, floor.width, 0.36, floor.depth, floorMaterial)
  }

  const doors = Array.isArray(floor.doors) ? floor.doors : []
  const collision = []

  // 统一按墙段生成几何与碰撞体，门洞不会再出现“看得见入口但走不过去”的问题。
  const addWallSegments = ({ axis, fixed, length, wallName, centerX, centerZ, wallHeight = h, thickness = t, openings = [] }) => {
    const normalized = openings
      .map((opening) => {
        const width = Math.max(0.7, Number(opening.width) || 1.6)
        const offset = Number(opening.offset) || 0
        return {
          start: Math.max(-length / 2, offset - width / 2),
          end: Math.min(length / 2, offset + width / 2),
        }
      })
      .filter((opening) => opening.end > opening.start)
      .sort((a, b) => a.start - b.start)
    const merged = []
    for (const opening of normalized) {
      const previous = merged[merged.length - 1]
      if (previous && opening.start <= previous.end) previous.end = Math.max(previous.end, opening.end)
      else merged.push({ ...opening })
    }
    const segments = []
    let cursor = -length / 2
    for (const opening of merged) {
      if (opening.start > cursor) segments.push([cursor, opening.start])
      cursor = Math.max(cursor, opening.end)
    }
    if (cursor < length / 2) segments.push([cursor, length / 2])
    for (const [from, to] of segments) {
      const span = to - from
      if (span <= 0.05) continue
      const x = axis === 'x' ? centerX + (from + to) / 2 : centerX
      const z = axis === 'z' ? centerZ + (from + to) / 2 : centerZ
      addBox(THREE, group, `indoor-wall-${wallName}`, x, 0, z,
        axis === 'x' ? span : thickness, wallHeight, axis === 'z' ? span : thickness, wall)
      collision.push(axis === 'x'
        ? { minX: x - span / 2, maxX: x + span / 2, minZ: z - thickness / 2, maxZ: z + thickness / 2 }
        : { minX: x - thickness / 2, maxX: x + thickness / 2, minZ: z - span / 2, maxZ: z + span / 2 })
    }
  }

  if (footprintPolygon) {
    const addPolygonWall = (start, end, wallName, openings = []) => {
      const dx = end.x - start.x, dz = end.z - start.z
      const length = Math.hypot(dx, dz)
      const ux = dx / length, uz = dz / length
      const angle = -Math.atan2(dz, dx)
      const normalized = openings.map(opening => ({
        start: Math.max(-length / 2, (Number(opening.offset) || 0) - (Number(opening.width) || 1.2) / 2),
        end: Math.min(length / 2, (Number(opening.offset) || 0) + (Number(opening.width) || 1.2) / 2),
      })).filter(item => item.end > item.start).sort((a,b) => a.start-b.start)
      const segments = []
      let cursor = -length / 2
      for (const opening of normalized) {
        if (opening.start > cursor) segments.push([cursor, opening.start])
        cursor = Math.max(cursor, opening.end)
      }
      if (cursor < length / 2) segments.push([cursor, length / 2])
      for (const [from, to] of segments) {
        const span = to - from
        if (span < 0.05) continue
        const centerDistance = (from + to) / 2
        const x = (start.x + end.x) / 2 + ux * centerDistance
        const z = (start.z + end.z) / 2 + uz * centerDistance
        const mesh = addBox(THREE, group, 'indoor-wall-' + wallName, x, 0, z, span, h, t, wall)
        mesh.rotation.y = angle
        const padX = Math.abs(ux) * span / 2 + Math.abs(uz) * t / 2
        const padZ = Math.abs(uz) * span / 2 + Math.abs(ux) * t / 2
        collision.push({ minX: x-padX, maxX: x+padX, minZ: z-padZ, maxZ: z+padZ })
      }
    }
    footprintPolygon.forEach((point, index) => {
      const next = footprintPolygon[(index + 1) % footprintPolygon.length]
      const midpoint = { x: (point.x + next.x) / 2, z: (point.z + next.z) / 2 }
      const dx = Math.abs(next.x - point.x), dz = Math.abs(next.z - point.z)
      const side = dx >= dz
        ? (midpoint.z <= 0 ? 'north' : 'south')
        : (midpoint.x <= 0 ? 'west' : 'east')
      addPolygonWall(point, next, 'outline-' + index, doors.filter(door => door.wall === side))
    })
  } else {
      addWallSegments({ axis: 'x', centerX: 0, centerZ: -halfD, length: floor.width, wallName: 'north', openings: doors.filter(door => door.wall === 'north') })
  addWallSegments({ axis: 'x', centerX: 0, centerZ: halfD, length: floor.width, wallName: 'south', openings: doors.filter(door => door.wall === 'south') })
  addWallSegments({ axis: 'z', centerX: -halfW, centerZ: 0, length: floor.depth, wallName: 'west', openings: doors.filter(door => door.wall === 'west') })
  addWallSegments({ axis: 'z', centerX: halfW, centerZ: 0, length: floor.depth, wallName: 'east', openings: doors.filter(door => door.wall === 'east') })
  }

  // 自定义隔墙由同一份楼层数据驱动，门洞在几何与碰撞层同步留空。
  for (const wallDefinition of Array.isArray(floor.walls) ? floor.walls : []) {
    const horizontal = wallDefinition.axis === 'x'
    const openings = Number(wallDefinition.doorWidth) > 0
      ? [{ offset: Number(wallDefinition.doorOffset) || 0, width: wallDefinition.doorWidth }]
      : []
    addWallSegments({
      axis: horizontal ? 'x' : 'z',
      centerX: wallDefinition.x,
      centerZ: wallDefinition.z,
      length: wallDefinition.length,
      wallName: wallDefinition.id,
      wallHeight: Number(wallDefinition.height) || h * 0.82,
      thickness: Number(wallDefinition.thickness) || 0.2,
      openings,
    })
  }

  for (const room of floor.rooms) {
    const x = room.x, z = room.z, w = room.width, d = room.depth
    const roomWallHeight = h * 0.82
    const roomThickness = t
    const roomDoorWall = room.doorWall || 'south'
    const roomDoor = room.doorWidth > 0
      ? [{ offset: Number(room.doorOffset) || 0, width: room.doorWidth }]
      : []
    addWallSegments({ axis: 'x', centerX: x, centerZ: z - d / 2, length: w, wallName: `${room.id}-north`, wallHeight: roomWallHeight, thickness: roomThickness })
    addWallSegments({ axis: 'x', centerX: x, centerZ: z + d / 2, length: w, wallName: `${room.id}-south`, wallHeight: roomWallHeight, thickness: roomThickness, openings: roomDoorWall === 'south' ? roomDoor : [] })
    addWallSegments({ axis: 'z', centerX: x - w / 2, centerZ: z, length: d, wallName: `${room.id}-west`, wallHeight: roomWallHeight, thickness: roomThickness, openings: roomDoorWall === 'west' ? roomDoor : [] })
    addWallSegments({ axis: 'z', centerX: x + w / 2, centerZ: z, length: d, wallName: `${room.id}-east`, wallHeight: roomWallHeight, thickness: roomThickness, openings: roomDoorWall === 'east' ? roomDoor : [] })
    addBox(THREE, group, `room-floor-${room.id}`, x, 0.01, z, w - t, 0.04, d - t, trim)
    addLabel(THREE, group, room.name, x, z)
    const furnitureMaterials = {
      desk: new THREE.MeshStandardMaterial({ color: '#9a704b', roughness: 0.9 }),
      table: new THREE.MeshStandardMaterial({ color: '#b58a5c', roughness: 0.9 }),
      chair: new THREE.MeshStandardMaterial({ color: '#78634d', roughness: 0.95 }),
      cabinet: new THREE.MeshStandardMaterial({ color: '#8c765d', roughness: 0.95 }),
      podium: new THREE.MeshStandardMaterial({ color: '#a27b51', roughness: 0.9 }),
      board: new THREE.MeshStandardMaterial({ color: '#e5e2d6', roughness: 0.95 }),
    }
    for (const item of room.furniture || []) {
      const itemX = x + item.x
      const itemZ = z + item.z
      const furniture = addBox(THREE, group, `indoor-furniture-${room.id}-${item.id}`, itemX, 0, itemZ, item.width, item.height, item.depth, furnitureMaterials[item.type])
      furniture.userData.interactionData = createIndoorInteractionData({
        id: item.id, name: item.name || ({ desk: '课桌', table: '桌子', chair: '座椅', cabinet: '储物柜', podium: '讲台', board: '教学板' }[item.type]),
        objectType: item.type, interactionType: 'inspect', action: 'inspect', operationHint: '点击查看设施信息',
        roomId: room.id, roomName: room.name, description: item.description || `${room.name}内的${item.name || item.type}`,
      })
      if (item.type !== 'board') {
        collision.push({ minX: itemX - item.width / 2, maxX: itemX + item.width / 2, minZ: itemZ - item.depth / 2, maxZ: itemZ + item.depth / 2 })
      }
    }
  }
  // 房间入口标记可拾取查看；实际进入仍由门口近距离 E 键逻辑负责。
  for (const point of getRoomInteractionPoints(floor)) {
    const room = floor.rooms.find(item => item.id === point.roomId)
    const marker = addBox(THREE, group, `indoor-room-door-${point.roomId}`, point.approach.x, 0.025, point.approach.z, 1.05, 0.05, 0.22, trim)
    marker.userData.interactionData = createIndoorInteractionData({
      id: `door-${point.roomId}`, name: `${point.roomName}入口`, objectType: 'door', interactionType: 'navigate',
      action: 'enter-room', operationHint: '靠近入口后按 E 进入房间', roomId: point.roomId, roomName: point.roomName,
      description: `通往${room?.name || point.roomName}的入口；进入操作由门口 E 键触发`,
    })
  }

  // 楼梯由共享的 stairPoint 驱动；方向变化直接变换构件坐标，保持台阶为楼层组直接子节点。
  const stairPoint = floor.stairPoint || { x: 9, z: 0, direction: 'south' }
  const stairDirections = { south: 0, west: -Math.PI / 2, north: Math.PI, east: Math.PI / 2 }
  const stairRotation = stairDirections[stairPoint.direction || 'south'] ?? 0
  const rotateStairPoint = (x, z) => ({
    x: stairPoint.x + Math.cos(stairRotation) * x + Math.sin(stairRotation) * z,
    z: stairPoint.z - Math.sin(stairRotation) * x + Math.cos(stairRotation) * z,
  })
  const stairMaterial = new THREE.MeshStandardMaterial({ color: '#9a7958', roughness: 1 })
  const stairCount = 12
  const stairRise = floorHeight / stairCount
  const stairDepth = 4.2 / stairCount
  const rotated = Math.abs(Math.sin(stairRotation)) > 0.5
  for (let index = 0; index < stairCount; index += 1) {
    const localZ = -2.1 + (index + 0.5) * stairDepth
    const point = rotateStairPoint(0, localZ)
    const step = addBox(THREE, group, 'indoor-stair-step', point.x, (index + 0.5) * stairRise, point.z,
      rotated ? stairDepth : 1.7, stairRise, rotated ? 1.7 : stairDepth, stairMaterial)
    if (index === 5) step.userData.interactionData = createIndoorInteractionData({
      id: `stair-${floor.level}`, name: '楼层楼梯', objectType: 'stairs', interactionType: 'navigate', action: 'change-floor',
      operationHint: '靠近楼梯后按 E 切换楼层', description: '连接相邻楼层；楼层切换由楼梯区域近距离 E 键触发',
    })
  }
  const railMaterial = new THREE.MeshStandardMaterial({ color: '#6d5842', roughness: 0.9 })
  const railAngle = -Math.atan2(floorHeight, 4.2)
  for (const offset of [-0.95, 0.95]) {
    const railCenter = rotateStairPoint(offset, 0)
    const handrail = addBox(THREE, group, 'indoor-stair-rail', railCenter.x, floorHeight / 2 + 0.82, railCenter.z,
      0.12, 0.12, 4.55, railMaterial)
    handrail.rotation.x = railAngle
    const postPositions = [-1.95, -0.65, 0.65, 1.95]
    for (const localZ of postPositions) {
      const postPoint = rotateStairPoint(offset, localZ)
      const heightAtPoint = ((localZ + 2.1) / 4.2) * floorHeight
      addBox(THREE, group, 'indoor-stair-rail-post', postPoint.x, heightAtPoint + 0.4, postPoint.z,
        0.09, 0.8, 0.09, railMaterial)
    }
    const railCorners = [
      rotateStairPoint(offset - 0.06, -2.2), rotateStairPoint(offset + 0.06, -2.2),
      rotateStairPoint(offset - 0.06, 2.2), rotateStairPoint(offset + 0.06, 2.2),
    ]
    collision.push({
      minX: Math.min(...railCorners.map(point => point.x)), maxX: Math.max(...railCorners.map(point => point.x)),
      minZ: Math.min(...railCorners.map(point => point.z)), maxZ: Math.max(...railCorners.map(point => point.z)),
    })
  }

  // 上下平台分别与本层楼板、上一层楼板齐平，避免台阶悬空或嵌入。
  const landingMaterial = new THREE.MeshStandardMaterial({ color: '#b7a98e', roughness: 1 })
  for (const [localZ, centerY] of [[-2.55, -0.1], [2.55, floorHeight - 0.1]]) {
    const landingPoint = rotateStairPoint(0, localZ)
    addBox(THREE, group, 'indoor-stair-landing', landingPoint.x, centerY, landingPoint.z,
      rotated ? 0.9 : 1.7, 0.2, rotated ? 1.7 : 0.9, landingMaterial)
  }
  group.userData.roomInteractions = getRoomInteractionPoints(floor)
  group.userData.exitInteractions = doors.map(door => {
    const offset = Number(door.offset) || 0
    const distance = 1.15
    if (door.wall === 'south') return { x: offset, z: halfD - distance }
    if (door.wall === 'north') return { x: offset, z: -halfD + distance }
    if (door.wall === 'east') return { x: halfW - distance, z: offset }
    return { x: -halfW + distance, z: offset }
  })
  group.userData.stairPoint = { x: stairPoint.x, z: stairPoint.z }
  group.userData.stairPath = createStairPath(stairPoint, floorHeight)
  // 以实际碰撞障碍生成低分辨率导航网格，供室内可达性校验和后续寻路复用。
  const navigation = buildIndoorNavigationGraph(floor, collision, {
    roomInteractions: getRoomInteractionPoints(floor),
    stairPoint,
    stairPath: group.userData.stairPath,
    exitInteractions: doors.map(door => {
      const offset = Number(door.offset) || 0
      const distance = 1.15
      if (door.wall === 'south') return { x: offset, z: halfD - distance }
      if (door.wall === 'north') return { x: offset, z: -halfD + distance }
      if (door.wall === 'east') return { x: halfW - distance, z: offset }
      return { x: -halfW + distance, z: offset }
    }),
  })
  group.userData.navigationGraph = navigation
  group.userData.navigationSummary = navigation.summary
  group.userData.collisionObstacles = collision
  group.userData.spawnPoint = floor.spawnPoint || { x: 0, y: 1.7, z: 0 }
  group.userData.exits = doors.map(door => ({ ...door }))
  return group
}
