import { createPixelBuilding } from './campusAssetLibrary.js'

// 宝可梦经典城镇探索风格的 2.5D 校园样板区。
// 该场景是视觉与交互验证样板，不代表真实校园测绘数据。
export function createRpgSampleScene(THREE) {
  const root = new THREE.Group()
  root.name = 'PokemonStyleCampusSample'
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...extra })
  const makePixelTexture = (base, pixels, size = 64) => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    pixels(ctx, size)
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    return texture
  }
  const wallTexture = makePixelTexture('#dce2e3', (ctx, size) => {
    for (let y = 8; y < size; y += 16) {
      ctx.fillStyle = '#cbd3d5'
      ctx.fillRect(0, y, size, 2)
    }
    for (let x = 8; x < size; x += 24) {
      ctx.fillStyle = '#eaf0ef'
      ctx.fillRect(x, 2, 3, size - 4)
    }
    for (let x = 4; x < size; x += 32) {
      ctx.fillStyle = '#b9c5c8'
      ctx.fillRect(x, 4, 2, 2)
    }
  })
  const roofTexture = makePixelTexture('#59666d', (ctx, size) => {
    for (let y = 5; y < size; y += 12) {
      ctx.fillStyle = '#68777e'
      ctx.fillRect(0, y, size, 2)
    }
    for (let x = 6; x < size; x += 20) {
      ctx.fillStyle = '#48565d'
      ctx.fillRect(x, 2, 2, size - 4)
    }
  })
  const leafTexture = makePixelTexture('#39744a', (ctx, size) => {
    const colors = ['#69a653', '#4c8a4e', '#2d5e42', '#83b75b']
    for (let y = 2; y < size; y += 8) {
      for (let x = 2; x < size; x += 8) {
        const index = ((x * 3 + y * 5) / 8) % colors.length | 0
        if ((x + y) % 3 !== 0) {
          ctx.fillStyle = colors[index]
          ctx.fillRect(x, y, 5, 5)
        }
      }
    }
  })
  const materials = {
    grass: mat('#78a957'), grassLight: mat('#91b96a'), grassDark: mat('#5f914b'),
    path: mat('#343d43'), pathLight: mat('#858f93'), pathDark: mat('#626e73'),
    wall: mat('#ffffff', { map: wallTexture }), wallShade: mat('#aebbc0'),
    roof: mat('#ffffff', { map: roofTexture }), roofLight: mat('#ffffff', { map: roofTexture }),
    roofDark: mat('#46545b'), trim: mat('#eef2f1'),
    glass: mat('#6da9b5'), door: mat('#496a78'), wood: mat('#52666d'),
    trunk: mat('#795238'), leaf: mat('#ffffff', { map: leafTexture }),
    leafLight: mat('#69a653'), leafDark: mat('#2d5e42'),
    flower: mat('#e9a2a0'), stone: mat('#a89d83'),
    shadow: new THREE.MeshBasicMaterial({ color: '#334b35', transparent: true, opacity: 0.2, depthWrite: false }),
  }
  const addBox = (name, x, y, z, w, h, d, material, parent = root) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.name = name
    mesh.position.set(x, y + h / 2, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  // 场景底板与草地图块：统一硬边和低频配色，避免写实材质混入。
  addBox('sample-earth-base', 0, -0.65, 0, 54, 0.65, 42, materials.grassDark)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(53.5, 41.5), materials.grass)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0.012
  ground.receiveShadow = true
  root.add(ground)
  const grassPatchPositions = []
  for (let z = -18; z <= 18; z += 3) {
    for (let x = -24; x <= 24; x += 3) {
      const cellX = Math.round((x + 24) / 3)
      const cellZ = Math.round((z + 18) / 3)
      // 规则但不机械的疏密节奏，避免草地变成棋盘格。
      if ((cellX * 7 + cellZ * 11) % 4 === 0 || (cellX + cellZ) % 9 === 0) {
        grassPatchPositions.push({ x, z, tone: (cellX * 3 + cellZ) % 3 })
      }
    }
  }
  const grassPatchMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.55, 0.025, 1.05),
    materials.grassLight,
    grassPatchPositions.length,
  )
  const grassPatchTransform = new THREE.Object3D()
  const grassPatchTones = ['#91b96a', '#86b365', '#9bc477'].map(color => new THREE.Color(color))
  grassPatchPositions.forEach((patch, index) => {
    grassPatchTransform.position.set(patch.x, 0.0375, patch.z)
    grassPatchTransform.updateMatrix()
    grassPatchMesh.setMatrixAt(index, grassPatchTransform.matrix)
    grassPatchMesh.setColorAt(index, grassPatchTones[patch.tone])
  })
  grassPatchMesh.name = 'grass-pixel-tile-instances'
  grassPatchMesh.castShadow = false
  grassPatchMesh.receiveShadow = true
  root.add(grassPatchMesh)
  // 现代校园道路：深灰沥青车行道、混凝土人行道与交通标线。
  addBox('main-campus-road-edge', 0, 0.012, 8, 48, 0.04, 5.8, materials.pathDark)
  addBox('main-campus-road', 0, 0.04, 8, 48, 0.035, 5.25, materials.path)
  addBox('building-walkway-edge', 0, 0.012, 1.7, 6.2, 0.035, 9.2, materials.pathDark)
  addBox('building-walkway', 0, 0.04, 1.7, 5.8, 0.035, 9.2, materials.pathLight)
  addBox('road-center-line', 0, 0.061, 8, 47.5, 0.018, 0.09, materials.trim)
  for (let x = -21; x <= 21; x += 5.2) addBox('road-lane-dash', x, 0.064, 8, 2.4, 0.018, 0.12, materials.trim)
  for (const z of [5.05, 10.95]) addBox('campus-concrete-sidewalk', 0, 0.045, z, 48, 0.035, 0.72, materials.pathLight)
  for (let z = -2.2; z < 6; z += 1.35) {
    addBox('walkway-joint', 0, 0.043, z, 5.1, 0.006, 0.055, materials.pathDark)
  }
  // 主路像素铺装：用实例化小砖块构成低频色彩变化与横向拼缝。
  const roadTiles = []
  for (let x = -22; x <= 22; x += 2.2) {
    for (const z of [6.35, 7.55, 8.75, 9.65]) {
      const seed = Math.round((x + 22) * 3 + z * 7)
      roadTiles.push({ x, z, tone: Math.abs(seed) % 4 })
    }
  }
  const roadTileMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.92, 0.012, 0.82),
    materials.pathLight,
    roadTiles.length,
  )
  const roadTileTransform = new THREE.Object3D()
  const roadTileTones = ['#414b50', '#4a555a', '#394348', '#505b60'].map(color => new THREE.Color(color))
  roadTiles.forEach((tile, index) => {
    roadTileTransform.position.set(tile.x, 0.044, tile.z)
    roadTileTransform.updateMatrix()
    roadTileMesh.setMatrixAt(index, roadTileTransform.matrix)
    roadTileMesh.setColorAt(index, roadTileTones[tile.tone])
  })
  roadTileMesh.name = 'main-road-pixel-paving'
  roadTileMesh.castShadow = false
  roadTileMesh.receiveShadow = true
  root.add(roadTileMesh)
  // 现代路缘石、步行边界与人行横道。
  for (const z of [4.66, 11.34]) addBox('main-road-curb', 0, 0.035, z, 48, 0.09, 0.14, materials.pathDark)
  for (const x of [-2.98, 2.98]) addBox('walkway-side-border', x, 0.038, 1.7, 0.12, 0.06, 9.2, materials.pathDark)
  for (let x = -2.2; x <= 2.2; x += 0.88) addBox('campus-crosswalk-stripe', x, 0.066, 8, 0.48, 0.018, 3.2, materials.trim)
  // 教学楼由共享建筑资产生成器创建；室外、室内编辑和扩建共用同一轮廓定义。
  const building = new THREE.Group()
  building.name = 'sample-teaching-building'
  building.position.set(0, 0, -8)
  building.userData.objectType = 'building'
  building.userData.buildingId = 'sample-teaching-building'
  building.userData.displayName = '现代教学楼'
  building.userData.indoorEntrance = { x: 0, z: 5.35, radius: 2.15 }
  const buildingMaterials = {
    wall: materials.wall,
    wallCream: materials.wall,
    roof: materials.roof,
    roofDark: materials.roofDark,
    window: materials.glass,
    windowTrim: materials.trim,
    door: materials.door,
  }
  const teachingFootprint = new THREE.Shape([
    new THREE.Vector2(-7.4, -4.25),
    new THREE.Vector2(7.4, -4.25),
    new THREE.Vector2(7.4, 4.25),
    new THREE.Vector2(-7.4, 4.25),
  ])
  const foundation = addBox('teaching-building-foundation', 0, 0.18, 0, 15.5, 0.55, 9.2, materials.wallShade, building)
  const generatedBuilding = createPixelBuilding(THREE, {
    footprint: teachingFootprint,
    width: 14.8,
    depth: 8.5,
    height: 16.8,
    floors: 4,
    template: '教学楼',
    label: '现代教学楼',
    confidence: 'sample-prototype',
    entranceEdgeIndex: 2,
    roofStyle: 'flat',
    materials: buildingMaterials,
    wallMaterial: materials.wall,
    windowDensity: 0.42,
    windowWidth: 1.02,
    windowHeight: 0.82,
    doorWidth: 1.28,
  })
  generatedBuilding.position.y = 0.73
  building.add(generatedBuilding)
  building.userData.generatedBuildingShell = generatedBuilding
  building.userData.generatedBuildingBaseY = 0.73
  building.userData.foundationMesh = foundation
  building.userData.rebuildOptions = {
    materials: buildingMaterials,
    wallMaterial: materials.wall,
    template: '教学楼',
    label: '现代教学楼',
    confidence: 'sample-prototype',
    height: 16.8,
    floors: 4,
    roofStyle: 'flat',
    roofRise: 0,
    windowDensity: 0.42,
    windowWidth: 1.02,
    windowHeight: 0.82,
    doorWidth: 1.28,
    entranceEdgeIndex: 2,
  }
  building.userData.floorCount = generatedBuilding.userData.floorCount
  building.userData.floorHeight = generatedBuilding.userData.floorHeight
  building.userData.buildingHeight = generatedBuilding.userData.buildingHeight
  building.userData.roofStyle = generatedBuilding.userData.roofStyle
  root.add(building)
  // 现代校园景观廊架：钢结构、玻璃顶与混凝土坐凳。
  const pavilion = new THREE.Group()
  pavilion.name = 'modern-campus-pavilion'
  pavilion.position.set(-10, 0, 7)
  pavilion.userData.objectType = 'campus-facility'
  for (const x of [-2.2, 2.2]) for (const z of [-1.65, 1.65]) {
    addBox('pavilion-steel-column', x, 0.12, z, 0.16, 3.1, 0.16, materials.roofDark, pavilion)
  }
  addBox('pavilion-flat-canopy', 0, 3.18, 0, 5.1, 0.22, 4.1, materials.roofDark, pavilion)
  addBox('pavilion-glass-roof-panel', 0, 3.31, 0, 4.65, 0.06, 3.65, materials.glass, pavilion)
  addBox('pavilion-bench-left', -1.25, 0.38, 0.45, 1.65, 0.32, 0.48, materials.wood, pavilion)
  addBox('pavilion-bench-right', 1.25, 0.38, 0.45, 1.65, 0.32, 0.48, materials.wood, pavilion)
  root.add(pavilion)
  // 现代校园 LED 路灯。
  for (const x of [-19, -9, 9, 19]) {
    const lamp = new THREE.Group()
    lamp.position.set(x, 0, 4.35)
    addBox('campus-lamp-post', 0, 0.1, 0, 0.12, 4.3, 0.12, materials.roofDark, lamp)
    addBox('campus-lamp-arm', 0.48, 4.15, 0, 1.05, 0.1, 0.1, materials.roofDark, lamp)
    addBox('campus-led-head', 0.95, 4.03, 0, 0.48, 0.16, 0.36, materials.trim, lamp)
    root.add(lamp)
  }
  // 现代景观水渠与直线型人行桥，桥面为混凝土板、栏杆为金属结构。
  addBox('campus-water-channel', 18, -0.015, -7, 7.2, 0.035, 13, mat('#6daeb8'), root)
  addBox('campus-bridge-deck', 18, 0.18, -7, 3.1, 0.32, 5.2, materials.pathLight, root)
  for (const x of [16.55, 19.45]) {
    addBox('campus-bridge-railing', x, 0.65, -7, 0.1, 0.82, 5.2, materials.roofDark, root)
    for (let z = -9.1; z <= -4.9; z += 1.4) addBox('campus-bridge-railing-post', x, 0.35, z, 0.12, 0.55, 0.12, materials.roofDark, root)
  }
  // 像素树：方块树冠分层，树干与投影明确，树冠不参与角色碰撞。
  const addTree = (x, z, scale = 1) => {
    const tree = new THREE.Group()
    tree.position.set(x, 0, z)
    tree.scale.setScalar(scale)
    tree.userData.objectType = 'tree'
    tree.userData.collisionRadius = 0.62 * scale
    tree.userData.occlusionMode = 'depth-tested-canopy'
    tree.userData.canopyHeight = 3.6 * scale
    const shadow = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.035, 2.5), materials.shadow)
    shadow.position.set(0.35, 0.04, 0.45)
    tree.add(shadow)
    addBox('tree-trunk', 0, 0.05, 0, 0.55, 1.8, 0.55, materials.trunk, tree)
    addBox('tree-trunk-root-west', -0.22, 0.05, 0.08, 0.34, 0.42, 0.42, materials.trunk, tree)
    addBox('tree-trunk-root-east', 0.2, 0.05, -0.08, 0.32, 0.35, 0.38, materials.trunk, tree)
    const canopy = new THREE.Group()
    canopy.name = 'tree-canopy-occluder'
    canopy.userData.occlusionLayer = 'foreground-canopy'
    addBox('tree-crown-dark', 0, 1.55, 0, 2.6, 1.5, 2.45, materials.leafDark, canopy)
    addBox('tree-crown-main', 0, 2.15, 0, 2.35, 1.5, 2.25, materials.leaf, canopy)
    addBox('tree-crown-highlight', -0.18, 2.85, -0.12, 1.65, 0.75, 1.65, materials.leafLight, canopy)
    // 外轮廓加入不对称叶簇，形成像素树冠的阶梯边缘，而不是完整方盒。
    addBox('tree-leaf-cluster-west', -1.05, 1.9, 0.18, 0.72, 0.72, 1.15, materials.leaf, canopy)
    addBox('tree-leaf-cluster-east', 1.02, 2.0, -0.12, 0.78, 0.82, 0.95, materials.leafDark, canopy)
    addBox('tree-leaf-cluster-front', 0.28, 2.18, 1.02, 0.95, 0.68, 0.62, materials.leafLight, canopy)
    addBox('tree-leaf-cluster-back', -0.42, 2.5, -0.98, 0.82, 0.62, 0.58, materials.leaf, canopy)
    tree.add(canopy)
    root.add(tree)
  }
  ;[[-12, -12], [12, -12], [-17, 2], [17, 2], [-12, 14], [12, 14]].forEach(([x, z], i) => addTree(x, z, i % 2 ? 0.9 : 1.05))
  // 花坛和路边矮篱笆，丰富校园尺度但控制物件数量。
  for (const x of [-8.5, 8.5]) {
    addBox('flower-bed', x, 0.08, 1.5, 2.8, 0.22, 1.5, materials.grassDark)
    for (let i = 0; i < 5; i += 1) {
      addBox('pixel-flower', x - 0.9 + i * 0.45, 0.31, 1.2 + (i % 2) * 0.45, 0.22, 0.18, 0.22, materials.flower)
    }
  }
  // 角色采用 4 方向 × 2 帧像素图集，NearestFilter 保留硬朗像素边缘。
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  const drawFrame = (ox, oy, direction, step) => {
    const px = (x, y, w, h, color) => {
      ctx.fillStyle = color
      ctx.fillRect(ox + x, oy + y, w, h)
    }
    // 头发与脸部按朝向切换，侧面和背面不绘制正面五官。
    px(5, 1, 6, 2, '#493d36')
    px(4, 3, 8, 6, '#e8b987')
    px(3, 4, 2, 4, '#493d36')
    px(11, 4, 2, 4, '#493d36')
    if (direction === 0) {
      px(5, 5, 1, 1, '#302b2a')
      px(10, 5, 1, 1, '#302b2a')
    } else if (direction === 1) {
      px(4, 5, 2, 2, '#302b2a')
    } else if (direction === 2) {
      px(10, 5, 2, 2, '#302b2a')
    } else {
      px(4, 2, 8, 2, '#493d36')
    }
    px(4, 9, 8, 7, '#3d6f9b')
    px(3, 10, 2, 6, '#e8b987')
    px(11, 10, 2, 6, '#e8b987')
    // 两帧腿部交替，形成简洁的行走节奏。
    const leftLegX = step ? 4 : 5
    const rightLegX = step ? 9 : 10
    px(leftLegX, 16, 3, step ? 6 : 5, '#39434c')
    px(rightLegX, step ? 16 : 17, 3, step ? 5 : 6, '#39434c')
    px(leftLegX - 1, 22, 4, 2, '#6d4938')
    px(rightLegX, 22, 4, 2, '#6d4938')
  }
  for (let direction = 0; direction < 4; direction += 1) {
    for (let frame = 0; frame < 2; frame += 1) {
      drawFrame(frame * 16, direction * 24, direction, frame)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.repeat.set(0.5, 0.25)
  texture.offset.set(0, 0.75)
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(spriteMaterial)
  sprite.name = 'PixelExplorerSprite'
  sprite.position.set(0, 1.262, 14)
  sprite.scale.set(1.65, 2.5, 1)
  root.add(sprite)
  root.userData.playerSpawn = { x: 0, z: 14 }
  root.userData.walkableBounds = { minX: -25, maxX: 25, minZ: -19, maxZ: 19 }
  root.userData.sampleBounds = { width: 62, depth: 54 }
  root.userData.updatePlayerAnimation = (moving, time, dx = 0, dz = 0) => {
    sprite.position.y = moving ? 1.292 + Math.abs(Math.sin(time * 12)) * 0.05 : 1.262
    let row = 0 // 默认朝向镜头
    if (Math.abs(dx) > Math.abs(dz)) row = dx < 0 ? 1 : 2
    else if (Math.abs(dz) > 0.0001) row = dz < 0 ? 3 : 0
    const frame = moving ? Math.floor(time * 7) % 2 : 0
    texture.offset.set(frame * 0.5, 1 - (row + 1) * 0.25)
  }
  return root
}
