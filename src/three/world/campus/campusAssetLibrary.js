// 星露谷式校园像素资产工坊：所有素材均为程序化原创占位资产，可被后续 GLB/Sprite 资源替换。
export function createCampusMaterials(THREE) {
  const makePixelTexture = (base, accents, seed = 1) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 64, 64)
    let value = seed
    const random = () => {
      value = (value * 16807) % 2147483647
      return (value - 1) / 2147483646
    }
    for (let i = 0; i < 110; i += 1) {
      const color = accents[Math.floor(random() * accents.length)]
      const size = random() > 0.82 ? 4 : 2
      ctx.fillStyle = color
      ctx.globalAlpha = 0.35 + random() * 0.45
      ctx.fillRect(Math.floor(random() * 32) * 2, Math.floor(random() * 32) * 2, size, size)
    }
    ctx.globalAlpha = 1
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 1, metalness: 0, flatShading: true, ...extra,
  })
  const grassTexture = makePixelTexture('#82a95f', ['#719653', '#9bbc70', '#668c50', '#b0c77a'], 13)
  const pathTexture = makePixelTexture('#c4a477', ['#b18c61', '#d8bd91', '#a9845e', '#e0c99d'], 29)
  const roofTexture = makePixelTexture('#a85f4e', ['#914d43', '#c4775c', '#d18a68'], 47)
  const wallTexture = makePixelTexture('#e7d2a5', ['#d8bd8c', '#f1dfb8', '#c9ad7d'], 61)
  const woodTexture = makePixelTexture('#8c6848', ['#725239', '#a17a54', '#b28a5d'], 79)
  return {
    grass: material('#ffffff', { map: grassTexture }),
    grassPlain: material('#87a966'),
    path: material('#ffffff', { map: pathTexture }),
    pathEdge: material('#927a59'),
    water: material('#68b9b5', { roughness: 0.32, metalness: 0.02 }),
    waterShallow: material('#91d0c0', { roughness: 0.38 }),
    waterEdge: material('#e8d7a7'),
    wall: material('#ffffff', { map: wallTexture }),
    wallCream: material('#e7d2a5'),
    wallPeach: material('#d8a77d'),
    wallMint: material('#b8c99a'),
    roof: material('#ffffff', { map: roofTexture }),
    roofDark: material('#784b43'),
    wood: material('#ffffff', { map: woodTexture }),
    window: material('#8bc3c5', { roughness: 0.3, metalness: 0.05 }),
    windowTrim: material('#f3dfb5'),
    door: material('#76533d'),
    stone: material('#b9ad91'),
    stoneLight: material('#ded1ad'),
    leaf: material('#4f8050'),
    leafLight: material('#79a65b'),
    leafDark: material('#365f45'),
    trunk: material('#806044'),
    flowerPink: material('#e58e91'),
    flowerYellow: material('#edc66e'),
    flowerWhite: material('#f3e7c8'),
    sports: material('#bd9d76'),
    outline: material('#5b5141'),
  }
}

export function addPixelTree(THREE, parent, x, z, scale = 1, variant = 0, mats) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.scale.setScalar(scale)
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.45, 0.48), mats.trunk)
  trunk.position.y = 0.72
  trunk.castShadow = true
  group.add(trunk)
  const layers = variant % 2 ? [
    [1.35, 1.45, 1.35, mats.leafDark],
    [1.55, 1.25, 1.55, mats.leaf],
    [1.05, 1.05, 1.05, mats.leafLight],
  ] : [
    [1.5, 1.15, 1.5, mats.leafDark],
    [1.8, 1.0, 1.8, mats.leaf],
    [1.3, 0.85, 1.3, mats.leafLight],
  ]
  layers.forEach(([width, height, depth, material], index) => {
    const crown = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
    crown.position.set(0, 1.55 + index * 0.55, 0)
    crown.castShadow = true
    crown.receiveShadow = true
    group.add(crown)
  })
  parent.add(group)
  return group
}

