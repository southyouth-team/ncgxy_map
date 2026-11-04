import {
  CAMPUS_PLAN_REFERENCE, CAMPUS_PLAYER_SPAWN_PIXEL, getCampusFootprintBounds, mapPixelToWorld, mapRectToWorld,
} from '../../../data/campus/campusLayout.js'
import { getCampusSpatialLayers } from '../../../data/campus/campusGeoJSON.js'

const { areas: CAMPUS_AREAS, roads: CAMPUS_ROAD_CENTERLINES, buildings: CAMPUS_BUILDING_FOOTPRINTS } = getCampusSpatialLayers()
import {
  createCampusMaterials, addPixelTree, addPixelFlowerPatch,
  addPixelBench, addPixelLamp, createPixelBuilding,
} from './campusAssetLibrary.js'

// 等距像素风 2.5D 校园原型。空间轮廓来自示意图，程序化建筑不代表真实楼体测绘。
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
  function addPolygon(name, polygon, material, y = 0.08, holes = []) {
    if (!Array.isArray(polygon) || polygon.length < 3) return null
    const points = polygon.map(([px, py]) => {
      const point = mapPixelToWorld(px, py)
      return new THREE.Vector2(point.x, -point.z)
    })
    const shape = new THREE.Shape(points)
    for (const hole of holes) {
      if (!Array.isArray(hole) || hole.length < 3) continue
      const path = new THREE.Path(hole.map(([px, py]) => {
        const point = mapPixelToWorld(px, py)
        return new THREE.Vector2(point.x, -point.z)
      }))
      shape.holes.push(path)
    }
    const geometry = new THREE.ShapeGeometry(shape)
    geometry.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.position.y = y
    mesh.receiveShadow = true
    root.add(mesh)
    return mesh
  }

  addBox('campus-ground-soil', 0, -0.9, 0, worldWidth + 4, 0.9, worldDepth + 4, mats.trunk)
  // 校园底板外扩展远景地面，避免低角度旋转时露出矩形底板边缘。
  const horizonGround = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), mats.grassPlain)
  horizonGround.name = 'campus-horizon-ground'
  horizonGround.rotation.x = -Math.PI / 2
  // 放在土壤底板顶面上方，保证斜视时底板外仍有连续地面填充。
  horizonGround.position.y = 0.001
  horizonGround.receiveShadow = true
  root.add(horizonGround)
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
    if (area.type === 'water' && area.polygon?.length) {
      addPolygon('campus-' + area.id + '-bed', area.polygon, mats.waterEdge, 0.065, area.holes)
      addPolygon('campus-' + area.id + '-water', area.polygon, mats.water, 0.13, area.holes)
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

  // 低对比度像素水纹，使用固定坐标避免每次刷新随机跳动。
  const waterRippleMaterial = mats.waterShallow
  const waterRipples = [
    [520, 135, 1.15], [610, 220, 0.85], [530, 318, 1.05], [470, 235, 0.72],
    [188, 92, 0.8], [245, 122, 1.0], [220, 150, 0.7],
  ]
  waterRipples.forEach(([pixelX, pixelY, size], index) => {
    const point = mapPixelToWorld(pixelX, pixelY)
    const ripple = new THREE.Mesh(
      new THREE.BoxGeometry(0.9 * size, 0.035, 0.12 * size),
      waterRippleMaterial,
    )
    ripple.name = 'pixel-water-ripple-' + index
    ripple.position.set(point.x, 0.155, point.z)
    root.add(ripple)
  })

  // 道路采用硬边像素铺装：底层路缘 + 内层路面，避免圆管道路破坏等距像素风格。
  function addPixelRoadLayer(roadId, sampledPoints, width, height, y, material, suffix) {
    for (let index = 0; index < sampledPoints.length - 1; index += 1) {
      const from = sampledPoints[index]
      const to = sampledPoints[index + 1]
      const dx = to.x - from.x
      const dz = to.z - from.z
      const length = Math.hypot(dx, dz)
      if (length < 0.025) continue
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(length + width * 0.34, height, width),
        material,
      )
      slab.name = 'pixel-road-' + suffix + '-' + roadId + '-' + index
      slab.position.set((from.x + to.x) / 2, y, (from.z + to.z) / 2)
      slab.rotation.y = Math.atan2(-dz, dx)
      slab.receiveShadow = true
      root.add(slab)
    }
  }

  for (const road of CAMPUS_ROAD_CENTERLINES) {
    const points = road.points.map(([px, py]) => {
      const point = mapPixelToWorld(px, py)
      return new THREE.Vector3(point.x, 0, point.z)
    })
    if (points.length < 2) continue
    const curve = new THREE.CatmullRomCurve3(points)
    const segments = Math.max(16, (points.length - 1) * 5)
    const sampledPoints = curve.getPoints(segments)
    addPixelRoadLayer(road.id, sampledPoints, 3.5, 0.16, 0.105, mats.pathEdge, 'curb')
    addPixelRoadLayer(road.id, sampledPoints, 2.86, 0.12, 0.205, mats.path, 'surface')
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
      const line = loop ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material)
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

  // 重要公共空间使用原创像素字牌标注，帮助玩家建立校园方位感。
  function addPixelLandmarkLabel(name, text, pixelX, pixelY, width = 10) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const context = canvas.getContext('2d')
    context.font = 'bold 30px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    context.lineWidth = 7
    context.strokeStyle = '#42533e'
    context.strokeText(text, 128, 32)
    context.fillStyle = '#fff4d4'
    context.fillText(text, 128, 32)
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, depthTest: true,
    }))
    const point = mapPixelToWorld(pixelX, pixelY)
    sprite.name = 'campus-landmark-' + name
    sprite.position.set(point.x, 3.1, point.z)
    sprite.scale.set(width, width * 0.25, 1)
    sprite.userData.objectType = 'landmark-label'
    sprite.userData.displayName = text
    root.add(sprite)
  }
  addPixelLandmarkLabel('central-lake', '中央湖区', 545, 222, 10.5)
  addPixelLandmarkLabel('west-lake', '西侧湖区', 220, 112, 8.5)
  addPixelLandmarkLabel('north-east-sports', '运动场', 802, 105, 7.5)
  addPixelLandmarkLabel('south-sports', '运动场', 475, 390, 8.5)

  const wallPalette = [mats.wall, mats.wallPeach, mats.wallMint, mats.wallCream]
  function addCampusBuilding(item, index) {
    const footprintBounds = getCampusFootprintBounds(item)
    if (!footprintBounds) return
    const bounds = mapRectToWorld(footprintBounds)
    const width = Math.max(4.2, bounds.width)
    const depth = Math.max(2.4, bounds.depth)
    const template = item.template || ['街区楼 A', '街区楼 B', '庭院楼', '坡顶楼'][index % 4]
    const localFootprint = item.polygon
      ? new THREE.Shape(item.polygon.map(([px, py]) => new THREE.Vector2(
        (px - (footprintBounds[0] + footprintBounds[2]) / 2) * (CAMPUS_PLAN_REFERENCE.worldWidth / (CAMPUS_PLAN_REFERENCE.mapBounds.right - CAMPUS_PLAN_REFERENCE.mapBounds.left)),
        -(py - (footprintBounds[1] + footprintBounds[3]) / 2) * (CAMPUS_PLAN_REFERENCE.worldWidth / (CAMPUS_PLAN_REFERENCE.mapBounds.right - CAMPUS_PLAN_REFERENCE.mapBounds.left)),
      )))
      : undefined
    const group = createPixelBuilding(THREE, {
      width, depth, footprint: localFootprint, height: item.height, template, materials: mats,
      wallMaterial: wallPalette[index % wallPalette.length],
      label: item.label || item.id,
      confidence: item.confidence || 'unverified',
      entranceEdgeIndex: item.entranceEdgeIndex,
      floors: item.floors,
      roofStyle: item.roofStyle,
      roofRise: item.roofRise,
      windowDensity: item.windowDensity,
      windowWidth: item.windowWidth,
      windowHeight: item.windowHeight,
      doorWidth: item.doorWidth,
    })
    const buildingHeight = group.userData.buildingHeight || 3.8
    let foundation
    if (localFootprint) {
      const foundationGeometry = new THREE.ShapeGeometry(localFootprint)
      foundationGeometry.rotateX(-Math.PI / 2)
      foundation = new THREE.Mesh(foundationGeometry, mats.stone)
      foundation.position.set(bounds.x, 0.08, bounds.z)
    } else {
      foundation = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.55, 0.16, depth + 0.55),
        mats.stone,
      )
      foundation.position.set(bounds.x, 0.08, bounds.z)
    }
    foundation.name = 'building-foundation-' + item.id
    foundation.receiveShadow = true
    root.add(foundation)
    group.position.set(bounds.x, 0.16, bounds.z)
    group.userData.buildingId = item.id
    group.userData.objectType = 'building'
    group.userData.displayName = item.label
    group.userData.footprintType = item.polygon ? 'polygon' : 'rect'
    if (item.polygon) {
      group.userData.collisionPolygon = item.polygon.map(([pixelX, pixelY]) => {
        const point = mapPixelToWorld(pixelX, pixelY)
        return [point.x, point.z]
      })
    }
    group.userData.rebuildOptions = {
      materials: mats,
      wallMaterial: wallPalette[index % wallPalette.length],
      template,
      label: item.label || item.id,
      confidence: item.confidence || 'unverified',
      height: item.height,
      floors: item.floors,
      roofStyle: item.roofStyle,
      roofRise: item.roofRise,
      windowDensity: item.windowDensity,
      windowWidth: item.windowWidth,
      windowHeight: item.windowHeight,
      doorWidth: item.doorWidth,
      entranceEdgeIndex: group.userData.entrance?.edgeIndex ?? item.entranceEdgeIndex,
      footprint: localFootprint,
    }
    group.userData.foundationMesh = foundation
    if (localFootprint) {
      const outlinePoints = localFootprint.getPoints(1).map(point => new THREE.Vector3(point.x, 0.01, -point.y))
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints)
      const outline = new THREE.LineLoop(outlineGeometry, new THREE.LineBasicMaterial({ color: '#6c5947' }))
      outline.position.y = buildingHeight
      group.add(outline)
    } else {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(width, buildingHeight, depth)),
        new THREE.LineBasicMaterial({ color: '#6c5947' }),
      )
      outline.position.y = buildingHeight / 2
      group.add(outline)
    }
    root.add(group)
  }
  CAMPUS_BUILDING_FOOTPRINTS.forEach(addCampusBuilding)

  const treePositions = [
    // 西侧湖岸与西南绿化带
    [176,82,0.9],[205,52,0.82],[244,75,0.88],[286,105,0.82],[285,145,0.9],
    [285,180,0.82],[292,210,0.9],[286,250,0.82],[282,290,0.9],[285,340,0.82],
    [175,300,0.88],[190,330,0.82],[220,355,0.9],[245,390,0.82],[275,425,0.9],
    // 中央湖区外围景观树
    [445,118,0.82],[470,92,0.9],[520,82,0.82],[575,92,0.9],[620,125,0.82],
    [650,170,0.9],[660,225,0.82],[645,285,0.9],[610,330,0.82],[565,355,0.9],
    [510,360,0.82],[465,335,0.9],[435,290,0.82],[420,235,0.9],[425,180,0.82],
    // 东侧与南部绿化
    [650,155,0.9],[700,155,0.82],[755,160,0.9],[800,165,0.82],
    [810,300,0.9],[790,330,0.82],[760,335,0.9],[720,330,0.82],
    [500,445,0.9],[550,440,0.82],[610,440,0.9],[670,440,0.82],[730,440,0.9],
    [785,430,0.82],[330,160,0.9],[300,185,0.82],[300,310,0.9],[320,340,0.82],
    [380,340,0.9],[400,365,0.82],[365,430,0.9],[320,440,0.82],
  ]
  treePositions.forEach(([px, py, scale], index) => {
    const point = mapPixelToWorld(px, py)
    addPixelTree(THREE, root, point.x, point.z, scale, index, mats)
  })
  const flowerPositions = [[295,160],[310,190],[300,270],[300,370],[350,155],[405,160],[445,350],[470,365],[525,365],[585,350],[640,330],[655,160],[690,160],[745,165],[800,165],[810,330],[770,340],[725,340],[520,445],[600,445],[680,445],[745,445],[240,435],[190,420]]
  flowerPositions.forEach(([px, py], index) => {
    const point = mapPixelToWorld(px, py)
    addPixelFlowerPatch(THREE, root, point.x, point.z, mats, index % 2 ? 4 : 6)
  })
  ;[[300,175],[420,350],[185,330],[545,365],[650,345],[740,340],[250,420],[690,445]].forEach(([px, py]) => {
    const point = mapPixelToWorld(px, py)
    addPixelBench(THREE, root, point.x, point.z, mats)
  })
  ;[[295,175],[405,165],[445,350],[640,345],[700,335],[785,315],[520,445],[610,445],[730,435],[185,330],[245,415],[800,175]].forEach(([px, py]) => {
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
  const spawn = mapPixelToWorld(...CAMPUS_PLAYER_SPAWN_PIXEL)
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
  root.userData.assetStyle = 'isometric-pixel-campus'
  root.userData.coordinateSystem = 'campus-plan-pixel-to-world'
  return root
}
