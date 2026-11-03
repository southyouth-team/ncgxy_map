import {
  CAMPUS_PLAN_REFERENCE, CAMPUS_AREAS, CAMPUS_ROAD_CENTERLINES,
  CAMPUS_BUILDING_FOOTPRINTS, mapPixelToWorld, mapRectToWorld,
} from '../../../data/campus/campusLayout.js'
import {
  createCampusMaterials, addPixelTree, addPixelFlowerPatch,
  addPixelBench, addPixelLamp, createPixelBuilding,
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

  // 运动场边线与中心标记：让校园远景中的场地具备明确的运动设施识别度。
  function addSportsMarkings(rect, id) {
    const [left, top, right, bottom] = rect
    const inset = 4
    const corners = [
      [left + inset, top + inset], [right - inset, top + inset],
      [right - inset, bottom - inset], [left + inset, bottom - inset],
    ]
    const toVector = ([x, y]) => {
      const point = mapPixelToWorld(x, y)
      return new THREE.Vector3(point.x, 0.19, point.z)
    }
    const material = new THREE.LineBasicMaterial({ color: '#f1e8cf', transparent: true, opacity: 0.82 })
    const addLine = (points, loop = false) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(toVector))
      const line = new THREE.Line(geometry, material)
      line.name = 'sports-marking-' + id
      line.userData.objectType = 'sports-marking'
      root.add(line)
    }
    addLine(corners, true)
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2
    addLine([[centerX, top + inset], [centerX, bottom - inset]])
    const radius = Math.min(right - left, bottom - top) * 0.16
    const circle = Array.from({ length: 25 }, (_, index) => {
      const angle = index / 24 * Math.PI * 2
      return [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius]
    })
    addLine(circle)
    const boxDepth = (bottom - top) * 0.12
    addLine([[left + inset, centerY - boxDepth], [left + inset + (right - left) * 0.18, centerY - boxDepth], [left + inset + (right - left) * 0.18, centerY + boxDepth], [left + inset, centerY + boxDepth]])
    addLine([[right - inset, centerY - boxDepth], [right - inset - (right - left) * 0.18, centerY - boxDepth], [right - inset - (right - left) * 0.18, centerY + boxDepth], [right - inset, centerY + boxDepth]])
  }
  CAMPUS_AREAS.filter(area => area.type === 'sports' && area.rect).forEach(area => addSportsMarkings(area.rect, area.id))

  const wallPalette = [mats.wall, mats.wallPeach, mats.wallMint, mats.wallCream]
  function addCampusBuilding(item, index) {
    const bounds = mapRectToWorld(item.rect)
    const width = Math.max(4.2, bounds.width)
    const depth = Math.max(2.4, bounds.depth)
    const height = item.confidence === 'medium' ? 4.2 : 3.4
    const group = createPixelBuilding(THREE, {
      width, depth, height: item.height || (item.confidence === 'medium' ? 4.2 : undefined), template: item.template || ['教学楼', '宿舍楼', '实验楼', '办公楼'][index % 4], materials: mats,
      wallMaterial: wallPalette[index % wallPalette.length],
      label: item.label || item.id,
      confidence: item.confidence || 'unverified',
    })
    group.position.set(bounds.x, 0.16, bounds.z)
    group.userData.buildingId = item.id
    group.userData.displayName = item.label
    const doorStep = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 0.62), mats.stoneLight)
    doorStep.position.set(0, 0.09, depth / 2 + 0.32)
    const sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(2.8, width * 0.55), 0.38, 0.12), mats.wood)
    sign.position.set(0, height - 0.82, depth / 2 + 0.12)
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
      new THREE.LineBasicMaterial({ color: '#6c5947' }),
    )
    outline.position.y = height / 2
    group.add(doorStep, sign, outline)
    root.add(group)
  }
  CAMPUS_BUILDING_FOOTPRINTS.forEach(addCampusBuilding)

  const treePositions = [
    [202,215,1.05],[305,210,0.95],[355,280,1.05],[190,360,0.9],[520,275,1],[565,355,1.1],
    [225,420,0.92],[330,430,1.05],[485,435,0.9],[75,220,1],[85,260,0.95],[570,180,0.9],
    [155,205,0.78],[315,335,0.82],[405,245,0.88],[460,360,0.9],[125,385,0.78],[545,420,0.82],
    [350,115,0.75],[205,120,0.78],
    [185,215,0.82],[205,175,0.78],[235,170,0.88],[265,180,0.82],[300,225,0.78],
    [315,245,0.9],[345,260,0.86],[355,300,0.92],[335,340,0.88],[290,365,0.82],
    [205,380,0.86],[245,395,0.9],[285,410,0.82],[365,405,0.88],[405,420,0.92],
    [445,430,0.82],[475,410,0.9],[515,385,0.86],[555,385,0.92],[575,320,0.82],
    [560,245,0.9],[535,205,0.86],[500,185,0.82],[460,185,0.9],[420,185,0.82],
    [380,155,0.88],[345,145,0.82],[305,145,0.9],[270,135,0.82],[235,145,0.88],
    [155,285,0.82],[135,315,0.88],[120,350,0.82],[90,375,0.9],[70,405,0.82],
  ]
  treePositions.forEach(([px, py, scale], index) => {
    const point = mapPixelToWorld(px, py)
    addPixelTree(THREE, root, point.x, point.z, scale, index, mats)
  })
  const flowerPositions = [[150,245],[300,190],[340,315],[465,205],[500,390],[205,395],[90,185],[220,205],[275,175],[320,300],[360,355],[430,365],[485,235],[540,285],[165,345],[250,420],[390,430],[520,430]]
  flowerPositions.forEach(([px, py], index) => {
    const point = mapPixelToWorld(px, py)
    addPixelFlowerPatch(THREE, root, point.x, point.z, mats, index % 2 ? 4 : 6)
  })
  ;[[260,175],[430,390],[115,275],[315,355],[475,365],[215,420]].forEach(([px, py]) => {
    const point = mapPixelToWorld(px, py)
    addPixelBench(THREE, root, point.x, point.z, mats)
  })
  ;[[175,180],[390,185],[510,320],[275,405],[245,205],[330,245],[365,330],[445,410],[550,365],[135,350],[205,415]].forEach(([px, py]) => {
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