export function addPixelFlowerPatch(THREE, parent, x, z, mats, count = 5) {
  const group = new THREE.Group()
  group.position.set(x, 0.02, z)
  const colors = [mats.flowerPink, mats.flowerYellow, mats.flowerWhite]
  for (let i = 0; i < count; i += 1) {
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.045), mats.leafDark)
    stem.position.set((i % 3 - 1) * 0.28, 0.11, (Math.floor(i / 3) - 0.5) * 0.3)
    const bloom = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), colors[i % colors.length])
    bloom.position.set(stem.position.x, 0.25, stem.position.z)
    group.add(stem, bloom)
  }
  parent.add(group)
  return group
}

export function addPixelBench(THREE, parent, x, z, mats) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 0.55), mats.wood)
  seat.position.y = 0.62
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.75, 0.14), mats.wood)
  back.position.set(0, 1.0, -0.22)
  const legs = [-0.65, 0.65].map((xPos) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 0.14), mats.outline)
    leg.position.set(xPos, 0.31, 0)
    return leg
  })
  group.add(seat, back, ...legs)
  group.traverse((object) => { if (object.isMesh) object.castShadow = true })
  parent.add(group)
  return group
}

export function addPixelLamp(THREE, parent, x, z, mats) {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.7, 0.13), mats.outline)
  pole.position.y = 1.35
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.32, 0.52), mats.windowTrim)
  head.position.y = 2.78
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.36), mats.flowerYellow)
  glow.position.y = 2.59
  group.add(pole, head, glow)
  parent.add(group)
  return group
}

/**
 * 统一的星露谷风格建筑生成器。
 * footprint 使用建筑局部 X/Z 平面坐标，shape 的 Y 轴代表 -Z。
 * 仅负责视觉资产，不代表真实建筑测绘尺寸。
 */
export const CAMPUS_BUILDING_TEMPLATES = Object.freeze({
  '教学楼': { height: 4.2, floors: 3, windowDensity: 1, roofRise: 0.82, roofStyle: 'pitched', wall: 'wallCream', doorWidth: 0.9, windowWidth: 0.48, windowHeight: 0.62 },
  '宿舍楼': { height: 4.8, floors: 4, windowDensity: 1.45, roofRise: 0.22, roofStyle: 'flat', wall: 'wallPeach', doorWidth: 0.86, windowWidth: 0.42, windowHeight: 0.58 },
  '办公楼': { height: 3.8, floors: 3, windowDensity: 1.15, roofRise: 0.28, roofStyle: 'flat', wall: 'wall', doorWidth: 0.86, windowWidth: 0.58, windowHeight: 0.72 },
  '实验楼': { height: 4.5, floors: 3, windowDensity: 0.9, roofRise: 0.5, roofStyle: 'pitched', wall: 'wallMint', doorWidth: 0.92, windowWidth: 0.52, windowHeight: 0.68 },
  '图书馆': { height: 4.6, floors: 3, windowDensity: 0.7, roofRise: 0.18, roofStyle: 'glass', wall: 'wallCream', doorWidth: 1.2, windowWidth: 0.82, windowHeight: 1.12 },
  '体育馆': { height: 3.2, floors: 1, windowDensity: 0.35, roofRise: 0.95, roofStyle: 'span', wall: 'wallPeach', doorWidth: 1.5, windowWidth: 0.9, windowHeight: 0.42 },
})

/**
 * 二维编辑器与 Three.js 共用的建筑资产目录。
 * template 是唯一建筑类型标识；尺寸仅用于编辑器预览，不代表测绘尺寸。
 */
export const CAMPUS_BUILDING_ASSET_CATALOG = Object.freeze(
  Object.entries(CAMPUS_BUILDING_TEMPLATES).map(([template, preset]) => Object.freeze({
    id: `building-${template}`,
    template,
    label: template,
    tileWidth: 5,
    tileHeight: 4,
    glyph: '▥',
    color: '#c8a66e',
    ...preset,
  })),
)

/**
 * 在二维 RPG 画布绘制建筑像素预览。
 * 使用同一 template 配置决定墙体/屋顶风格，与三维 createPixelBuilding 保持类型一致。
 */
