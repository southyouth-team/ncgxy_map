// 宝可梦经典城镇探索风格的 2.5D 校园样板区。
// 该场景是视觉与交互验证样板，不代表真实校园测绘数据。
export function createRpgSampleScene(THREE) {
  const root = new THREE.Group()
  root.name = 'PokemonStyleCampusSample'
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true })
  const materials = {
    grass: mat('#78a957'), grassLight: mat('#91b96a'), grassDark: mat('#5f914b'),
    path: mat('#d8c18f'), pathLight: mat('#ead7aa'), pathDark: mat('#b99b6d'),
    wall: mat('#ead9ae'), wallShade: mat('#c6a77d'), roof: mat('#a85d4b'),
    roofLight: mat('#c7775b'), roofDark: mat('#78453e'), trim: mat('#f3e5c4'),
    glass: mat('#77b8c0'), door: mat('#76513b'), wood: mat('#8b6544'),
    trunk: mat('#795238'), leaf: mat('#39744a'), leafLight: mat('#69a653'),
    leafDark: mat('#2d5e42'), flower: mat('#e9a2a0'), stone: mat('#a89d83'),
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
  for (let z = -18; z <= 18; z += 4) {
    for (let x = -24; x <= 24; x += 4) {
      if (((x + z) / 4) % 3 !== 0) continue
      addBox('grass-pixel-patch', x, 0.025, z, 1.8, 0.025, 1.25, materials.grassLight)
    }
  }
  // 校园主路与通往教学楼的石板支路。
  addBox('main-campus-road-edge', 0, 0.035, 8, 48, 0.18, 5.4, materials.pathDark)
  addBox('main-campus-road', 0, 0.13, 8, 48, 0.12, 4.9, materials.path)
  addBox('building-walkway-edge', 0, 0.04, 1.7, 5.8, 0.16, 9.2, materials.pathDark)
  addBox('building-walkway', 0, 0.13, 1.7, 5.2, 0.12, 9.2, materials.pathLight)
  for (let z = -2.2; z < 6; z += 1.35) {
    addBox('walkway-joint', 0, 0.205, z, 5.1, 0.012, 0.055, materials.pathDark)
  }
  // 教学楼：墙体、分层窗户、门廊与双坡屋顶组成完整体块。
  const building = new THREE.Group()
  building.name = 'sample-teaching-building'
  building.position.set(0, 0, -8)
  building.userData.objectType = 'building'
  building.userData.buildingId = 'sample-teaching-building'
  addBox('teaching-building-foundation', 0, 0.18, 0, 15.5, 0.55, 9.2, materials.wallShade, building)
  addBox('teaching-building-main-volume', 0, 0.73, 0, 14.8, 5.8, 8.5, materials.wall, building)
  addBox('teaching-building-front-band', 0, 1.1, 4.28, 14.9, 0.2, 0.18, materials.trim, building)
  addBox('teaching-building-roof', 0, 6.55, 0, 16.2, 0.55, 9.8, materials.roof, building)
  // 两片斜屋面以硬边盒体表现，不使用悬空矩形屋顶。
  const roofLeft = addBox('roof-left-slope', -3.85, 6.65, 0, 8.2, 0.32, 10.1, materials.roofLight, building)
  roofLeft.rotation.z = -0.24
  const roofRight = addBox('roof-right-slope', 3.85, 6.65, 0, 8.2, 0.32, 10.1, materials.roof, building)
  roofRight.rotation.z = 0.24
  addBox('roof-ridge', 0, 7.55, 0, 0.42, 0.28, 10.2, materials.roofDark, building)
  // 正立面窗户按楼层和轴线布置，保持像素化重复节奏。
  for (const y of [2.05, 4.15]) {
    for (const x of [-5.2, -2.6, 2.6, 5.2]) {
      addBox('window-frame', x, y, 4.34, 1.32, 1.12, 0.16, materials.wallShade, building)
      addBox('window-glass', x, y + 0.04, 4.44, 1.02, 0.82, 0.08, materials.glass, building)
      addBox('window-sill', x, y - 0.53, 4.48, 1.45, 0.12, 0.2, materials.trim, building)
    }
  }
  addBox('entrance-door-frame', 0, 0.74, 4.4, 1.85, 2.65, 0.25, materials.wallShade, building)
  addBox('entrance-door', 0, 0.78, 4.56, 1.28, 2.25, 0.12, materials.door, building)
  addBox('entrance-canopy', 0, 3.35, 4.9, 3.1, 0.22, 1.2, materials.roofDark, building)
  addBox('entrance-step-lower', 0, 0.18, 5.35, 3.2, 0.18, 0.85, materials.stone, building)
  addBox('entrance-step-upper', 0, 0.36, 4.95, 2.7, 0.18, 0.65, materials.trim, building)
  root.add(building)
  // 像素树：方块树冠分层，树干与投影明确，树冠不参与角色碰撞。
  const addTree = (x, z, scale = 1) => {
    const tree = new THREE.Group()
    tree.position.set(x, 0, z)
    tree.scale.setScalar(scale)
    tree.userData.objectType = 'tree'
    tree.userData.collisionRadius = 0.62 * scale
    const shadow = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.035, 2.5), materials.shadow)
    shadow.position.set(0.35, 0.04, 0.45)
    tree.add(shadow)
    addBox('tree-trunk', 0, 0.05, 0, 0.55, 1.8, 0.55, materials.trunk, tree)
    addBox('tree-crown-dark', 0, 1.55, 0, 2.6, 1.5, 2.45, materials.leafDark, tree)
    addBox('tree-crown-main', 0, 2.15, 0, 2.35, 1.5, 2.25, materials.leaf, tree)
    addBox('tree-crown-highlight', -0.18, 2.85, -0.12, 1.65, 0.75, 1.65, materials.leafLight, tree)
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
  // 人物使用低分辨率 Canvas Sprite，NearestFilter 保留像素边缘。
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 24
  const ctx = canvas.getContext('2d')
  const pixel = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) }
  pixel(5, 1, 6, 2, '#493d36'); pixel(4, 3, 8, 6, '#e8b987')
  pixel(3, 4, 2, 4, '#493d36'); pixel(11, 4, 2, 4, '#493d36')
  pixel(5, 5, 1, 1, '#302b2a'); pixel(10, 5, 1, 1, '#302b2a')
  pixel(4, 9, 8, 7, '#3d6f9b'); pixel(3, 10, 2, 6, '#e8b987'); pixel(11, 10, 2, 6, '#e8b987')
  pixel(5, 16, 3, 6, '#39434c'); pixel(9, 16, 3, 6, '#39434c')
  pixel(4, 22, 4, 2, '#6d4938'); pixel(9, 22, 4, 2, '#6d4938')
  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.name = 'PixelExplorerSprite'
  sprite.position.set(0, 1.75, 14)
  sprite.scale.set(1.65, 2.5, 1)
  root.add(sprite)
  root.userData.playerSpawn = { x: 0, z: 14 }
  root.userData.walkableBounds = { minX: -25, maxX: 25, minZ: -19, maxZ: 19 }
  root.userData.sampleBounds = { width: 62, depth: 54 }
  root.userData.updatePlayerAnimation = (moving, time) => {
    sprite.position.y = moving ? 1.78 + Math.abs(Math.sin(time * 12)) * 0.09 : 1.75
  }
  return root
}
