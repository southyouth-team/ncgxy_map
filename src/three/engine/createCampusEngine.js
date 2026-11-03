import * as THREE from 'three'
import { createCampusScene } from '../world/campus/createCampusScene.js'
import { createRpgSampleScene } from '../world/campus/createRpgSampleScene.js'
import { CameraRig } from '../camera/CameraRig.js'
import { InputController } from '../controls/InputController.js'
import { CollisionWorld } from '../physics/CollisionWorld.js'
import { createIndoorFloor } from '../indoor/indoorScene.js'
import { indoorBuildingDefinitions, validateIndoorBuilding, createIndoorBuildingFromFootprint } from '../indoor/indoorBuildingDefinitions.js'
import { loadCampusBuildingModels } from '../world/buildings/loadCampusBuildingModels.js'
import { CAMPUS_AREAS, CAMPUS_PLAYER_SPAWN_PIXEL, mapPixelToWorld } from '../../data/campus/campusLayout.js'
import { roadNetworkToMultiPolygon } from '../../editor/campusEditorDocument.js'
import { mapEditorPointToCalibratedWorld } from '../../editor/campusMapCalibration.js'
import { createCampusMaterials, createPixelBuilding, validateBuildingFootprint } from '../world/campus/campusAssetLibrary.js'

export function createCampusEngine(container, callbacks = {}, options = {}) {
  const isRpgSample = options.sceneType === 'rpg-sample'
  let renderer
  let scene
  let campus
  let lastPlayerX = 0
  let lastPlayerZ = 24
  let cameraRig
  let input
  let collisionWorld
  let outdoorCollisionWorld = null
  let indoorGroup = null
  let indoorBuilding = null
  let indoorOutdoorTarget = null
  let indoorOutdoorBase = null
  let currentIndoorFloor = null
  let stairInteractionActive = false
  let nearIndoorRoom = null
  let nearIndoorExit = false
  let activeIndoorRoom = null
  let roomReturnPosition = null
  let stairTransition = null
  let outdoorState = null
  let nearOutdoorEntrance = false
  let frameId = 0
  let resizeObserver
  let previousTime = 0
  let initialized = false
  let selectedFeatureObject = null
  let selectedIndoorObject = null
  let rpgPreviewGroup = null
  let editorPreviewActive = false
  let loadedBuildingModels = []
  const outdoorBuildingBaselines = new WeakMap()
  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  let pointerStart = null

  async function init() {
    if (!container) throw new Error('未找到三维场景容器')

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#b9d0c2')
    scene.fog = new THREE.Fog('#b9d0c2', 115, 310)

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false })
    // 固定 1x 渲染倍率，避免高 DPI 屏幕二次缩放破坏像素边缘。
    renderer.setPixelRatio(1)
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.BasicShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // 保留像素美术标准色板，避免电影色调映射改变颜色。
    renderer.toneMapping = THREE.NoToneMapping
    container.appendChild(renderer.domElement)

    // 南昌工学院像素校园是默认主场景，不再由空 GIS 接口或演示数据替换。
    campus = isRpgSample ? createRpgSampleScene(THREE) : createCampusScene(THREE)
    scene.add(campus)
    cameraRig = new CameraRig(THREE, renderer.domElement, { isometricRpg: isRpgSample })
    // 默认示意场景的人物出生点与可见 Sprite 保持一致，避免相机从地图中心凭空出现。
    const playerSprite = campus.getObjectByName('PixelExplorerSprite')
    const fallbackSpawn = mapPixelToWorld(...CAMPUS_PLAYER_SPAWN_PIXEL)
    const spawn = campus.userData.playerSpawn || fallbackSpawn
    cameraRig.player.set(playerSprite?.position.x ?? spawn.x, 1.7, playerSprite?.position.z ?? spawn.z)
    if (isRpgSample) cameraRig.focusBounds(campus.userData.sampleBounds.width, campus.userData.sampleBounds.depth)
    // 从明确标记为建筑的场景对象提取世界包围盒，避免把道路、树木等误判为墙体。
    campus.updateMatrixWorld(true)
    const buildingObstacles = []
    const circularObstacles = []
    const cameraObstacleRoots = []
    campus.traverse((object) => {
      if (!(object.userData?.buildingId || object.userData?.objectType === 'building')) return
      cameraObstacleRoots.push(object)
      const bounds = new THREE.Box3().setFromObject(object)
      if (bounds.isEmpty()) return
      if (isRpgSample && object.userData?.buildingId === 'sample-teaching-building') {
        // 样板教学楼按墙体分段碰撞，正门中间留出通行口；不再用整栋 AABB 封死入口。
        const centerX = (bounds.min.x + bounds.max.x) / 2
        // 按建筑墙体实际位置生成碰撞边界，屋檐和台阶不参与墙体定位。
        const frontZ = object.position.z + 4.28
        const backZ = object.position.z - 4.28
        const sideWidth = 0.55
        const doorHalfWidth = 1.08
        const wallDepth = 0.5
        buildingObstacles.push(
          { minX: bounds.min.x, maxX: centerX - doorHalfWidth, minZ: frontZ - wallDepth, maxZ: frontZ + 0.12 },
          { minX: centerX + doorHalfWidth, maxX: bounds.max.x, minZ: frontZ - wallDepth, maxZ: frontZ + 0.12 },
          { minX: bounds.min.x, maxX: bounds.max.x, minZ: backZ - 0.12, maxZ: backZ + wallDepth },
          { minX: bounds.min.x, maxX: bounds.min.x + sideWidth, minZ: backZ, maxZ: frontZ },
          { minX: bounds.max.x - sideWidth, maxX: bounds.max.x, minZ: backZ, maxZ: frontZ },
        )
      } else {
        buildingObstacles.push({
          minX: bounds.min.x, maxX: bounds.max.x,
          minZ: bounds.min.z, maxZ: bounds.max.z,
        })
      }
    })
    // 树冠用于视觉遮挡，碰撞仅按树干半径计算，避免把整片树冠误判成墙。
    campus.traverse((object) => {
      const radius = Number(object.userData?.collisionRadius)
      if (!(radius > 0)) return
      const position = object.getWorldPosition(new THREE.Vector3())
      circularObstacles.push({ x: position.x, z: position.z, radius })
    })
    collisionWorld = new CollisionWorld(campus.userData.walkableBounds, buildingObstacles, 0.62)
    // 树木、长椅和路灯使用圆形碰撞体，避免 AABB 方形外扩占用过多步行空间。
    for (const obstacle of circularObstacles) collisionWorld.addCircleObstacle(obstacle)
    // 湖水不可通行；中央湖区保留 holes 中定义的岛屿步行区域。
    for (const area of (isRpgSample ? [] : CAMPUS_AREAS.filter(item => item.type === 'water' && item.polygon?.length >= 3))) {
      const toWorldRing = ring => ring.map(([x, y]) => {
        const point = mapPixelToWorld(x, y)
        return [point.x, point.z]
      })
      collisionWorld.addPolygonObstacle({
        outer: toWorldRing(area.polygon),
        holes: (area.holes || []).map(toWorldRing),
      })
    }
    outdoorCollisionWorld = collisionWorld
    cameraRig.setObstructionObjects(cameraObstacleRoots)
    // GLB 建筑异步加载完成后，动态注册碰撞体；避免首帧碰撞世界漏掉外部模型。
    if (!isRpgSample) {
      loadCampusBuildingModels(scene)
        .then((result) => {
          loadedBuildingModels = result.models || []
          for (const model of loadedBuildingModels) {
            model.visible = !editorPreviewActive
            model.userData.objectType = 'building'
            model.updateMatrixWorld(true)
            const bounds = new THREE.Box3().setFromObject(model)
            if (!bounds.isEmpty()) outdoorCollisionWorld.addObstacle({
              minX: bounds.min.x, maxX: bounds.max.x,
              minZ: bounds.min.z, maxZ: bounds.max.z,
            })
          }
          cameraRig?.setObstructionObjects([...cameraObstacleRoots, ...loadedBuildingModels])
          callbacks.onAssetsLoaded?.(result)
        })
        .catch((error) => callbacks.onAssetError?.(error))
    }
    input = new InputController(THREE, renderer.domElement, cameraRig, campus.userData.walkableBounds, collisionWorld)
    input.attach()
    renderer.domElement.addEventListener('pointerdown', onScenePointerDown)
    renderer.domElement.addEventListener('pointerup', onScenePointerUp)

    const hemi = new THREE.HemisphereLight(0xfff2d8, 0x71865e, 2.2)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffe2b2, 2.7)
    sun.position.set(-55, 90, 45)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -100
    sun.shadow.camera.right = 100
    sun.shadow.camera.top = 100
    sun.shadow.camera.bottom = -100
    sun.shadow.bias = -0.0002
    scene.add(sun)

    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()
    window.addEventListener('keydown', onKeyDown)
    initialized = true
    callbacks.onReady?.()
    animate(0)
  }


  function disposeMaterial(material) {
    if (!material) return
    // 材质贴图需要单独释放；像素样板新增 CanvasTexture 后不能只 dispose 材质本身。
    for (const key of ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
      material[key]?.dispose?.()
    }
    material.dispose?.()
  }

  function disposeObjectGroup(group) {
    group?.traverse((object) => {
      object.geometry?.dispose?.()
      if (Array.isArray(object.material)) object.material.forEach(disposeMaterial)
      else disposeMaterial(object.material)
    })
  }

  function clearRpgPreview() {
    editorPreviewActive = false
    if (rpgPreviewGroup) {
      scene?.remove(rpgPreviewGroup)
      disposeObjectGroup(rpgPreviewGroup)
      rpgPreviewGroup = null
    }
    // 基础校园由 campus 容器和独立加载的 GLB 建筑共同组成。
    // 预览退出时必须恢复两类对象，不能只恢复 campus 容器。
    if (campus) campus.visible = true
    loadedBuildingModels.forEach((model) => { model.visible = true })
    cameraRig?.setObstructionObjects([
      ...(campus ? (() => { const roots = []; campus.traverse(object => { if (object.userData?.buildingId || object.userData?.objectType === 'building') roots.push(object) }); return roots })() : []),
      ...loadedBuildingModels,
    ])
    if (outdoorCollisionWorld && !indoorGroup) {
      collisionWorld = outdoorCollisionWorld
      if (input) input.collisionWorld = collisionWorld
    }
  }

  function previewRpgMap(document) {
    if (!scene || !document?.grid || !Array.isArray(document.layers)) return false
    clearRpgPreview()
    editorPreviewActive = true
    const width = Number(document.grid.width), height = Number(document.grid.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return false
    const unit = Number(document.worldUnitsPerTile) > 0 ? Number(document.worldUnitsPerTile) : 1
    const originX = -width * unit / 2, originZ = -height * unit / 2
    const palette = { grass:'#6eaa55','grass-dark':'#4f8745',dirt:'#b58a55',sand:'#d7c17c',stone:'#a5a69a',road:'#77796f','road-edge':'#aaa58c',water:'#4c9db5','water-deep':'#367c9d' }
    rpgPreviewGroup = new THREE.Group()
    rpgPreviewGroup.name = 'RpgMapLivePreview'
    const geometry = new THREE.BoxGeometry(unit, 0.12, unit), materials = new Map()
    for (const layer of document.layers) {
      if (layer.visible === false || layer.type !== 'tile') continue
      for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
        const tile=layer.tiles?.[y]?.[x]; if (!tile) continue
        const color=palette[tile] || '#777777'
        if (!materials.has(color)) materials.set(color,new THREE.MeshStandardMaterial({color,roughness:1}))
        const mesh=new THREE.Mesh(geometry,materials.get(color))
        mesh.position.set(originX+(x+.5)*unit,0,originZ+(y+.5)*unit); mesh.receiveShadow=true
        rpgPreviewGroup.add(mesh)
      }
    }
    for (const object of document.objects || []) {
      const asset=String(object.assetId || ''), w=Math.max(.25,Number(object.width)||1)*unit, d=Math.max(.25,Number(object.height)||1)*unit
      const group=new THREE.Group(), material=new THREE.MeshStandardMaterial({color:object.color||'#39764a',roughness:.9})
      if (asset==='tree') {
        const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.09*unit,.12*unit,1.15*unit,6),new THREE.MeshStandardMaterial({color:'#765238'})); trunk.position.y=.575*unit
        const crown=new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,d)*.42,1.8*unit,7),material); crown.position.y=1.85*unit; group.add(trunk,crown)
      } else if (asset==='lamp') {
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(.045*unit,.07*unit,2.3*unit,6),new THREE.MeshStandardMaterial({color:'#4d5148'})); pole.position.y=1.15*unit
        const lamp=new THREE.Mesh(new THREE.SphereGeometry(.16*unit,7,5),new THREE.MeshStandardMaterial({color:'#f2d98a',emissive:'#80652c'})); lamp.position.y=2.35*unit; group.add(pole,lamp)
      } else {
        const h=(asset==='bridge'?.38:.22)*unit, mesh=new THREE.Mesh(new THREE.BoxGeometry(w*.92,h,d*.92),material); mesh.position.y=h/2; group.add(mesh)
      }
      group.position.set(originX+(Number(object.x)+w/unit/2)*unit,0,originZ+(Number(object.y)+d/unit/2)*unit)
      group.rotation.y=-(Number(object.rotation)||0)*Math.PI/180
      group.userData.rpgObjectId=object.id; rpgPreviewGroup.add(group)
    }
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(width*unit,height*unit),new THREE.MeshStandardMaterial({color:'#6eaa55',roughness:1}))
    ground.rotation.x=-Math.PI/2; ground.position.set(0,-.09,0); ground.receiveShadow=true; rpgPreviewGroup.add(ground)
    scene.add(rpgPreviewGroup)
    if (campus) campus.visible = false
    loadedBuildingModels.forEach((model) => { model.visible = false })
    cameraRig?.focusBounds(width*unit,height*unit)
    return true
  }

  function previewCampusPlan(document) {
    if (!scene || !document || !Array.isArray(document.buildings) || !Array.isArray(document.roads)) return false
    clearRpgPreview()
    editorPreviewActive = true
    rpgPreviewGroup = new THREE.Group()
    rpgPreviewGroup.name = 'CampusPlanLivePreview'

    // 保留校园漫游人物：从原始校园场景复制 Sprite 到编辑预览层，
    // 使二维编辑切换到三维预览时仍能看到人物尺度参照。
    const sourcePlayer = campus?.getObjectByName('PixelExplorerSprite')
    if (sourcePlayer?.isSprite) {
      const previewPlayer = sourcePlayer.clone()
      previewPlayer.name = 'CampusPlanPlayerSprite'
      previewPlayer.material = sourcePlayer.material.clone()
      previewPlayer.position.copy(sourcePlayer.position)
      previewPlayer.scale.copy(sourcePlayer.scale)
      previewPlayer.visible = true
      rpgPreviewGroup.add(previewPlayer)
    }
    const calibratedPoint = (x, y) => mapEditorPointToCalibratedWorld(
      [x, y],
      document.calibration,
      document.referenceImage,
      Number(document.worldUnitsPerCampusUnit || 1),
    ) || mapPixelToWorld(x, y)

    // 世界范围从完整编辑文档计算，不再假设校园永远只有 640×480 / 150×96。
    // workspaceBounds 包含视口原点参考范围和超出底图的新增要素。
    const sourcePoints = []
    const addSourcePoints = (points) => {
      if (Array.isArray(points)) for (const point of points) {
        if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) sourcePoints.push(point)
      }
    }
    for (const building of document.buildings || []) {
      if (Array.isArray(building.footprint)) addSourcePoints(building.footprint)
      else if (Array.isArray(building.rect)) {
        const [left, top, right, bottom] = building.rect
        addSourcePoints([[left, top], [right, top], [right, bottom], [left, bottom]])
      }
    }
    for (const area of document.areas || []) {
      if (Array.isArray(area.polygon)) addSourcePoints(area.polygon)
      else if (Array.isArray(area.rect)) {
        const [left, top, right, bottom] = area.rect
        addSourcePoints([[left, top], [right, top], [right, bottom], [left, bottom]])
      }
    }
    for (const road of document.roads || []) addSourcePoints(road.points)
    const workspace = document.workspaceBounds
    if (workspace && [workspace.minX, workspace.minY, workspace.maxX, workspace.maxY].every(Number.isFinite)) {
      addSourcePoints([[workspace.minX, workspace.minY], [workspace.maxX, workspace.minY], [workspace.maxX, workspace.maxY], [workspace.minX, workspace.maxY]])
    }
    if (!sourcePoints.length) addSourcePoints([[36, 92], [612, 460]])
    const worldPoints = sourcePoints.map(([x, y]) => calibratedPoint(x, y))
    const minX = Math.min(...worldPoints.map(point => point.x))
    const maxX = Math.max(...worldPoints.map(point => point.x))
    const minZ = Math.min(...worldPoints.map(point => point.z))
    const maxZ = Math.max(...worldPoints.map(point => point.z))
    const centerX = (minX + maxX) / 2
    const centerZ = (minZ + maxZ) / 2
    const margin = Math.max(8, Math.max(maxX - minX, maxZ - minZ) * 0.04)
    const groundWidth = Math.max(20, maxX - minX + margin * 2)
    const groundDepth = Math.max(20, maxZ - minZ + margin * 2)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundWidth, groundDepth),
      new THREE.MeshStandardMaterial({ color: '#8eae69', roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.set(centerX, -0.12, centerZ)
    ground.receiveShadow = true
    rpgPreviewGroup.add(ground)

    for (const area of document.areas || []) {
      if (area.polygon?.length >= 3) {
        const points = area.polygon.map(([x, y]) => {
          const p = calibratedPoint(x, y)
          return new THREE.Vector2(p.x, -p.z)
        })
        const shape = new THREE.Shape(points)
        const mesh = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshStandardMaterial({ color: area.type === 'water' ? '#68b9b5' : '#a4bd83', roughness: 1 }),
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = 0.015
        mesh.receiveShadow = true
        rpgPreviewGroup.add(mesh)
      } else if (area.rect) {
        const [left, top, right, bottom] = area.rect
        const corners = [[left, top], [right, top], [right, bottom], [left, bottom]]
          .map(([x, y]) => calibratedPoint(x, y))
        const shape = new THREE.Shape(corners.map((point) => new THREE.Vector2(point.x, -point.z)))
        const mesh = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshStandardMaterial({ color: area.type === 'sports' ? '#b9b69f' : '#829a70', roughness: 1, side: THREE.DoubleSide }),
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = 0.02
        rpgPreviewGroup.add(mesh)
      }
    }

    const roadNetwork = roadNetworkToMultiPolygon(document.roads)
    roadNetwork.forEach((polygon, polygonIndex) => {
      const outer = polygon[0]
      if (!outer || outer.length < 4) return
      const toShapePoint = ([x, y]) => {
        const point = calibratedPoint(x, y)
        return new THREE.Vector2(point.x, -point.z)
      }
      const shape = new THREE.Shape(outer.slice(0, -1).map(toShapePoint))
      for (const hole of polygon.slice(1)) {
        if (hole.length < 4) continue
        const path = new THREE.Path(hole.slice(0, -1).map(toShapePoint))
        shape.holes.push(path)
      }
      const geometry = new THREE.ShapeGeometry(shape)
      geometry.rotateX(-Math.PI / 2)
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: '#c4a477', roughness: 1, side: THREE.DoubleSide }),
      )
      mesh.position.y = 0.075
      mesh.name = `RoadNetworkUnion-${polygonIndex + 1}`
      mesh.receiveShadow = true
      rpgPreviewGroup.add(mesh)
    })

    const buildingMaterials = createCampusMaterials(THREE)
    const invalidBuildingFootprints = []
    for (const building of document.buildings) {
      const footprint = Array.isArray(building.footprint) && building.footprint.length >= 3
        ? building.footprint
        : Array.isArray(building.rect) && building.rect.length === 4
          ? [[building.rect[0], building.rect[1]], [building.rect[2], building.rect[1]], [building.rect[2], building.rect[3]], [building.rect[0], building.rect[3]]]
          : null
      if (!footprint) continue
      const footprintValidation = validateBuildingFootprint(footprint)
      if (!footprintValidation.valid) {
        invalidBuildingFootprints.push({ id: building.id, label: building.label, errors: footprintValidation.errors })
        continue
      }
      const worldPoints = footprint.map(([x, y]) => {
        const point = calibratedPoint(x, y)
        return { x: point.x, z: point.z }
      })
      const minX = Math.min(...worldPoints.map(point => point.x))
      const maxX = Math.max(...worldPoints.map(point => point.x))
      const minZ = Math.min(...worldPoints.map(point => point.z))
      const maxZ = Math.max(...worldPoints.map(point => point.z))
      const centerX = (minX + maxX) / 2
      const centerZ = (minZ + maxZ) / 2
      const width = Math.max(4.2, maxX - minX)
      const depth = Math.max(2.4, maxZ - minZ)
      const localShape = new THREE.Shape(worldPoints.map(point => new THREE.Vector2(point.x - centerX, -(point.z - centerZ))))
      const height = Math.max(2.2, Number(building.height || building.floors * 0.45 || 3.4))
      const group = createPixelBuilding(THREE, {
        footprint: localShape,
        width,
        depth,
        height: building.height,
        floors: building.floors,
        roofStyle: building.roofStyle,
        roofRise: building.roofRise,
        windowDensity: building.windowDensity,
        windowWidth: building.windowWidth,
        windowHeight: building.windowHeight,
        doorWidth: building.doorWidth,
        entranceEdgeIndex: building.entranceEdgeIndex,
        template: building.template || building.label,
        materials: buildingMaterials,
        label: building.label || building.id || 'Campus Building',
        confidence: building.confidence || 'unverified',
      })
      group.position.set(centerX, 0.16, centerZ)
      group.userData.campusBuildingId = building.id
      group.userData.objectType = 'building'
      group.userData.displayName = building.label
      rpgPreviewGroup.add(group)
    }
    rpgPreviewGroup.userData.invalidBuildingFootprints = invalidBuildingFootprints
    if (invalidBuildingFootprints.length) {
      console.warn('三维预览已跳过无效建筑轮廓：', invalidBuildingFootprints)
    }

    scene.add(rpgPreviewGroup)
    cameraRig?.setObstructionObjects(rpgPreviewGroup.children.filter(object => object.userData?.objectType === 'building'))
    if (campus) campus.visible = false
    // GLB 建筑模型直接挂载在 scene 下，不属于 campus 容器；必须单独隐藏，
    // 否则预览中会同时残留原校园建筑，看起来像没有切换到编辑方案。
    loadedBuildingModels.forEach((model) => { model.visible = false })
    // 编辑器实时预览使用当前文档的地面边界和建筑碰撞体，不能沿用旧校园场景的碰撞数据。
    const previewBounds = {
      minX: centerX - groundWidth / 2, maxX: centerX + groundWidth / 2,
      minZ: centerZ - groundDepth / 2, maxZ: centerZ + groundDepth / 2,
    }
    const previewObstacles = []
    rpgPreviewGroup.updateMatrixWorld(true)
    rpgPreviewGroup.traverse(object => {
      if (object.userData?.objectType !== 'building') return
      const bounds = new THREE.Box3().setFromObject(object)
      if (!bounds.isEmpty()) previewObstacles.push({ minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z })
    })
    collisionWorld = new CollisionWorld(previewBounds, previewObstacles, 0.62)
    input.collisionWorld = collisionWorld
    const safeSpawn = collisionWorld.resolvePosition(cameraRig.player)
    cameraRig.player.x = safeSpawn.x
    cameraRig.player.z = safeSpawn.z
    cameraRig?.focusBounds(groundWidth, groundDepth, centerX, centerZ)
    if (cameraRig.mode === 'firstPerson') cameraRig.updateFirstPersonDesired()
    else if (cameraRig.mode === 'thirdPerson') cameraRig.updateThirdPersonDesired()
    return true
  }


  function onScenePointerDown(event) {
    if (event.button !== 0 || (cameraRig?.mode !== 'overview' && !indoorGroup)) { pointerStart = null; return }
    pointerStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }

  function onScenePointerUp(event) {
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
    pointerStart = null
    if (moved > 5 || (cameraRig?.mode !== 'overview' && !indoorGroup)) return
    const rect = renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointerNdc, cameraRig.camera)
    if (indoorGroup) {
      const indoorHits = raycaster.intersectObjects(indoorGroup.children, true)
      const indoorTarget = indoorHits.find(hit => hit.object.userData?.interactionData)?.object
      if (indoorTarget?.userData?.interactionData) {
        selectIndoorObject(indoorTarget)
        return
      }
    }
    const hits = raycaster.intersectObjects(campus.children, true)
    let target = hits[0]?.object || null
    while (target && target !== campus
      && !target.userData?.featureId
      && !target.userData?.buildingId
      && target.userData?.objectType !== 'landmark-label') target = target.parent
    if (!target || target === campus) return clearSelection()
    if (target.userData?.featureId) selectObject(target.userData.featureId)
    else selectCampusObject(target)
  }

  function selectCampusObject(target) {
    if (!target || target === campus) return clearSelection()
    if (selectedFeatureObject === target) return
    restoreSelectionHighlight()
    selectedIndoorObject = null
    selectedFeatureObject = target
    target.traverse((object) => {
      if (!object.isMesh || !object.material) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      object.userData.selectionOriginalMaterials = materials.map((material) => ({
        color: material.emissive?.getHex?.() ?? 0,
        intensity: material.emissiveIntensity ?? 1,
      }))
      materials.forEach((material) => {
        if (material.emissive) {
          material.emissive.set('#f0b84d')
          material.emissiveIntensity = 0.65
        }
      })
    })
    callbacks.onObjectSelected?.({
      featureId: null,
      buildingId: target.userData.buildingId || null,
      sceneObjectId: null,
      objectType: target.userData.objectType || (target.userData.buildingId ? 'building' : 'campus-object'),
      name: target.userData.displayName || target.name || '校园对象',
    })
  }

  function selectIndoorObject(target) {
    if (selectedFeatureObject) restoreSelectionHighlight()
    selectedIndoorObject = target
    callbacks.onObjectSelected?.({
      featureId: null,
      sceneObjectId: null,
      objectType: target.userData.interactionData.objectType,
      name: target.userData.interactionData.name,
      interaction: { ...target.userData.interactionData },
    })
  }

  function restoreSelectionHighlight() {
    if (!selectedFeatureObject) return
    selectedFeatureObject.traverse((object) => {
      const originals = object.userData?.selectionOriginalMaterials
      if (!originals || !object.material) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material, index) => {
        const original = originals[index]
        if (original && material.emissive) { material.emissive.setHex(original.color); material.emissiveIntensity = original.intensity }
      })
      delete object.userData.selectionOriginalMaterials
    })
    selectedFeatureObject = null
  }

  function selectObject(featureId) {
    const target = campus?.children?.find((item) => String(item.userData?.featureId) === String(featureId))
    if (!target) return clearSelection()
    if (selectedFeatureObject === target) return
    restoreSelectionHighlight()
    selectedIndoorObject = null
    selectedFeatureObject = target
    target.traverse((object) => {
      if (!object.isMesh || !object.material) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      object.userData.selectionOriginalMaterials = materials.map((material) => ({ color: material.emissive?.getHex?.() ?? 0, intensity: material.emissiveIntensity ?? 1 }))
      materials.forEach((material) => { if (material.emissive) { material.emissive.set('#f0b84d'); material.emissiveIntensity = 0.65 } })
    })
    callbacks.onObjectSelected?.({ featureId: String(target.userData.featureId), sceneObjectId: target.userData.sceneObjectId || null, objectType: target.userData.objectType || null, name: target.name })
  }

  function clearSelection() {
    if (!selectedFeatureObject && !selectedIndoorObject) return
    if (selectedFeatureObject) restoreSelectionHighlight()
    selectedIndoorObject = null
    callbacks.onObjectSelected?.(null)
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') input?.exitPointerLock()
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key.toLowerCase() !== 'e') return
    // 室外靠近教学楼正门按 E 进入；室内交互继续由同一按键处理。
    if (!indoorGroup) {
      if (nearOutdoorEntrance) enterIndoorPrototype()
      return
    }
    if (stairTransition) return
    if (nearIndoorExit) {
      exitIndoorPrototype()
      return
    }
    if (activeIndoorRoom && roomReturnPosition) {
      cameraRig.player.set(roomReturnPosition.x, roomReturnPosition.y, roomReturnPosition.z)
      activeIndoorRoom = null
      roomReturnPosition = null
      nearIndoorRoom = null
      cameraRig.updateThirdPersonDesired()
      callbacks.onIndoorStateChange?.({ active: true, floor: currentIndoorFloor, floors: indoorBuilding.floors.map(item => item.level), buildingId: indoorBuilding.id, buildingName: indoorBuilding.name, prototype: true, nearStairs: stairInteractionActive, nearRoom: null, activeRoom: null })
      return
    }
    if (nearIndoorRoom) {
      const interaction = indoorGroup.userData.roomInteractions?.find(item => item.roomId === nearIndoorRoom.roomId)
      if (!interaction) return
      roomReturnPosition = { x: cameraRig.player.x, y: cameraRig.player.y, z: cameraRig.player.z }
      activeIndoorRoom = { id: interaction.roomId, name: interaction.roomName }
      nearIndoorRoom = null
      cameraRig.player.x = interaction.inside.x
      cameraRig.player.z = interaction.inside.z
      cameraRig.updateThirdPersonDesired()
      callbacks.onIndoorStateChange?.({ active: true, floor: currentIndoorFloor, floors: indoorBuilding.floors.map(item => item.level), buildingId: indoorBuilding.id, buildingName: indoorBuilding.name, prototype: true, nearStairs: false, nearRoom: null, activeRoom: activeIndoorRoom })
      return
    }
    if (stairInteractionActive && indoorBuilding) {
      const levels = indoorBuilding.floors.map(floor => floor.level).sort((a, b) => a - b)
      const index = levels.indexOf(currentIndoorFloor)
      const target = levels[index + 1] ?? levels[index - 1]
      if (target !== undefined) beginStairTransition(target)
    }
  }

  function resize() {
    if (!renderer || !cameraRig) return
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    renderer.setSize(width, height)
    cameraRig.resize(width / height)
  }

  function animate(time) {
    frameId = requestAnimationFrame(animate)
    const delta = Math.min((time - (previousTime || time)) / 1000, 0.05)
    previousTime = time
    if (stairTransition) updateStairTransition(delta)
    else input?.update(delta)
    if (!indoorGroup && cameraRig?.player && isRpgSample) {
      const entrance = campus?.getObjectByName('sample-teaching-building')?.userData?.indoorEntrance
      if (entrance) {
        const building = campus.getObjectByName('sample-teaching-building')
        const worldEntrance = building.localToWorld(new THREE.Vector3(entrance.x, 0, entrance.z))
        const near = Math.hypot(cameraRig.player.x - worldEntrance.x, cameraRig.player.z - worldEntrance.z) <= entrance.radius
        if (near !== nearOutdoorEntrance) {
          nearOutdoorEntrance = near
          callbacks.onIndoorPromptChange?.(near ? { visible: true, text: '按 E 进入教学楼' } : { visible: false })
        }
      }
    }
    if (indoorGroup && cameraRig?.player && !stairTransition) {
      const point = indoorGroup.userData.stairPoint
      const exitPoint = indoorGroup.userData.exitInteractions?.[0]
      const nearExit = !activeIndoorRoom && exitPoint && Math.hypot(cameraRig.player.x - exitPoint.x, cameraRig.player.z - exitPoint.z) <= 1.7
      if (Boolean(nearExit) !== nearIndoorExit) {
        nearIndoorExit = Boolean(nearExit)
        callbacks.onIndoorPromptChange?.(nearExit ? { visible: true, text: '按 E 离开教学楼' } : { visible: false })
      }
      const nearStairs = !activeIndoorRoom && point && Math.hypot(cameraRig.player.x - point.x, cameraRig.player.z - point.z) <= 2.4
      const nearestRoom = activeIndoorRoom ? null : (indoorGroup.userData.roomInteractions || [])
        .map(item => ({ item, distance: Math.hypot(cameraRig.player.x - item.approach.x, cameraRig.player.z - item.approach.z) }))
        .filter(entry => entry.distance <= 1.7)
        .sort((a, b) => a.distance - b.distance)[0]?.item || null
      const nextRoom = nearestRoom ? { roomId: nearestRoom.roomId, roomName: nearestRoom.roomName } : null
      const roomChanged = nextRoom?.roomId !== nearIndoorRoom?.roomId
      if (Boolean(nearStairs) !== stairInteractionActive || roomChanged) {
        stairInteractionActive = Boolean(nearStairs)
        nearIndoorRoom = nextRoom
        callbacks.onIndoorStateChange?.({ active: true, floor: currentIndoorFloor, floors: indoorBuilding.floors.map(item => item.level), buildingId: indoorBuilding.id, buildingName: indoorBuilding.name, prototype: true, nearStairs: stairInteractionActive, nearRoom: nearIndoorRoom, activeRoom: activeIndoorRoom })
      }
    }
    const playerSprite = scene?.getObjectByName('CampusPlanPlayerSprite') || scene?.getObjectByName('PixelExplorerSprite')
    if (playerSprite && cameraRig?.player) {
      // 第一人称相机位于角色眼部，隐藏自身 Sprite，避免角色贴图遮挡视野。
      playerSprite.visible = cameraRig.mode !== 'firstPerson'
      playerSprite.position.set(cameraRig.player.x, isRpgSample ? 1.262 : 2.1, cameraRig.player.z)
      const dx = cameraRig.player.x - lastPlayerX
      const dz = cameraRig.player.z - lastPlayerZ
      const moving = dx * dx + dz * dz > 0.000001
      campus?.userData.updatePlayerAnimation?.(moving, time / 1000, dx, dz)
      lastPlayerX = cameraRig.player.x
      lastPlayerZ = cameraRig.player.z
    }
    cameraRig?.update(delta)
    renderer.render(scene, cameraRig.camera)
  }

  function updateSceneObject(sceneObject) {
    if (!loadedSceneData || !campus?.userData.isGISDriven || !sceneObject?.id) return false
    const item = loadedSceneData.objects.find((entry) => entry.sceneObject.id === sceneObject.id)
    if (!item) return false
    const current = campus.children.find((entry) => entry.userData?.sceneObjectId === sceneObject.id)
    if (!current) return false
    const wasSelected = selectedFeatureObject === current
    if (wasSelected) restoreSelectionHighlight()
    const replacement = buildFeatureObject(item.feature, sceneObject, {
      mapCoordinateToWorld: loadedSceneData.mapCoordinateToWorld,
    })
    const index = campus.children.indexOf(current)
    campus.remove(current)
    campus.add(replacement)
    campus.children.splice(campus.children.indexOf(replacement), 1)
    campus.children.splice(index, 0, replacement)
    current.traverse((object) => {
      object.geometry?.dispose?.()
      if (Array.isArray(object.material)) object.material.forEach(disposeMaterial)
      else disposeMaterial(object.material)
    })
    item.sceneObject = sceneObject
    if (wasSelected) selectObject(item.feature.id)
    return true
  }

  function buildIndoorFloor(level, transitionPosition = null) {
    const floor = indoorBuilding?.floors.find(item => item.level === level)
    if (!floor) return false
    const floorDefinition = indoorBuilding.footprint?.polygon?.length >= 3
      ? { ...floor, footprintPolygon: indoorBuilding.footprint.polygon.map(point => ({ x: point.x, z: point.z })) }
      : floor
    const group = createIndoorFloor(THREE, floorDefinition)
    group.position.y = (level - 1) * indoorBuilding.floorHeight
    scene.add(group)
    if (indoorGroup) { scene.remove(indoorGroup); disposeObjectGroup(indoorGroup) }
    indoorGroup = group
    currentIndoorFloor = level
    collisionWorld = new CollisionWorld(indoorBuilding.bounds, group.userData.collisionObstacles, 0.48)
    input.collisionWorld = collisionWorld
    cameraRig.player.set(transitionPosition?.x ?? floor.spawnPoint.x, group.position.y + floor.spawnPoint.y, transitionPosition?.z ?? floor.spawnPoint.z)
    if (cameraRig.mode === 'firstPerson') cameraRig.updateFirstPersonDesired()
    else cameraRig.updateThirdPersonDesired()
    stairInteractionActive = false
    nearIndoorRoom = null
    activeIndoorRoom = null
    roomReturnPosition = null
    callbacks.onIndoorStateChange?.({ active: true, floor: level, floors: indoorBuilding.floors.map(item => item.level), buildingId: indoorBuilding.id, buildingName: indoorBuilding.name, prototype: true, nearStairs: false, nearRoom: null, activeRoom: null })
    return true
  }

  function enterIndoorPrototype(definitionOverride = null) {
    if (!scene || indoorGroup) return false
    const definition = definitionOverride || indoorBuildingDefinitions.teachingBlockPrototype
    const errors = validateIndoorBuilding(definition)
    if (errors.length) throw new TypeError(errors.join('；'))
    indoorBuilding = definition
    callbacks.onIndoorPromptChange?.({ visible: false })
    nearOutdoorEntrance = false
    outdoorState = { visible: campus.visible, player: cameraRig.player.clone(), mode: cameraRig.mode, collisionWorld }
    campus.visible = false
    cameraRig.setMode('thirdPerson')
    input.setMode('thirdPerson')
    buildIndoorFloor(definition.floors[0].level)
    cameraRig.thirdDistance = 8
    cameraRig.updateThirdPersonDesired()
    return true
  }

  function syncOutdoorBuildingFootprint(definition) {
    if (!indoorOutdoorTarget || !indoorOutdoorBase || !definition?.footprintSize) return false
    const width = Number(definition.footprintSize.width)
    const depth = Number(definition.footprintSize.depth)
    if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) return false
    const expansion = definition.footprint?.expansion || {}
    const shiftX = (Number(expansion.east) - Number(expansion.west)) / 2
    const shiftZ = (Number(expansion.south) - Number(expansion.north)) / 2
    const polygon = definition.footprint?.polygon
    const rebuildOptions = indoorOutdoorTarget.userData?.rebuildOptions

    // 对程序化校园建筑按真实多边形重新生成建筑实体，不再用 scale 把矩形模型硬拉伸。
    if (rebuildOptions && Array.isArray(polygon) && polygon.length >= 3) {
      const target = indoorOutdoorTarget
      const geometryKey = JSON.stringify({
        polygon, width, depth,
        height: Number(definition.floorHeight) * definition.floors.length,
        floors: definition.floors.length,
        roofStyle: definition.exterior?.roofStyle || rebuildOptions.roofStyle || 'flat',
      })
      if (indoorOutdoorBase.geometryKey !== geometryKey) {
      const shape = new THREE.Shape()
      shape.moveTo(polygon[0].x, -polygon[0].z)
      polygon.slice(1).forEach(point => shape.lineTo(point.x, -point.z))
      shape.closePath()
      const rebuilt = createPixelBuilding(THREE, {
        ...rebuildOptions,
        footprint: shape,
        width,
        depth,
        height: Number(definition.floorHeight) * definition.floors.length,
        floors: definition.floors.length,
        roofStyle: definition.exterior?.roofStyle || rebuildOptions.roofStyle || 'flat',
        label: rebuildOptions.label || target.name,
      })
      const foundation = target.userData.foundationMesh
      target.children.slice().forEach(child => {
        if (child === foundation) return
        child.traverse?.(object => {
          object.geometry?.dispose?.()
        })
        target.remove(child)
      })
      rebuilt.position.y = Number(target.userData.generatedBuildingBaseY || 0)
      target.add(rebuilt)
      target.userData.generatedBuildingShell = rebuilt
      for (const key of ['floorCount', 'floorHeight', 'buildingHeight', 'roofStyle', 'entrance']) {
        if (rebuilt.userData[key] !== undefined) target.userData[key] = rebuilt.userData[key]
      }

      // 基座使用同一轮廓挤出，避免扩建后出现矩形底座露边。
      if (foundation) {
        foundation.geometry?.dispose?.()
        const foundationGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: false, curveSegments: 1 })
        foundationGeometry.rotateX(-Math.PI / 2)
        foundation.geometry = foundationGeometry
        foundation.position.set(0, 0.18, 0)
      }
      indoorOutdoorBase.geometryKey = geometryKey
      }
      target.scale.copy(indoorOutdoorBase.scale)
      target.position.set(
        indoorOutdoorBase.position.x + shiftX,
        indoorOutdoorBase.position.y,
        indoorOutdoorBase.position.z + shiftZ,
      )
      if (target.userData.foundationMesh) {
        target.userData.foundationMesh.position.set(target.position.x, 0, target.position.z)
      }
    } else {
      // 非程序化模型（含 RPG 样板手工建筑）暂保留原有包围盒缩放路径。
      indoorOutdoorTarget.scale.x = indoorOutdoorBase.scale.x * width / indoorOutdoorBase.width
      indoorOutdoorTarget.scale.z = indoorOutdoorBase.scale.z * depth / indoorOutdoorBase.depth
      indoorOutdoorTarget.position.x = indoorOutdoorBase.position.x + shiftX
      indoorOutdoorTarget.position.z = indoorOutdoorBase.position.z + shiftZ
    }
    indoorOutdoorTarget.updateMatrixWorld(true)

    // 室外碰撞体与重建后的建筑包围盒同步。
    if (!(isRpgSample && indoorOutdoorTarget.userData?.buildingId === 'sample-teaching-building') &&
        indoorOutdoorBase.collisionIndex >= 0 && outdoorCollisionWorld?.obstacles[indoorOutdoorBase.collisionIndex]) {
      if (rebuildOptions && Array.isArray(polygon) && polygon.length >= 3) {
        const worldPolygon = polygon.map(point => {
          const worldPoint = indoorOutdoorTarget.localToWorld(new THREE.Vector3(point.x, 0, point.z))
          return { x: worldPoint.x, z: worldPoint.z }
        })
        const xs = worldPolygon.map(point => point.x)
        const zs = worldPolygon.map(point => point.z)
        outdoorCollisionWorld.obstacles[indoorOutdoorBase.collisionIndex] = {
          polygon: worldPolygon,
          holes: [],
          minX: Math.min(...xs), maxX: Math.max(...xs),
          minZ: Math.min(...zs), maxZ: Math.max(...zs),
        }
      } else {
        const bounds = new THREE.Box3().setFromObject(indoorOutdoorTarget)
        outdoorCollisionWorld.obstacles[indoorOutdoorBase.collisionIndex] = {
          minX: bounds.min.x, maxX: bounds.max.x,
          minZ: bounds.min.z, maxZ: bounds.max.z,
        }
      }
    }
    cameraRig?.setObstructionObjects([
      ...(() => { const roots = []; campus?.traverse(object => { if (object.userData?.buildingId || object.userData?.objectType === 'building') roots.push(object) }); return roots })(),
      ...loadedBuildingModels,
    ])
    return true
  }

  function enterIndoorBuilding(buildingId, options = {}) {
    if (!campus || !buildingId || indoorGroup) return false
    const target = campus.getObjectByName(String(buildingId)) || campus.children.find(object =>
      String(object.userData?.buildingId || object.userData?.featureId || object.userData?.sceneObjectId || '') === String(buildingId))
    if (!target) return false
    let baseline = outdoorBuildingBaselines.get(target)
    if (!baseline) {
      const originalBounds = new THREE.Box3().setFromObject(target)
      baseline = {
        width: originalBounds.max.x - originalBounds.min.x,
        depth: originalBounds.max.z - originalBounds.min.z,
        bounds: { minX: originalBounds.min.x, maxX: originalBounds.max.x, minZ: originalBounds.min.z, maxZ: originalBounds.max.z },
        position: target.position.clone(),
        scale: target.scale.clone(),
      }
      outdoorBuildingBaselines.set(target, baseline)
    }
    target.position.copy(baseline.position)
    target.scale.copy(baseline.scale)
    target.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(target)
    indoorOutdoorTarget = target
    if (!Number.isInteger(baseline.collisionIndex)) {
      baseline.collisionIndex = outdoorCollisionWorld?.obstacles.findIndex(obstacle =>
        !obstacle.circle && !obstacle.polygon &&
        Math.abs(obstacle.minX - baseline.bounds.minX) < 0.001 &&
        Math.abs(obstacle.maxX - baseline.bounds.maxX) < 0.001 &&
        Math.abs(obstacle.minZ - baseline.bounds.minZ) < 0.001 &&
        Math.abs(obstacle.maxZ - baseline.bounds.maxZ) < 0.001) ?? -1
    }
    const collisionIndex = baseline.collisionIndex
    indoorOutdoorBase = {
      width: baseline.width,
      depth: baseline.depth,
      bounds: baseline.bounds,
      collisionIndex,
      position: baseline.position.clone(),
      scale: baseline.scale.clone(),
    }
    const footprint = {
      id: String(buildingId),
      name: options.name || target.userData?.name || target.name || '校园建筑',
      bounds: {
        minX: bounds.min.x, maxX: bounds.max.x,
        minZ: bounds.min.z, maxZ: bounds.max.z,
      },
    }
    // 默认室内楼层数和层高优先继承室外建筑生成器参数，避免第一次编辑就把原建筑压扁。
    const generationOptions = {
      ...options,
      floors: options.floors ?? options.floorsData?.length ?? target.userData?.floorCount ?? 1,
      floorHeight: options.floorHeight ?? target.userData?.floorHeight ?? 3.6,
    }
    const generated = createIndoorBuildingFromFootprint(footprint, generationOptions)
    const definition = options.definition || (Array.isArray(options.floorsData) && options.floorsData.length
      ? { ...generated, floors: options.floorsData, floorHeight: Number(options.floorHeight) || generated.floorHeight }
      : generated)
    return enterIndoorPrototype(definition)
  }

  function getIndoorBuildingDefinition() { return indoorBuilding ? JSON.parse(JSON.stringify(indoorBuilding)) : null }

  function updateIndoorBuildingDefinition(definition) {
    if (!indoorBuilding || !indoorGroup || !definition || definition.id !== indoorBuilding.id) return false
    const errors = validateIndoorBuilding(definition)
    if (errors.length) throw new TypeError(errors.join('；'))
    syncOutdoorBuildingFootprint(definition)
    const currentPosition = cameraRig.player.clone()
    indoorBuilding = definition
    const levels = definition.floors.map(item => item.level)
    const nextLevel = levels.includes(currentIndoorFloor) ? currentIndoorFloor : levels[0]
    buildIndoorFloor(nextLevel, { x: currentPosition.x, z: currentPosition.z })
    cameraRig.player.y = currentPosition.y
    cameraRig.updateThirdPersonDesired()
    callbacks.onIndoorStateChange?.({ active: true, floor: currentIndoorFloor, floors: levels, buildingId: indoorBuilding.id, buildingName: indoorBuilding.name, prototype: true, nearStairs: false, nearRoom: null, activeRoom: null })
    return true
  }

  function switchIndoorFloor(level) {
    if (!indoorGroup || !indoorBuilding || !Number.isInteger(level) || level === currentIndoorFloor || stairTransition) return false
    const transitionPosition = { x: cameraRig.player.x, z: cameraRig.player.z }
    return buildIndoorFloor(level, transitionPosition)
  }

  function beginStairTransition(targetLevel) {
    if (stairTransition || !indoorBuilding || !indoorGroup) return false
    const target = indoorBuilding.floors.find(floor => floor.level === targetLevel)
    if (!target) return false
    const direction = Math.sign(targetLevel - currentIndoorFloor)
    if (!direction) return false
    const stairPoint = indoorGroup.userData.stairPoint
    const fromY = cameraRig.player.y
    stairTransition = {
      targetLevel,
      fromX: cameraRig.player.x,
      toX: stairPoint.x,
      fromZ: cameraRig.player.z,
      toZ: stairPoint.z + direction * 2.1,
      fromY,
      toY: fromY + direction * indoorBuilding.floorHeight,
      elapsed: 0, duration: 2.8,
    }
    input.setMovementEnabled(false)
    return true
  }

  function updateStairTransition(delta) {
    if (!stairTransition) return
    const transition = stairTransition
    transition.elapsed = Math.min(transition.duration, transition.elapsed + delta)
    const progress = transition.elapsed / transition.duration
    const eased = progress * progress * (3 - 2 * progress)
    cameraRig.player.x = transition.fromX + (transition.toX - transition.fromX) * eased
    cameraRig.player.y = transition.fromY + (transition.toY - transition.fromY) * eased
    cameraRig.player.z = transition.fromZ + (transition.toZ - transition.fromZ) * eased
    if (cameraRig.mode === 'firstPerson') cameraRig.updateFirstPersonDesired()
    else cameraRig.updateThirdPersonDesired()
    if (progress >= 1) {
      stairTransition = null
      buildIndoorFloor(transition.targetLevel, { x: transition.toX, z: transition.toZ })
      input.setMovementEnabled(true)
    }
  }

  function exitIndoorPrototype() {
    if (!indoorGroup || !outdoorState) return false
    scene.remove(indoorGroup)
    disposeObjectGroup(indoorGroup)
    indoorGroup = null
    stairInteractionActive = false
    nearIndoorRoom = null
    nearIndoorExit = false
    callbacks.onIndoorPromptChange?.({ visible: false })
    activeIndoorRoom = null
    roomReturnPosition = null
    stairTransition = null
    input.setMovementEnabled(true)
    indoorBuilding = null
    indoorOutdoorTarget = null
    indoorOutdoorBase = null
    currentIndoorFloor = null
    campus.visible = outdoorState.visible
    nearOutdoorEntrance = false
    callbacks.onIndoorPromptChange?.({ visible: false })
    collisionWorld = outdoorState.collisionWorld
    input.collisionWorld = collisionWorld
    cameraRig.player.copy(outdoorState.player)
    cameraRig.setMode(outdoorState.mode === 'overview' ? 'thirdPerson' : outdoorState.mode)
    input.setMode(cameraRig.mode)
    cameraRig.updateThirdPersonDesired()
    outdoorState = null
    callbacks.onIndoorStateChange?.({ active: false })
    return true
  }

  function setVirtualKey(key, pressed) {
    input?.setVirtualKey(key, pressed)
  }

  function setMode(mode) {
    cameraRig?.setMode(mode)
    input?.setMode(mode)
  }

  function focusCampus() {
    cameraRig?.focusCampus()
    const spawn = isRpgSample ? campus?.userData.playerSpawn : mapPixelToWorld(...CAMPUS_PLAYER_SPAWN_PIXEL)
    input?.resetPosition(spawn || { x: 0, z: 14 })
  }

  function dispose() {
    cancelAnimationFrame(frameId)
    resizeObserver?.disconnect()
    window.removeEventListener('keydown', onKeyDown)
    renderer?.domElement?.removeEventListener('pointerdown', onScenePointerDown)
    renderer?.domElement?.removeEventListener('pointerup', onScenePointerUp)
    clearSelection()
    clearRpgPreview()
    if (indoorGroup) { scene?.remove(indoorGroup); disposeObjectGroup(indoorGroup); indoorGroup = null }
    input?.dispose()
    cameraRig?.dispose()
    scene?.traverse((object) => {
      object.geometry?.dispose?.()
      if (Array.isArray(object.material)) object.material.forEach(disposeMaterial)
      else disposeMaterial(object.material)
    })
    renderer?.dispose()
    renderer?.domElement?.remove()
    initialized = false
  }

  return { init, setMode, setVirtualKey, focusCampus, enterIndoorPrototype, enterIndoorBuilding, getIndoorBuildingDefinition, updateIndoorBuildingDefinition, switchIndoorFloor, exitIndoorPrototype, selectObject, clearSelection, updateSceneObject, previewRpgMap, previewCampusPlan, clearRpgPreview, dispose, get initialized() { return initialized } }
}