/**
 * 二维编辑器的建筑平面预览。
 * 仅表达建筑占地，不绘制屋顶、墙面、门窗等三维表现元素。
 * 实际建筑形态统一由 createPixelBuilding 根据 footprint 生成。
 */
export function drawPixelBuildingPreview(context, options = {}) {
  const { x, y, width, height, tileSize, selected = false } = options
  if (!context || ![x, y, width, height, tileSize].every(Number.isFinite) || width <= 0 || height <= 0 || tileSize <= 0) {
    throw new TypeError('建筑二维预览参数无效')
  }
  const px = x * tileSize
  const py = y * tileSize
  const pw = width * tileSize
  const ph = height * tileSize
  context.save()
  context.fillStyle = '#c8a66e'
  context.globalAlpha = 0.34
  context.fillRect(px, py, pw, ph)
  context.globalAlpha = 1
  context.strokeStyle = selected ? '#d69c43' : '#806b4b'
  context.lineWidth = selected ? 3 : 1.5
  context.strokeRect(px, py, pw, ph)
  // 选中态通过加粗边框表达，保持 Canvas mock 与轻量渲染环境兼容。
  context.restore()
}

/**
 * 为简单凸四边形生成真正的双坡屋顶三角面。
 * 返回世界坐标 position 数组；凹多边形/非四边形返回 null，由调用方回退平顶。
 */
/**
 * 计算受限双坡屋顶的统一轮廓与屋脊布局。
 * 屋面三角面和屋脊装饰必须共用该结果，避免方向判断出现分叉。
 */
export function getGableRoofLayout(points = []) {
  if (!Array.isArray(points) || points.length !== 4) return null
  const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
  const turns = points.map((point, index) => cross(point, points[(index + 1) % 4], points[(index + 2) % 4]))
  if (turns.some(value => Math.abs(value) < 1e-5) || !(turns.every(value => value > 0) || turns.every(value => value < 0))) return null
  let contour = points.slice()
  const lengths = contour.map((point, index) => {
    const next = contour[(index + 1) % 4]
    return Math.hypot(next.x - point.x, next.y - point.y)
  })
  if (lengths[1] + lengths[3] > lengths[0] + lengths[2]) contour = [contour[1], contour[2], contour[3], contour[0]]
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  return {
    contour,
    ridgeStart: midpoint(contour[3], contour[0]),
    ridgeEnd: midpoint(contour[1], contour[2]),
  }
}

/**
 * 为简单凸四边形生成真正的双坡屋顶三角面。
 * 返回世界坐标 position 数组；凹多边形/非四边形返回 null，由调用方回退平顶。
 */
export function createGableRoofVertices(points = [], baseHeight = 0, rise = 0.8) {
  if (!Number.isFinite(baseHeight) || !Number.isFinite(rise) || rise <= 0) return null
  const layout = getGableRoofLayout(points)
  if (!layout) return null
  const { contour, ridgeStart, ridgeEnd } = layout
  const world = (point, elevated = false) => [point.x, elevated ? baseHeight + rise : baseHeight, -point.y]
  const triangles = [
    [world(contour[0]), world(contour[1]), world(ridgeEnd, true)],
    [world(contour[0]), world(ridgeEnd, true), world(ridgeStart, true)],
    [world(contour[2]), world(contour[3]), world(ridgeStart, true)],
    [world(contour[2]), world(ridgeStart, true), world(ridgeEnd, true)],
  ]
  const positions = []
  triangles.forEach((triangle) => {
    const [a, b, c] = triangle
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const normalY = ab[2] * ac[0] - ab[0] * ac[2]
    if (normalY >= 0) positions.push(...a, ...b, ...c)
    else positions.push(...a, ...c, ...b)
  })
  return positions
}

