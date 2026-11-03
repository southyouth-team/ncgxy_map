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
  '教学楼': { height: 4.2, windowDensity: 1, roofRise: 1.35, wall: 'wallCream', doorWidth: 0.9 },
  '宿舍楼': { height: 4.8, windowDensity: 1.45, roofRise: 1.2, wall: 'wallPeach', doorWidth: 0.86 },
  '办公楼': { height: 3.8, windowDensity: 1.15, roofRise: 1.25, wall: 'wall', doorWidth: 0.86 },
  '实验楼': { height: 4.5, windowDensity: 0.9, roofRise: 1.4, wall: 'wallMint', doorWidth: 0.92 },
  '图书馆': { height: 4.6, windowDensity: 0.7, roofRise: 1.55, wall: 'wallCream', doorWidth: 1.2 },
  '体育馆': { height: 3.2, windowDensity: 0.35, roofRise: 1.8, wall: 'wallPeach', doorWidth: 1.5 },
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
    width: 5,
    height: 4,
    glyph: '▥',
    color: '#c8a66e',
    ...preset,
  })),
)

/**
 * 在二维 RPG 画布绘制建筑像素预览。
 * 使用同一 template 配置决定墙体/屋顶风格，与三维 createPixelBuilding 保持类型一致。
 */
export function drawPixelBuildingPreview(context, options = {}) {
  const { x, y, width, height, tileSize, template = '教学楼', selected = false } = options
  if (!context || ![x, y, width, height, tileSize].every(Number.isFinite) || width <= 0 || height <= 0 || tileSize <= 0) {
    throw new TypeError('建筑二维预览参数无效')
  }
  const preset = CAMPUS_BUILDING_TEMPLATES[template] || CAMPUS_BUILDING_TEMPLATES['教学楼']
  const px = x * tileSize
  const py = y * tileSize
  const pw = width * tileSize
  const ph = height * tileSize
  const wallColors = {
    wall: '#e7d2a5', wallCream: '#e7d2a5', wallPeach: '#d8a77d', wallMint: '#b8c99a',
  }
  const wall = wallColors[preset.wall] || wallColors.wallCream
  const roof = '#a85f4e'
  context.save()
  context.fillStyle = '#5b5141'
  context.fillRect(px + 1, py + 1, pw - 2, ph - 2)
  context.fillStyle = wall
  context.fillRect(px + 3, py + Math.max(5, tileSize * 0.34), pw - 6, ph - Math.max(8, tileSize * 0.38))
  context.fillStyle = roof
  context.fillRect(px + 1, py + 1, pw - 2, Math.max(5, tileSize * 0.42))
  context.fillStyle = '#784b43'
  context.fillRect(px + 1, py + Math.max(5, tileSize * 0.42), pw - 2, 3)
  const windowCount = Math.max(1, Math.min(5, Math.round(width * preset.windowDensity / 2.5)))
  const windowY = py + Math.max(8, ph * 0.48)
  for (let index = 0; index < windowCount; index += 1) {
    const windowX = px + ((index + 1) / (windowCount + 1)) * pw
    context.fillStyle = '#f3dfb5'
    context.fillRect(windowX - 3, windowY - 3, 6, 7)
    context.fillStyle = '#8bc3c5'
    context.fillRect(windowX - 2, windowY - 2, 4, 5)
  }
  context.fillStyle = '#76533d'
  context.fillRect(px + pw / 2 - Math.max(3, tileSize * 0.12), py + ph - Math.max(8, tileSize * 0.48), Math.max(6, tileSize * 0.24), Math.max(8, tileSize * 0.48))
  if (selected) {
    context.strokeStyle = '#f2d98a'
    context.lineWidth = 2
    context.strokeRect(px + 1, py + 1, pw - 2, ph - 2)
  }
  context.restore()
}

export function createPixelBuilding(THREE, options = {}) {
  const {
    footprint, width = 8, depth = 5, height,
    materials, wallMaterial, template = '教学楼',
    label = 'Campus Building', confidence = 'unverified',
  } = options
  const preset = CAMPUS_BUILDING_TEMPLATES[template] || CAMPUS_BUILDING_TEMPLATES['教学楼']
  const buildingHeight = Number(height || preset.height)
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
  const wall = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: buildingHeight, bevelEnabled: false, curveSegments: 1 }),
    facadeMaterial,
  )
  wall.geometry.rotateX(-Math.PI / 2)
  wall.castShadow = true
  wall.receiveShadow = true
  group.add(wall)

  const roofWidth = width + 0.42
  const roofDepth = depth + 0.42
  const roofShape = new THREE.Shape()
  roofShape.moveTo(-roofWidth / 2, 0)
  roofShape.lineTo(0, preset.roofRise)
  roofShape.lineTo(roofWidth / 2, 0)
  roofShape.closePath()
  const roofGeometry = new THREE.ExtrudeGeometry(roofShape, { depth: roofDepth, bevelEnabled: false, steps: 1 })
  roofGeometry.translate(0, buildingHeight - 0.08, -roofDepth / 2)
  const roof = new THREE.Mesh(roofGeometry, materials.roof)
  roof.castShadow = true
  roof.receiveShadow = true
  group.add(roof)

  const eave = new THREE.Mesh(new THREE.BoxGeometry(roofWidth + 0.18, 0.16, roofDepth + 0.2), materials.roofDark)
  eave.position.y = buildingHeight - 0.05
  group.add(eave)

  const windows = Math.max(1, Math.min(8, Math.round(width / 2.5 * preset.windowDensity)))
  for (let i = 0; i < windows; i += 1) {
    const x = -width / 2 + (i + 1) * width / (windows + 1)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.92, 0.12), materials.windowTrim)
    frame.position.set(x, 1.95, depth / 2 + 0.075)
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.06), materials.window)
    glass.position.set(x, 1.95, depth / 2 + 0.15)
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.68, 0.04), materials.windowTrim)
    mullion.position.set(x, 1.95, depth / 2 + 0.19)
    group.add(frame, glass, mullion)
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(preset.doorWidth, 1.55, 0.16), materials.door)
  door.position.set(0, 0.78, depth / 2 + 0.09)
  group.add(door)
  group.traverse((object) => {
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true }
  })
  return group
}
