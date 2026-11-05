import {
  CAMPUS_PLAN_REFERENCE, CAMPUS_PLAYER_SPAWN_PIXEL, getCampusFootprintBounds, mapPixelToWorld, mapRectToWorld,
} from '../../../data/campus/campusLayout.js'
import { createCampusSceneRenderData } from './campusSceneData.js'
import { resolveCampusBuildingDesign } from '../../../data/campus/campusAssetManifest.js'
import { createCampusPlayer } from './createCampusPlayer.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import {
  createCampusMaterials, addPixelTree, addPixelFlowerPatch,
  addPixelBench, addPixelLamp, createPixelBuilding,
} from './campusAssetLibrary.js'

// 等距像素风 2.5D 校园原型。空间轮廓来自示意图，程序化建筑不代表真实楼体测绘。
export function createCampusScene(THREE, featureCollection = null, visualAssets = {}) {
  const root = new THREE.Group()
  root.name = 'NanchangInstituteCampus'
  const mats = createCampusMaterials(THREE)
  const spatialLayers = createCampusSceneRenderData(featureCollection || undefined).layers
  const { areas: CAMPUS_AREAS, roads: CAMPUS_ROAD_CENTERLINES, buildings: CAMPUS_BUILDING_FOOTPRINTS, objects: CAMPUS_OBJECTS } = spatialLayers
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
  function addGroundPatch(name, rect, material, y = 0.015, featureId = null) {
    const bounds = mapRectToWorld(rect)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bounds.width, 0.08, bounds.depth), material)
    mesh.name = name
    mesh.position.set(bounds.x, y, bounds.z)
    mesh.receiveShadow = true
    root.add(mesh)
    return mesh
  }
  function addPolygon(name, polygon, material, y = 0.08, holes = [], featureId = null) {
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
    if (featureId !== null) { mesh.userData.featureId = featureId; mesh.userData.featureCategory = 'areas' }
    root.add(mesh)
    return mesh
  }

  addBox('campus-ground-soil', 0, -0.9, 0, worldWidth + 4, 0.9, worldDepth + 4, mats.trunk)
  // 校园底板外扩展远景地面，避免低角度旋转时露出矩形底板边缘。
  const horizonGround = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), mats.grassPlain)
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
      addPolygon('campus-' + area.id + '-bed', area.polygon, mats.waterEdge, 0.065, area.holes, area.id)
      addPolygon('campus-' + area.id + '-water', area.polygon, mats.water, 0.13, area.holes, area.id)
      continue
    }
    if (!area.rect && area.polygon?.length >= 3) {
      addPolygon('area-' + area.id, area.polygon, area.type === 'sports' ? mats.sports : mats.grassPlain, 0.025, area.holes, area.id)
      continue
    }
    if (!area.rect) continue
    if (area.type === 'sports') {
      if (area.polygon?.length >= 3) addPolygon('area-' + area.id + '-earth', area.polygon, mats.sports, 0.035, area.holes, area.id)
      else addGroundPatch('area-' + area.id + '-earth', area.rect, mats.sports, 0.035, area.id)
      const bounds = mapRectToWorld(area.rect)
      const inset = new THREE.Mesh(new THREE.BoxGeometry(bounds.width - 0.9, 0.035, bounds.depth - 0.9), mats.pathEdge)
      inset.position.set(bounds.x, 0.09, bounds.z)
      inset.userData.featureId = area.id
      inset.userData.featureCategory = 'areas'
      root.add(inset)
      const field = new THREE.Mesh(new THREE.BoxGeometry(bounds.width - 1.15, 0.04, bounds.depth - 1.15), mats.grassPlain)
      field.position.set(bounds.x, 0.12, bounds.z)
      field.userData.featureId = area.id
      field.userData.featureCategory = 'areas'
      root.add(field)
    } else if (area.type !== 'building-cluster') {
      addGroundPatch('area-' + area.id, area.rect, mats.grassPlain, 0.025, area.id)
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
      slab.userData.featureId = roadId
      slab.userData.featureCategory = 'roads'
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
    const roadWidth = Math.max(1.1, Number(road.width || 12) * worldWidth / (CAMPUS_PLAN_REFERENCE.mapBounds.right - CAMPUS_PLAN_REFERENCE.mapBounds.left) * 0.95)
    addPixelRoadLayer(road.id, sampledPoints, roadWidth * 1.22, 0.16, 0.105, mats.pathEdge, 'curb')
    addPixelRoadLayer(road.id, sampledPoints, roadWidth, 0.12, 0.205, mats.path, 'surface')
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
    const buildingTemplate = visualAssets.buildingTemplates?.find(entry => entry.templateId === item.modelTemplateId && entry.status === 'ready') || null
    const buildingDesign = buildingTemplate?.modelType === 'procedural' ? buildingTemplate.buildingDesign : resolveCampusBuildingDesign(visualAssets.manifest, item.id)
    const template = buildingDesign?.template || item.template || ['街区楼 A', '街区楼 B', '庭院楼', '坡顶楼'][index % 4]
    const buildingWallMaterial = buildingDesign ? (mats[buildingDesign.wallPalette] || mats.wallCream) : (mats[item.wall] || wallPalette[index % wallPalette.length])
    const localFootprint = item.polygon
      ? new THREE.Shape(item.polygon.map(([px, py]) => new THREE.Vector2(
        (px - (footprintBounds[0] + footprintBounds[2]) / 2) * (CAMPUS_PLAN_REFERENCE.worldWidth / (CAMPUS_PLAN_REFERENCE.mapBounds.right - CAMPUS_PLAN_REFERENCE.mapBounds.left)),
        -(py - (footprintBounds[1] + footprintBounds[3]) / 2) * (CAMPUS_PLAN_REFERENCE.worldWidth / (CAMPUS_PLAN_REFERENCE.mapBounds.right - CAMPUS_PLAN_REFERENCE.mapBounds.left)),
      )))
      : undefined
    const group = createPixelBuilding(THREE, {
      width, depth, footprint: localFootprint, height: buildingDesign?.height ?? item.height, template, materials: mats,
      wallMaterial: buildingWallMaterial,
      label: item.label || item.id,
      confidence: item.confidence || 'unverified',
      entranceEdgeIndex: item.entranceEdgeIndex,
      floors: buildingDesign?.floors ?? item.floors,
      roofStyle: buildingDesign?.roofStyle ?? item.roofStyle,
      roofRise: buildingDesign?.roofRise ?? item.roofRise,
      windowDensity: buildingDesign?.windowDensity ?? item.windowDensity,
      windowWidth: buildingDesign?.windowWidth ?? item.windowWidth,
      windowHeight: buildingDesign?.windowHeight ?? item.windowHeight,
      doorWidth: buildingDesign?.doorWidth ?? item.doorWidth,
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
    if (buildingDesign) group.userData.buildingDesign = buildingDesign
    group.userData.buildingId = item.id
    group.userData.featureId = item.id
    group.userData.featureCategory = 'buildings'
    group.userData.walkable = item.walkable === true
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
      wallMaterial: buildingWallMaterial,
      template,
      label: item.label || item.id,
      confidence: item.confidence || 'unverified',
      height: buildingDesign?.height ?? item.height,
      floors: buildingDesign?.floors ?? item.floors,
      roofStyle: buildingDesign?.roofStyle ?? item.roofStyle,
      roofRise: buildingDesign?.roofRise ?? item.roofRise,
      windowDensity: buildingDesign?.windowDensity ?? item.windowDensity,
      windowWidth: buildingDesign?.windowWidth ?? item.windowWidth,
      windowHeight: buildingDesign?.windowHeight ?? item.windowHeight,
      doorWidth: buildingDesign?.doorWidth ?? item.doorWidth,
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

    // 同一套真实 3D Mesh 同时服务 2.5D 与 3D；参考图只用于 AI 识别和工坊审核，不进入运行时场景。
    group.userData.visualAssetSource = buildingTemplate?.modelType === 'glb' ? 'published-glb-template' : buildingDesign ? 'ai-reference-derived-procedural-3d' : 'procedural-3d'
    group.userData.modelTemplateId = buildingTemplate?.templateId || null
    group.userData.referenceAssetId = visualAssets.manifest?.bindings?.find(binding => String(binding.featureId) === String(item.id))?.assetId || null
    if (buildingTemplate?.modelType === 'glb' && buildingTemplate.modelFile?.url && visualAssets.assetBaseUrl) {
      const modelUrl = visualAssets.assetBaseUrl.replace(/\\/+$/, '') + buildingTemplate.modelFile.url
      new GLTFLoader().load(modelUrl, gltf => {
        const model = gltf.scene
        const modelBounds = new THREE.Box3().setFromObject(model)
        const modelSize = modelBounds.getSize(new THREE.Vector3())
        const fit = Math.min(width / Math.max(modelSize.x, 0.001), depth / Math.max(modelSize.z, 0.001), Math.max(2, buildingDesign?.height || item.height || 20) / Math.max(modelSize.y, 0.001))
        model.scale.setScalar(fit)
        const fittedBounds = new THREE.Box3().setFromObject(model)
        const center = fittedBounds.getCenter(new THREE.Vector3())
        model.position.set(-center.x, -fittedBounds.min.y, -center.z)
        model.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true } })
        group.traverse(node => {
          if (node === group) return
          if (node.geometry) node.geometry.dispose()
        })
        group.clear()
        group.add(model)
        group.userData.visualAssetSource = 'published-glb-template'
      }, undefined, error => console.warn('[BuildingTemplate] GLB 加载失败，保留程序化建筑回退：', buildingTemplate.templateId, error))
    }
  }
  CAMPUS_BUILDING_FOOTPRINTS.forEach(addCampusBuilding)

  // 用户编辑的 Point Feature 直接参与主场景构建，位置和属性不再只存在于编辑器预览层。
  CAMPUS_OBJECTS.forEach((item, index) => {
    const point = mapPixelToWorld(item.position[0], item.position[1])
    let object
    if (item.type === 'tree') object = addPixelTree(THREE, root, point.x, point.z, 1, index, mats)
    else if (item.type === 'flower') object = addPixelFlowerPatch(THREE, root, point.x, point.z, mats, index % 2 ? 4 : 6)
    else if (['bench', 'seat'].includes(item.type)) object = addPixelBench(THREE, root, point.x, point.z, mats)
    else if (['streetlight', 'lamp'].includes(item.type)) object = addPixelLamp(THREE, root, point.x, point.z, mats)
    else {
      object = new THREE.Group()
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), mats.stone)
      marker.position.y = 0.6
      object.add(marker)
      object.position.set(point.x, 0, point.z)
      root.add(object)
    }
    if (object) {
      object.name = 'campus-feature-' + item.id
      object.userData.featureId = item.id
      object.userData.featureCategory = 'objects'
      object.userData.displayName = item.name || item.type
      object.userData.objectType = item.type
      object.userData.walkable = item.walkable === true
      object.rotation.y = Number(item.rotation || 0) * Math.PI / 180
      object.scale.multiplyScalar(item.scale || 1)
    }
  })

  // 环境资产全部由统一 FeatureCollection 驱动；不再在渲染器内维护独立坐标清单。


  const character = createCampusPlayer(THREE)
  const spawn = mapPixelToWorld(...CAMPUS_PLAYER_SPAWN_PIXEL)
  character.position.set(spawn.x, 0, spawn.z)
  root.add(character)
  root.userData.playerSprite = character
  root.userData.updatePlayerAnimation = (moving, seconds, dx = 0, dz = 0) => {
    character.userData.updateAnimation?.call(character, moving, seconds, dx, dz)
  }

  // 活动边界以所有空间要素的真实几何范围计算，而不是以底图矩形计算。
  // 这样湖泊、操场、建筑和外围道路即使超出参考底图边框，也仍在可活动区域内。
  const contentBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  const includePixelCoordinate = coordinate => {
    if (!Array.isArray(coordinate) || coordinate.length < 2 ||
      !Number.isFinite(Number(coordinate[0])) || !Number.isFinite(Number(coordinate[1]))) return
    const point = mapPixelToWorld(Number(coordinate[0]), Number(coordinate[1]))
    contentBounds.minX = Math.min(contentBounds.minX, point.x)
    contentBounds.maxX = Math.max(contentBounds.maxX, point.x)
    contentBounds.minZ = Math.min(contentBounds.minZ, point.z)
    contentBounds.maxZ = Math.max(contentBounds.maxZ, point.z)
  }
  const includeCoordinates = value => {
    if (!Array.isArray(value)) return
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      includePixelCoordinate(value)
      return
    }
    value.forEach(includeCoordinates)
  }
  const includePixelRect = rect => {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return
    const [left, top, right, bottom] = rect
    includePixelCoordinate([left, top])
    includePixelCoordinate([right, bottom])
  }
  CAMPUS_AREAS.forEach(area => {
    includeCoordinates(area.polygon || [])
    includeCoordinates(area.holes || [])
    includePixelRect(area.rect)
  })
  CAMPUS_BUILDING_FOOTPRINTS.forEach(building => {
    includeCoordinates(building.polygon || building.footprint || [])
    includePixelRect(building.rect)
  })
  includeCoordinates(CAMPUS_ROAD_CENTERLINES.map(road => road.points || []))
  includeCoordinates(CAMPUS_OBJECTS.map(object => object.position || []))
  includeCoordinates(spatialLayers.boundary?.geometry?.coordinates || [])
  includeCoordinates(spatialLayers.gates.map(gate => gate.position || []))
  const maxRoadHalfWidth = Math.max(0, ...CAMPUS_ROAD_CENTERLINES.map(road =>
    Number(road.width || 12) * worldWidth /
      (CAMPUS_PLAN_REFERENCE.mapBounds.right - CAMPUS_PLAN_REFERENCE.mapBounds.left) * 0.7,
  ))
  const contentMargin = Math.max(2.5, maxRoadHalfWidth + 1.25)
  if (Number.isFinite(contentBounds.minX) && Number.isFinite(contentBounds.minZ)) {
    // 首屏构图与漫游边界使用同一份实际内容包络；相机聚焦不应把底图原点误当成校园中心。
    root.userData.contentBounds = {
      minX: contentBounds.minX,
      maxX: contentBounds.maxX,
      minZ: contentBounds.minZ,
      maxZ: contentBounds.maxZ,
      centerX: (contentBounds.minX + contentBounds.maxX) / 2,
      centerZ: (contentBounds.minZ + contentBounds.maxZ) / 2,
      width: contentBounds.maxX - contentBounds.minX,
      depth: contentBounds.maxZ - contentBounds.minZ,
    }
    root.userData.walkableBounds = {
      minX: contentBounds.minX - contentMargin,
      maxX: contentBounds.maxX + contentMargin,
      minZ: contentBounds.minZ - contentMargin,
      maxZ: contentBounds.maxZ + contentMargin,
    }
  } else {
    // 防御性回退：正常校园数据应始终包含边界 Polygon。
    root.userData.walkableBounds = {
      minX: -worldWidth / 2 - contentMargin,
      maxX: worldWidth / 2 + contentMargin,
      minZ: -worldDepth / 2 - contentMargin,
      maxZ: worldDepth / 2 + contentMargin,
    }
  }
  root.userData.isVisualPrototype = true
  root.userData.assetStyle = 'isometric-pixel-campus'
  root.userData.coordinateSystem = 'campus-plan-pixel-to-world'
  return root
}