export function getBuildingFloorLayout(totalHeight, requestedFloors = 1, windowHeight = 0.6) {
  const height = Number(totalHeight)
  const floors = Math.max(1, Math.min(30, Math.floor(Number(requestedFloors) || 1)))
  if (!Number.isFinite(height) || height <= 0) throw new TypeError('建筑总高度必须大于 0')
  const floorHeight = height / floors
  return {
    floors,
    floorHeight,
    windowHeight: Math.min(Math.max(0.2, Number(windowHeight) || 0.6), floorHeight * 0.42),
    windowCenters: Array.from({ length: floors }, (_, index) => index * floorHeight + floorHeight * 0.56),
    bandHeights: Array.from({ length: Math.max(0, floors - 1) }, (_, index) => (index + 1) * floorHeight),
  }
}


/**
 * 校验建筑 footprint，阻止重复点、零面积和自相交轮廓进入三维生成流程。
 * points 使用 [x, y] 或 { x, y }，返回可用于编辑器提示的结构化结果。
 */
export function validateBuildingFootprint(points = []) {
  const normalized = Array.isArray(points) ? points.map(point => Array.isArray(point)
    ? { x: Number(point[0]), y: Number(point[1]) }
    : { x: Number(point?.x), y: Number(point?.y) }) : []
  const errors = []
  if (normalized.length < 3) return { valid: false, errors: ['建筑轮廓至少需要 3 个顶点'] }
  if (normalized.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return { valid: false, errors: ['建筑轮廓包含无效坐标'] }
  }
  const vertices = normalized.filter((point, index) => (
    index === 0 || Math.hypot(point.x - normalized[index - 1].x, point.y - normalized[index - 1].y) > 1e-4
  ))
  if (vertices.length > 2 && Math.hypot(vertices[0].x - vertices.at(-1).x, vertices[0].y - vertices.at(-1).y) <= 1e-4) vertices.pop()
  if (vertices.length < 3) return { valid: false, errors: ['建筑轮廓存在重复顶点'] }
  const area = vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2
  if (Math.abs(area) < 1e-3) errors.push('建筑轮廓面积为零或过小')
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const onSegment = (a, b, p) => p.x >= Math.min(a.x, b.x) - 1e-4 && p.x <= Math.max(a.x, b.x) + 1e-4
    && p.y >= Math.min(a.y, b.y) - 1e-4 && p.y <= Math.max(a.y, b.y) + 1e-4
  const intersects = (a, b, c, d) => {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
    if (((abC > 1e-4 && abD < -1e-4) || (abC < -1e-4 && abD > 1e-4))
      && ((cdA > 1e-4 && cdB < -1e-4) || (cdA < -1e-4 && cdB > 1e-4))) return true
    return (Math.abs(abC) <= 1e-4 && onSegment(a, b, c))
      || (Math.abs(abD) <= 1e-4 && onSegment(a, b, d))
      || (Math.abs(cdA) <= 1e-4 && onSegment(c, d, a))
      || (Math.abs(cdB) <= 1e-4 && onSegment(c, d, b))
  }
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length]
    for (let j = i + 1; j < vertices.length; j += 1) {
      if (j === i || j === i + 1 || (i === 0 && j === vertices.length - 1)) continue
      if (intersects(a, b, vertices[j], vertices[(j + 1) % vertices.length])) {
        errors.push('建筑轮廓存在自相交边线')
        return { valid: false, errors }
      }
    }
  }
  return { valid: errors.length === 0, errors }
}


/**
 * 根据立面净长度计算窗户中心位置。
 * 以窗框实际宽度控制最小间距，密度只影响数量，不允许窗户互相穿插。
 */
export function getFacadeWindowPositions(edgeLength, windowWidth, density = 1, reservedCenter = null, reservedHalfWidth = 0) {
  const length = Number(edgeLength)
  const width = Number(windowWidth)
  const factor = Number(density)
  if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return []
  const margin = width / 2 + 0.12
  const usableLength = length - margin * 2
  if (usableLength < width + 0.12) return []
  const physicalCapacity = Math.max(0, Math.floor((usableLength + 0.12) / (width + 0.32)))
  if (!physicalCapacity) return []
  const safeDensity = Number.isFinite(factor) ? Math.max(0.1, Math.min(3, factor)) : 1
  const count = Math.min(12, physicalCapacity, Math.max(1, Math.round(physicalCapacity * safeDensity)))
  const positions = Array.from({ length: count }, (_, index) => (
    margin + usableLength * (index + 0.5) / count
  ))
  if (reservedCenter === null || reservedCenter === undefined || reservedCenter === '' || !Number.isFinite(Number(reservedCenter))) return positions
  const keepAway = Math.max(0, Number(reservedHalfWidth) || 0) + width / 2 + 0.06
  return positions.filter(position => Math.abs(position - Number(reservedCenter)) >= keepAway)
}

