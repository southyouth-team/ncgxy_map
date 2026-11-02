// 等距像素风格样板场景。此处为美术与交互验证用的示意布局，不代表真实校园测绘数据。
export function createCampusScene(THREE) {
  const root = new THREE.Group()
  root.name = 'PixelArtCampusStyleSample'

  const palette = {
    grass: '#477d48',
    grassLight: '#659653',
    road: '#777875',
    sidewalk: '#c9c2ad',
    brick: '#a95f50',
    brickDark: '#70433f',
    cream: '#d9c8a4',
    roof: '#514542',
    roofLight: '#81736a',
    window: '#79b5c4',
    windowDark: '#345b68',
    outline: '#292c2b',
    tree: '#286b3d',
    treeLight: '#43894a',
    trunk: '#68462f',
    white: '#eee6d1',
  }
  const material = (color, extra = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 1, metalness: 0, flatShading: true, ...extra,
  })
  const mats = Object.fromEntries(Object.entries(palette).map(([key, color]) => [key, material(color)]))

  const addBox = (parent, name, x, y, z, w, h, d, mat, outline = false) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.name = name
    mesh.position.set(x, y + h / 2, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    if (outline) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: palette.outline, transparent: true, opacity: 0.85 }),
      )
      edges.position.copy(mesh.position)
      edges.scale.copy(mesh.scale)
      parent.add(edges)
    }
    return mesh
  }

  // 地面与道路：仅用于展示资产风格，不对应真实校园道路。
  addBox(root, 'pixel-grass-ground', 0, -0.5, 0, 150, 0.5, 130, mats.grass)
  const road = (x, z, w, d) => addBox(root, 'pixel-road', x, 0.01, z, w, 0.12, d, mats.road)
  road(0, 0, 150, 10)
  road(-22, 0, 7, 120)
  road(32, 0, 7, 120)
  road(4, -34, 110, 5)
  road(4, 34, 110, 5)

  // 人行道与斑马线。
  const path = (x, z, w, d) => addBox(root, 'pixel-sidewalk', x, 0.08, z, w, 0.12, d, mats.sidewalk)
  path(-10, -9, 4, 48)
  path(20, 12, 4, 42)
  path(0, 17, 42, 3)
  for (let i = 0; i < 7; i++) {
    addBox(root, 'crosswalk-stripe', -3 + i * 1.15, 0.16, -5, 0.72, 0.025, 3.2, mats.white)
  }

  // 像素化窗户纹理：最近邻采样，避免纹理插值模糊。
  const makeWindowTexture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = palette.brick
    ctx.fillRect(0, 0, 64, 64)
    for (let y = 5; y < 58; y += 15) {
      for (let x = 5; x < 58; x += 14) {
        ctx.fillStyle = palette.outline
        ctx.fillRect(x, y, 9, 10)
        ctx.fillStyle = palette.window
        ctx.fillRect(x + 1, y + 1, 7, 8)
        ctx.fillStyle = '#c5e2d9'
        ctx.fillRect(x + 1, y + 1, 2, 2)
      }
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }
  const facadeTexture = makeWindowTexture()
  const facadeMaterial = new THREE.MeshStandardMaterial({ map: facadeTexture, color: 0xffffff, roughness: 1, flatShading: true })

  const createBuilding = ({ name, x, z, width, depth, floors, color = mats.brick, special = false }) => {
    const group = new THREE.Group()
    group.name = name
    group.position.set(x, 0, z)
    const floorHeight = 2.7
    const height = floors * floorHeight
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), color === mats.brick ? facadeMaterial : color)
    body.position.y = height / 2
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
    const bodyEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: palette.outline }),
    )
    bodyEdges.position.copy(body.position)
    group.add(bodyEdges)
    addBox(group, 'flat-roof', 0, height, 0, width + 0.8, 0.45, depth + 0.8, mats.roof, true)
    addBox(group, 'roof-parapet-front', 0, height + 0.45, depth / 2, width + 0.8, 0.35, 0.25, mats.roofLight, true)
    if (special) {
      addBox(group, 'entrance-canopy', 0, 0.5, depth / 2 + 0.8, width * 0.42, 0.35, 1.5, mats.cream, true)
      addBox(group, 'entrance-door', 0, 0, depth / 2 + 0.12, 1.5, 2.2, 0.12, mats.windowDark)
    }
    root.add(group)
  }

  // 纯示意建筑：使用“教学楼 A/B”等临时名称，不绑定真实楼栋。
  createBuilding({ name: '样板教学楼 A', x: -43, z: -22, width: 17, depth: 12, floors: 4, special: true })
  createBuilding({ name: '样板教学楼 B', x: -5, z: -24, width: 19, depth: 13, floors: 5 })
  createBuilding({ name: '样板综合楼', x: 43, z: -22, width: 20, depth: 15, floors: 3, color: mats.cream, special: true })
  createBuilding({ name: '样板宿舍楼 A', x: -44, z: 48, width: 15, depth: 12, floors: 6 })
  createBuilding({ name: '样板宿舍楼 B', x: 42, z: 47, width: 16, depth: 12, floors: 5 })

  // 方块树冠，统一轮廓和分层绿植色彩。
  const createTree = (x, z, scale = 1) => {
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    addBox(group, 'tree-trunk', 0, 0, 0, 0.65 * scale, 2.2 * scale, 0.65 * scale, mats.trunk, true)
    addBox(group, 'tree-crown-base', 0, 2 * scale, 0, 2.8 * scale, 1.7 * scale, 2.6 * scale, mats.tree, true)
    addBox(group, 'tree-crown-top', 0, 3.2 * scale, 0, 2.1 * scale, 1.4 * scale, 2.0 * scale, mats.treeLight, true)
    root.add(group)
  }
  ;[
    [-62,-48,1.1],[-28,-48,.9],[16,-48,1.1],[64,-43,1.15],
    [-62,5,1],[-34,17,.9],[28,18,1.1],[64,13,.9],
    [-62,57,1.2],[-20,55,1],[18,57,.9],[65,58,1.1],
  ].forEach(([x,z,s]) => createTree(x,z,s))

  // 简化路灯：深色灯杆 + 暖色灯罩。
  const createLamp = (x, z) => {
    addBox(root, 'lamp-post', x, 0.15, z, 0.18, 4.4, 0.18, mats.outline)
    addBox(root, 'lamp-head', x, 4.45, z, 0.85, 0.28, 0.65, mats.cream, true)
  }
  ;[[-15,-12],[15,-12],[-15,28],[15,28],[-55,0],[55,0]].forEach(([x,z]) => createLamp(x,z))

  // 原创像素人物 Sprite，作为漫游角色比例参照。
  const characterCanvas = document.createElement('canvas')
  characterCanvas.width = 32
  characterCanvas.height = 48
  const ctx = characterCanvas.getContext('2d')
  const pixel = (x,y,w,h,color) => { ctx.fillStyle = color; ctx.fillRect(x,y,w,h) }
  const drawCharacterFrame = (step = 0) => {
    ctx.clearRect(0, 0, 32, 48)
    pixel(11,2,10,3,'#2c2928'); pixel(8,5,16,12,'#e7b58a')
    pixel(8,5,16,4,'#3c302e'); pixel(6,10,3,8,'#3c302e'); pixel(23,10,3,8,'#3c302e')
    pixel(11,11,3,3,'#292b35'); pixel(19,11,3,3,'#292b35')
    pixel(12,18,8,3,'#f0dfbd'); pixel(8,21,16,13,'#3e7290')
    const swing = step === 1 ? 2 : step === 2 ? 0 : step === 3 ? -2 : 0
    pixel(5,22 + swing,3,10,'#e7b58a'); pixel(24,22 - swing,3,10,'#e7b58a')
    pixel(9 + swing,34,6,10 - Math.abs(swing),'#303c58')
    pixel(18 - swing,34,6,10 - Math.abs(swing),'#303c58')
    pixel(8 + swing,44,8,3,'#292624'); pixel(18 - swing,44,8,3,'#292624')
  }
  drawCharacterFrame(0)
  const characterTexture = new THREE.CanvasTexture(characterCanvas)
  characterTexture.magFilter = THREE.NearestFilter
  characterTexture.minFilter = THREE.NearestFilter
  characterTexture.colorSpace = THREE.SRGBColorSpace
  const character = new THREE.Sprite(new THREE.SpriteMaterial({ map: characterTexture, transparent: true, depthWrite: false }))
  character.name = 'PixelExplorerSprite'
  character.position.set(0, 2.1, 7)
  character.scale.set(2.4, 3.6, 1)
  root.add(character)
  root.userData.playerSprite = character
  let lastAnimationFrame = -1
  root.userData.updatePlayerAnimation = (moving, elapsedSeconds) => {
    const frame = moving ? Math.floor(elapsedSeconds / 0.14) % 4 : 0
    if (frame === lastAnimationFrame) return
    lastAnimationFrame = frame
    drawCharacterFrame(frame)
    characterTexture.needsUpdate = true
  }

  // 供漫游控制器使用的边界；样板区域不是实际校园边界。
  root.userData.walkableBounds = { minX: -70, maxX: 70, minZ: -58, maxZ: 60 }
  root.userData.isVisualPrototype = true
  return root
}
