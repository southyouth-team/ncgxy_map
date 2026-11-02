import {
  CAMPUS_PLAN_REFERENCE, CAMPUS_AREAS, CAMPUS_ROAD_CENTERLINES,
  CAMPUS_BUILDING_FOOTPRINTS, mapPixelToWorld, mapRectToWorld,
} from '../../../data/campus/campusLayout.js'
import {
  createCampusMaterials, addPixelTree, addPixelFlowerPatch,
  addPixelBench, addPixelLamp,
} from './campusAssetLibrary.js'

// 星露谷式 2.5D 校园原型。空间轮廓来自示意图，程序化建筑不代表真实楼体测绘。
export function createCampusScene(THREE) {
  const root = new THREE.Group()
  root.name = 'NanchangInstituteCampus'
  const mats = createCampusMaterials(THREE)
  const { worldWidth, worldDepth } = CAMPUS_PLAN_REFERENCE

  function addBox(name, x, y, z, w, h, d, material, parent = root) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    mesh.name = name
    mesh.position.set(x, y + h / 2, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  function addGroundPatch(name, rect, material, y = 0.015) {
    const bounds = mapRectToWorld(rect)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bounds.width, 0.08, bounds.depth), material)
    mesh.name = name
    mesh.position.set(bounds.x, y, bounds.z)
    mesh.receiveShadow = true
    root.add(mesh)
    return mesh
  }
  function addPolygon(name, polygon, material, y = 0.08) {
    if (!Array.isArray(polygon) || polygon.length < 3) return null
    const points = polygon.map(([px, py]) => {
      const point = mapPixelToWorld(px, py)
      return new THREE.Vector2(point.x, -point.z)
    })
    const geometry = new THREE.ShapeGeometry(new THREE.Shape(points))
    geometry.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.y = y
    mesh.receiveShadow = true
    root.add(mesh)
    return mesh
  }

  addBox('campus-ground-soil', 0, -0.9, 0, worldWidth + 4, 0.9, worldDepth + 4, mats.trunk)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldDepth), mats.grass)
  ground.name = 'campus-grass-pixel-ground'
  ground.rotation.x = -Math.PI / 2
  ground.position.y = 0.015
  ground.receiveShadow = true
  root.add(ground)

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(worldWidth, 0.04, worldDepth)),
    new THREE.LineBasicMaterial({ color: '#d6c49d' }),
  )
  border.position.y = 0.04
  root.add(border)

  for (const area of CAMPUS_AREAS) {
    if (area.id === 'central-lake' && area.polygon?.length) {
      addPolygon('campus-central-lake-bed', area.polygon, mats.waterEdge, 0.065)
      addPolygon('campus-central-lake-water', area.polygon, mats.water, 0.13)
      continue
    }
    if (!area.rect) continue
    if (area.type === 'sports') {
      addGroundPatch('area-' + area.id + '-earth', area.rect, mats.sports, 0.035)
      const bounds = mapRectToWorld(area.rect)
      const inset = new THREE.Mesh(new THREE.BoxGeometry(bounds.width - 0.9, 0.035, bounds.depth - 0.9), mats.pathEdge)
      inset.position.set(bounds.x, 0.09, bounds.z)
      root.add(inset)
      const field = new THREE.Mesh(new THREE.BoxGeometry(bounds.width - 1.15, 0.04, bounds.depth - 1.15), mats.grassPlain)
      field.position.set(bounds.x, 0.12, bounds.z)
      root.add(field)
    } else if (area.type !== 'building-cluster') {
      addGroundPatch('area-' + area.id, area.rect, mats.grassPlain, 0.025)
    }
  }

  for (const road of CAMPUS_ROAD_CENTERLINES) {
    const points = road.points.map(([px, py]) => {
      const point = mapPixelToWorld(px, py)
      return new THREE.Vector3(point.x, 0.11, point.z)
    })
    if (points.length < 2) continue
    const curve = new THREE.CatmullRomCurve3(points)
    const segments = Math.max(32, points.length * 16)
    const edge = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, 1.72, 6, false), mats.pathEdge)
    edge.name = 'path-edge-' + road.id
    edge.receiveShadow = true
    root.add(edge)
    const path = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, 1.42, 6, false), mats.path)
    path.name = 'path-surface-' + road.id
    path.receiveShadow = true
    root.add(path)
  }

  const wallPalette = [mats.wall, mats.wallPeach, mats.wallMint, mats.wallCream]
  function addCampusBuilding(item, index) {
    const bounds = mapRectToWorld(item.rect)
    const width = Math.max(4.2, bounds.width)
    const depth = Math.max(2.4, bounds.depth)
    const height = item.confidence === 'medium' ? 4.2 : 3.4
    const group = new THREE.Group()
    group.name = item.id
    group.position.set(bounds.x, 0.16, bounds.z)
    group.userData.buildingId = item.id
    group.userData.displayName = item.label
    group.userData.confidence = item.confidence
    group.userData.assetStyle = 'stardew-pixel-campus'

    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallPalette[index % wallPalette.length])
    wall.position.y = height / 2
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)

    const roofWidth = width + 0.42
    const roofDepth = depth + 0.42
    const roofShape = new THREE.Shape()
    roofShape.moveTo(-roofWidth / 2, 0)
    roofShape.lineTo(0, 1.45)
    roofShape.lineTo(roofWidth / 2, 0)
    roofShape.closePath()
    const roofGeometry = new THREE.ExtrudeGeometry(roofShape, { depth: roofDepth, bevelEnabled: false, steps: 1 })
    roofGeometry.translate(0, height - 0.08, -roofDepth / 2)
    const roof = new THREE.Mesh(roofGeometry, mats.roof)
    roof.castShadow = true
    roof.receiveShadow = true
    group.add(roof)

    const eave = new THREE.Mesh(new THREE.BoxGeometry(roofWidth + 0.18, 0.16, roofDepth + 0.2), mats.roofDark)
    eave.position.y = height - 0.05
    group.add(eave)

    const windowCount = Math.max(2, Math.min(6, Math.floor(width / 2.5)))
    for (let i = 0; i < windowCount; i += 1) {
      const x = -width / 2 + (i + 1) * width / (windowCount + 1)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.92, 0.12), mats.windowTrim)
      frame.position.set(x, 1.95, depth / 2 + 0.075)
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.06), mats.window)
      glass.position.set(x, 1.95, depth / 2 + 0.15)
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.68, 0.04), mats.windowTrim)
      mullion.position.set(x, 1.95, depth / 2 + 0.19)
      group.add(frame, glass, mullion)
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.55, 0.16), mats.door)
    door.position.set(0, 0.78, depth / 2 + 0.09)
    const doorStep = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 0.62), mats.stoneLight)
    doorStep.position.set(0, 0.09, depth / 2 + 0.32)
    group.add(door, doorStep)

    const sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(2.8, width * 0.55), 0.38, 0.12), mats.wood)
    sign.position.set(0, height - 0.82, depth / 2 + 0.12)
    group.add(sign)
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
      new THREE.LineBasicMaterial({ color: '#6c5947' }),
    )
    outline.position.y = height / 2
    group.add(outline)
    group.traverse((object) => {
      if (object.isMesh) { object.castShadow = true; object.receiveShadow = true }
    })
    root.add(group)
  }
  CAMPUS_BUILDING_FOOTPRINTS.forEach(addCampusBuilding)

  const treePositions = [
    [202,215,1.05],[305,210,0.95],[355,280,1.05],[190,360,0.9],[520,275,1],[565,355,1.1],
    [225,420,0.92],[330,430,1.05],[485,435,0.9],[75,220,1],[85,260,0.95],[570,180,0.9],
    [155,205,0.78],[315,335,0.82],[405,245,0.88],[460,360,0.9],[125,385,0.78],[545,420,0.82],
    [350,115,0.75],[205,120,0.78],
  ]
  treePositions.forEach(([px, py, scale], index) => {
    const point = mapPixelToWorld(px, py)
    addPixelTree(THREE, root, point.x, point.z, scale, index, mats)
  })
  const flowerPositions = [[150,245],[300,190],[340,315],[465,205],[500,390],[205,395],[90,185]]
  flowerPositions.forEach(([px, py], index) => {
    const point = mapPixelToWorld(px, py)
    addPixelFlowerPatch(THREE, root, point.x, point.z, mats, index % 2 ? 4 : 6)
  })
  ;[[260,175],[430,390],[115,275]].forEach(([px, py]) => {
    const point = mapPixelToWorld(px, py)
    addPixelBench(THREE, root, point.x, point.z, mats)
  })
  ;[[175,180],[390,185],[510,320],[275,405]].forEach(([px, py]) => {
    const point = mapPixelToWorld(px, py)
    addPixelLamp(THREE, root, point.x, point.z, mats)
  })

  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  const pixel = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) }
  const drawFrame = (step = 0) => {
    ctx.clearRect(0, 0, 32, 48)
    pixel(11,2,10,3,'#493b31')
    pixel(8,5,16,12,'#edc29a')
    pixel(8,5,16,4,'#79523e')
    pixel(6,10,3,8,'#79523e')
    pixel(23,10,3,8,'#79523e')
    pixel(11,11,3,3,'#343c40')
    pixel(19,11,3,3,'#343c40')
    pixel(12,18,8,3,'#f3e4c4')
    pixel(8,21,16,13,'#6b9363')
    const swing = step === 1 ? 2 : step === 3 ? -2 : 0
    pixel(5,22+swing,3,10,'#edc29a')
    pixel(24,22-swing,3,10,'#edc29a')
    pixel(9+swing,34,6,10-Math.abs(swing),'#625344')
    pixel(18-swing,34,6,10-Math.abs(swing),'#625344')
    pixel(8+swing,44,8,3,'#493b31')
    pixel(18-swing,44,8,3,'#493b31')
  }
  drawFrame()
  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  const character = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  character.name = 'PixelExplorerSprite'
  const spawn = mapPixelToWorld(320, 370)
  character.position.set(spawn.x, 2.1, spawn.z)
  character.scale.set(2.4, 3.6, 1)
  root.add(character)
  root.userData.playerSprite = character
  let lastFrame = -1
  root.userData.updatePlayerAnimation = (moving, seconds) => {
    const frame = moving ? Math.floor(seconds / 0.14) % 4 : 0
    if (frame === lastFrame) return
    lastFrame = frame
    drawFrame(frame)
    texture.needsUpdate = true
  }

  const halfW = worldWidth / 2
  const halfD = worldDepth / 2
  root.userData.walkableBounds = { minX: -halfW + 2, maxX: halfW - 2, minZ: -halfD + 2, maxZ: halfD - 2 }
  root.userData.isVisualPrototype = true
  root.userData.assetStyle = 'stardew-inspired-pixel-art'
  root.userData.coordinateSystem = 'campus-plan-pixel-to-world'
  return root
}