/**
 * 统一约束建筑三维参数，避免 UI 输入或外部数据产生负尺寸、极端楼层和非法屋顶样式。
 * 未提供的字段保留模板默认值；数值越界时进行安全钳制。
 */
export function normalizeBuildingParameters(preset = {}, overrides = {}) {
  const read = (key, fallback, min, max) => {
    const value = overrides[key]
    const number = value !== '' && value !== null && value !== undefined ? Number(value) : NaN
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
  }
  const height = read('height', Number(preset.height) || 4, 1, 80)
  const floors = Math.min(
    Math.max(1, Math.floor(read('floors', Number(preset.floors) || 1, 1, 30))),
    Math.max(1, Math.floor(height / 0.8)),
  )
  const roofStyle = ['flat', 'pitched', 'span', 'glass'].includes(overrides.roofStyle)
    ? overrides.roofStyle
    : (['flat', 'pitched', 'span', 'glass'].includes(preset.roofStyle) ? preset.roofStyle : 'flat')
  return {
    ...preset,
    height,
    floors,
    roofStyle,
    roofRise: read('roofRise', Number(preset.roofRise) || 0, 0, Math.max(0.1, height * 0.6)),
    windowDensity: read('windowDensity', Number(preset.windowDensity) || 1, 0.1, 3),
    windowWidth: read('windowWidth', Number(preset.windowWidth) || 0.48, 0.28, 4),
    windowHeight: read('windowHeight', Number(preset.windowHeight) || 0.6, 0.2, 8),
    doorWidth: read('doorWidth', Number(preset.doorWidth) || 0.9, 0.5, 5),
  }
}

export function selectBuildingEntranceEdge(edges = [], requestedIndex = null) {
  if (!Array.isArray(edges) || !edges.length) return null
  const hasRequestedIndex = requestedIndex !== null && requestedIndex !== undefined && requestedIndex !== ''
  const index = Number(requestedIndex)
  if (hasRequestedIndex && Number.isInteger(index) && index >= 0 && index < edges.length) return edges[index]
  return edges.reduce((longest, edge) => edge.length > longest.length ? edge : longest, edges[0])
}

export function createPixelBuilding(THREE, options = {}) {
  const {
    footprint, width = 8, depth = 5, height,
    materials, wallMaterial, template = '教学楼',
    label = 'Campus Building', confidence = 'unverified', entranceEdgeIndex = null, floors, height: customHeight, roofStyle: customRoofStyle, roofRise: customRoofRise, windowDensity: customWindowDensity, windowWidth: customWindowWidth, windowHeight: customWindowHeight, doorWidth: customDoorWidth,
  } = options
  const basePreset = CAMPUS_BUILDING_TEMPLATES[template] || CAMPUS_BUILDING_TEMPLATES['教学楼']
  const hasNumericOverride = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value))
  const requestedHeight = hasNumericOverride(customHeight) ? customHeight : height
  const preset = normalizeBuildingParameters(basePreset, {
    height: requestedHeight,
    floors,
    roofRise: customRoofRise,
    windowDensity: customWindowDensity,
    windowWidth: customWindowWidth,
    windowHeight: customWindowHeight,
    doorWidth: customDoorWidth,
    roofStyle: customRoofStyle,
  })
  const buildingHeight = preset.height
  const facadeMaterial = wallMaterial || materials[preset.wall] || materials.wall
  const group = new THREE.Group()
  group.name = label
  group.userData.assetStyle = 'stardew-pixel-campus'
  group.userData.confidence = confidence
  const shape = footprint && typeof footprint.getPoints === 'function' ? footprint : new THREE.Shape([
    new THREE.Vector2(-width / 2, -depth / 2),
    new THREE.Vector2(width / 2, -depth / 2),
    new THREE.Vector2(width / 2, depth / 2),
    new THREE.Vector2(-width / 2, depth / 2),
  ])
  const footprintValidation = validateBuildingFootprint(shape.extractPoints(1).shape)
  if (!footprintValidation.valid) {
    throw new TypeError(`建筑“${label}”轮廓无效：${footprintValidation.errors.join('；')}`)
  }
  const wall = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: buildingHeight, bevelEnabled: false, curveSegments: 1 }),
    facadeMaterial,
  )
  wall.geometry.rotateX(-Math.PI / 2)
  wall.castShadow = true
  wall.receiveShadow = true
  group.add(wall)

  // 屋面始终从 footprint 三角剖分生成：边界顶点严格落在墙顶，凹多边形不会被外接矩形填平。
  const roofStyle = preset.roofStyle || 'flat'
  const roofRise = Math.max(0, Number(preset.roofRise || 0))
  const roofPoints = shape.extractPoints(1)
  const contour = roofPoints.shape.filter((point, index, points) => (
    index === 0 || point.distanceTo(points[index - 1]) > 0.001
  ))
  if (contour.length > 2 && contour[0].distanceTo(contour[contour.length - 1]) < 0.001) contour.pop()
  const roofContours = [contour, ...(roofPoints.holes || [])]
  const triangulationPoints = roofContours.flat()
  let roofPositions = []
  const addRoofTriangle = (a, b, c) => {
    const ab = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z)
    const ac = new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z)
    const normal = new THREE.Vector3().crossVectors(ab, ac)
    if (normal.y < 0) [b, c] = [c, b]
    roofPositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  }
  let actualRoofStyle = roofStyle
  roofPositions = (roofStyle === 'pitched' || roofStyle === 'span') ? createGableRoofVertices(contour, buildingHeight, roofRise) : null
  if (roofPositions) {
    actualRoofStyle = roofStyle === 'span' ? 'gable-span' : 'gable'
  } else {
    // 复杂轮廓、内环及暂不支持的跨度屋顶均安全回退到贴合 footprint 的平顶。
    actualRoofStyle = roofStyle === 'glass' ? 'glass' : 'flat'
    const triangles = THREE.ShapeUtils.triangulateShape(contour, roofPoints.holes || [])
    triangles.forEach(([ia, ib, ic]) => {
      const points = [triangulationPoints[ia], triangulationPoints[ib], triangulationPoints[ic]]
      addRoofTriangle(...points.map(point => new THREE.Vector3(point.x, buildingHeight + 0.06, -point.y)))
    })
  }
  const roofGeometry = new THREE.BufferGeometry()
  roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3))
  roofGeometry.computeVertexNormals()
  const roofMaterial = actualRoofStyle === 'glass' ? materials.window : materials.roof
  const roof = new THREE.Mesh(roofGeometry, roofMaterial)
  roof.castShadow = true
  roof.receiveShadow = true
  roof.userData.objectType = 'building-roof'
  roof.userData.roofStyle = actualRoofStyle
  group.add(roof)
  group.userData.roofStyle = actualRoofStyle

  // 图书馆玻璃屋顶：沿真实轮廓边界及三角剖分内部边生成框架，不使用外接矩形。
  if (actualRoofStyle === 'glass') {
    const triangles = THREE.ShapeUtils.triangulateShape(contour, roofPoints.holes || [])
    const edgeKeys = new Set()
    triangles.forEach(([ia, ib, ic]) => {
      [[ia, ib], [ib, ic], [ic, ia]].forEach(([aIndex, bIndex]) => {
        const key = [Math.min(aIndex, bIndex), Math.max(aIndex, bIndex)].join(':')
        if (edgeKeys.has(key)) return
        edgeKeys.add(key)
        const a = triangulationPoints[aIndex]
        const b = triangulationPoints[bIndex]
        if (!a || !b) return
        const dx = b.x - a.x
        const dy = b.y - a.y
        const length = Math.hypot(dx, dy)
        if (length < 0.15) return
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(length, 0.075, 0.075),
          materials.windowTrim,
        )
        beam.position.set((a.x + b.x) / 2, buildingHeight + 0.12, -(a.y + b.y) / 2)
        beam.rotation.y = Math.atan2(dy, dx)
        beam.userData.objectType = 'building-roof-frame'
        group.add(beam)
      })
    })
    group.userData.roofFrame = 'triangulated'
  }

  // 沿 footprint 的真实边段生成窗户，绝不使用外接矩形布置。
  // 先统一为不重复闭合点，避免最后一条边长度为 0。
  const outline = shape.getPoints(1).filter((point, index, points) => (
    index === 0 || point.distanceTo(points[index - 1]) > 0.001
  ))
  if (outline.length > 2 && outline[0].distanceTo(outline[outline.length - 1]) < 0.001) outline.pop()
  const windowWidth = Math.max(0.28, Number(preset.windowWidth || 0.48))
  const requestedFloors = hasNumericOverride(floors) ? floors : preset.floors
  const floorLayout = getBuildingFloorLayout(buildingHeight, requestedFloors ?? 1, preset.windowHeight)
  group.userData.floorCount = floorLayout.floors
  group.userData.floorHeight = floorLayout.floorHeight
  const windowHeight = floorLayout.windowHeight
  const area = outline.reduce((sum, point, index) => {
    const next = outline[(index + 1) % outline.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2
  const edges = outline.map((point, index) => {
    const next = outline[(index + 1) % outline.length]
    const dx = next.x - point.x
    const dy = next.y - point.y
    return { point, next, dx, dy, length: Math.hypot(dx, dy), index }
  })
  const entranceEdge = selectBuildingEntranceEdge(edges, entranceEdgeIndex) || { length: 0 }
  const doorWidth = Math.min(Number(preset.doorWidth || 0.9), Math.max(0.5, entranceEdge.length * 0.42))
  const doorHeight = Math.min(2.05, buildingHeight * 0.58)
  if (entranceEdge.length >= doorWidth * 1.6) {
    const normalX = area >= 0 ? entranceEdge.dy / entranceEdge.length : -entranceEdge.dy / entranceEdge.length
    const normalZ = area >= 0 ? entranceEdge.dx / entranceEdge.length : -entranceEdge.dx / entranceEdge.length
    const centerX = (entranceEdge.point.x + entranceEdge.next.x) / 2 + normalX * 0.07
    const centerZ = -(entranceEdge.point.y + entranceEdge.next.y) / 2 + normalZ * 0.07
    const angle = Math.atan2(entranceEdge.dy, entranceEdge.dx)
    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth + 0.18, doorHeight + 0.16, 0.12),
      materials.windowTrim,
    )
    doorFrame.position.set(centerX, doorHeight / 2, centerZ)
    doorFrame.rotation.y = angle
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth, doorHeight, 0.14),
      materials.door,
    )
    door.position.copy(doorFrame.position)
    door.rotation.y = angle
    door.userData.objectType = 'building-entrance'
    group.add(doorFrame, door)

    // 入口雨棚沿选定立面法线向外挑出，避免悬空或脱离不规则建筑墙面。
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth + 0.72, 0.14, 0.92),
      materials.roofDark || materials.roof,
    )
    canopy.position.set(
      centerX + normalX * 0.48,
      doorHeight + 0.24,
      centerZ + normalZ * 0.48,
    )
    canopy.rotation.y = angle
    canopy.userData.objectType = 'building-entrance-canopy'
    group.add(canopy)
    group.userData.entrance = { edgeIndex: entranceEdge.index, width: doorWidth, height: doorHeight, source: entranceEdgeIndex !== null && entranceEdgeIndex !== undefined && entranceEdgeIndex !== '' && Number.isInteger(Number(entranceEdgeIndex)) && Number(entranceEdgeIndex) >= 0 && Number(entranceEdgeIndex) < edges.length ? 'configured' : 'auto' }
  }
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length]
    const dx = next.x - point.x
    const dy = next.y - point.y
    const edgeLength = Math.hypot(dx, dy)
    // 根据窗框实际宽度计算可用位置，密度不会突破最小安全间距。
    const reservedHalfWidth = index === entranceEdge.index ? doorWidth / 2 : 0
    const windowPositions = getFacadeWindowPositions(
      edgeLength,
      windowWidth + 0.12,
      preset.windowDensity,
      index === entranceEdge.index ? edgeLength / 2 : null,
      reservedHalfWidth,
    )
    if (!windowPositions.length) return
    // shape 坐标的 Y 对应世界 -Z；根据多边形绕序计算外法线。
    const normalX = area >= 0 ? dy / edgeLength : -dy / edgeLength
    const normalZ = area >= 0 ? dx / edgeLength : -dx / edgeLength
    const angle = Math.atan2(dy, dx)
    windowPositions.forEach((distanceAlongEdge) => {
      const t = distanceAlongEdge / edgeLength
      const centerX = point.x + dx * t + normalX * 0.055
      const centerZ = -(point.y + dy * t) + normalZ * 0.055
      floorLayout.windowCenters.forEach((centerY, floorIndex) => {
        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(windowWidth + 0.12, windowHeight + 0.12, 0.075),
          materials.windowTrim,
        )
        frame.position.set(centerX, centerY, centerZ)
        frame.rotation.y = angle
        const glass = new THREE.Mesh(
          new THREE.BoxGeometry(windowWidth, windowHeight, 0.085),
          materials.window,
        )
        glass.position.copy(frame.position)
        glass.rotation.y = angle
        frame.userData.floor = floorIndex + 1
        glass.userData.floor = floorIndex + 1
        group.add(frame, glass)
      })
    })
  })
  // 檐口沿 footprint 每条边生成，收口建筑墙顶，避免矩形檐口越界。
  edges.forEach((edge) => {
    if (edge.length < 0.2) return
    const cornice = new THREE.Mesh(
      new THREE.BoxGeometry(edge.length + 0.08, 0.16, 0.16),
      materials.windowTrim,
    )
    cornice.position.set(
      (edge.point.x + edge.next.x) / 2,
      buildingHeight - 0.035,
      -(edge.point.y + edge.next.y) / 2,
    )
    cornice.rotation.y = Math.atan2(edge.dy, edge.dx)
    cornice.userData.objectType = 'building-cornice'
    group.add(cornice)
  })

  // 双坡屋顶增加屋脊压顶；仅在真实生成双坡顶时绘制。
  if (actualRoofStyle === 'gable' || actualRoofStyle === 'gable-span') {
    const ridgeLayout = getGableRoofLayout(outline)
    if (ridgeLayout) {
      const { ridgeStart: start, ridgeEnd: end } = ridgeLayout
      const ridgeLength = Math.hypot(end.x - start.x, end.y - start.y)
      if (ridgeLength > 0.2) {
        const ridge = new THREE.Mesh(
          new THREE.BoxGeometry(ridgeLength, 0.13, 0.18),
          materials.roofDark || materials.roof,
        )
        ridge.position.set((start.x + end.x) / 2, buildingHeight + roofRise + 0.035, -(start.y + end.y) / 2)
        ridge.rotation.y = Math.atan2(end.y - start.y, end.x - start.x)
        ridge.userData.objectType = 'building-roof-ridge'
        group.add(ridge)
      }
    }
  }

  // 层间线沿建筑每条真实边段生成，避免用矩形轮廓覆盖不规则建筑。
  floorLayout.bandHeights.forEach((bandY) => {
    edges.forEach((edge) => {
      if (edge.length < 0.2) return
      const centerX = (edge.point.x + edge.next.x) / 2
      const centerZ = -(edge.point.y + edge.next.y) / 2
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(edge.length, 0.055, 0.09),
        materials.windowTrim,
      )
      band.position.set(centerX, bandY, centerZ)
      band.rotation.y = Math.atan2(edge.dy, edge.dx)
      band.userData.objectType = 'building-floor-band'
      group.add(band)
    })
  })
  group.traverse((object) => {
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true }
  })
  return group
}
