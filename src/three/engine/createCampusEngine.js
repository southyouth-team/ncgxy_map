import * as THREE from 'three'
import { createCampusScene } from '../world/campus/createCampusScene.js'
import { createCampusSceneRenderData } from '../world/campus/campusSceneData.js'
import { createRpgSampleScene } from '../world/campus/createRpgSampleScene.js'
import { CameraRig } from '../camera/CameraRig.js'
import { InputController } from '../controls/InputController.js'
import { CollisionWorld } from '../physics/CollisionWorld.js'
import { createIndoorFloor, getStairTraversalPoints, getStairStepHeight, isAtStairLanding, getIndoorInteractionPrompt, planIndoorFloorRoute } from '../indoor/indoorScene.js'
import { indoorBuildingDefinitions, validateIndoorBuilding, createIndoorBuildingFromFootprint, transformIndoorFootprint } from '../indoor/indoorBuildingDefinitions.js'
import { CAMPUS_AREAS, CAMPUS_PLAYER_SPAWN_PIXEL, mapPixelToWorld } from '../../data/campus/campusLayout.js'
import { roadNetworkToMultiPolygon } from '../../editor/campusEditorDocument.js'
import { fromCampusFeatureCollection, toCampusFeatureCollection } from '../../editor/campusFeatureCollection.js'
import { mapEditorPointToCalibratedWorld } from '../../editor/campusMapCalibration.js'
import { createCampusMaterials, createPixelBuilding, validateBuildingFootprint } from '../world/campus/campusAssetLibrary.js'

function getObjectLocalBounds(THREE, root) {
  root.updateWorldMatrix(true, true)
  const inverseRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const bounds = new THREE.Box3()
  let hasGeometry = false
  root.traverse(object => {
    if (!object.isMesh || !object.geometry) return
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
    if (!object.geometry.boundingBox) return
    const relativeMatrix = new THREE.Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld)
    const localGeometryBounds = object.geometry.boundingBox.clone().applyMatrix4(relativeMatrix)
    bounds.union(localGeometryBounds)
    hasGeometry = true
  })
  if (!hasGeometry) {
    const worldBounds = new THREE.Box3().setFromObject(root)
    const corners = []
    for (const x of [worldBounds.min.x, worldBounds.max.x]) {
      for (const y of [worldBounds.min.y, worldBounds.max.y]) {
        for (const z of [worldBounds.min.z, worldBounds.max.z]) {
          corners.push(root.worldToLocal(new THREE.Vector3(x, y, z)))
        }
      }
    }
    corners.forEach(point => bounds.expandByPoint(point))
  }
  return bounds
}

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
  let indoorPromptKey = ''
  let activeIndoorRoom = null
  let roomReturnPosition = null
  let pendingRoomTransition = null
  let stairTransition = null
  let outdoorState = null
  let nearOutdoorEntrance = false
  let nearOutdoorBuildingId = null
  // 建筑入口在场景初始化时索引；玩家未移动时不重复遍历整个校园场景树。
  let outdoorEntranceObjects = []
  let lastEntranceCheckPosition = null
  let frameId = 0
  let playerSpriteObject = null
  let resizeObserver
  let previousTime = 0
  let initialized = false
  let selectedFeatureObject = null
  let selectedIndoorObject = null
  let rpgPreviewGroup = null
  // 远景地面跟随当前相机的水平位置，避免低俯仰角下有限平面边缘进入视野。
  let activeHorizonGround = null
  let editorPreviewActive = false
  let loadedBuildingModels = []
  let buildingModelsLoadPromise = null
  let cameraObstacleRoots = []
  let disposed = false
  const outdoorBuildingBaselines = new WeakMap()
  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  let pointerStart = null
  let navigationVisualGroup = null
  let navigationWasActive = false
  let pendingIndoorFloorTarget = null
  // 同时兼容普通查询参数与 Vue Router Hash 路由中的查询参数。
  // 例如 /?render-debug=1 和 /#/map?render-debug=1 都应启用诊断。
  const renderDebugEnabled = (() => {
    const searchParams = new URLSearchParams(window.location.search)
    const hashQueryIndex = window.location.hash.indexOf('?')
    const hashQuery = hashQueryIndex >= 0 ? window.location.hash.slice(hashQueryIndex + 1) : ''
    const hashParams = new URLSearchParams(hashQuery)
    return searchParams.has('render-debug') || hashParams.has('render-debug')
  })()
  let renderDebugFrame = 0

  async function init() {
    if (!container) throw new Error('未找到三维场景容器')

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#b9d0c2')
    // 暂不启用线性雾效：低角度视线会让远处地面在固定深度区间内
    // 出现横向雾化分界，视觉上像场景被水平裁切；先保持背景色统一以排除该因素。
    scene.fog = null

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
    campus = isRpgSample ? createRpgSampleScene(THREE) : createCampusScene(THREE, options.featureCollection || null)
    scene.add(campus)
    cameraRig = new CameraRig(THREE, renderer.domElement, { isometricRpg: Boolean(options.isometricRpg ?? isRpgSample), viewMode: options.viewMode })
    // 默认示意场景的人物出生点与可见 Sprite 保持一致，避免相机从地图中心凭空出现。
    playerSpriteObject = campus.getObjectByName('PixelExplorerSprite')
    const fallbackSpawn = mapPixelToWorld(...CAMPUS_PLAYER_SPAWN_PIXEL)
    const spawn = campus.userData.playerSpawn || fallbackSpawn
    cameraRig.player.set(playerSpriteObject?.position.x ?? spawn.x, 1.7, playerSpriteObject?.position.z ?? spawn.z)
    if (isRpgSample && !options.deferInitialFocus) cameraRig.focusBounds(campus.userData.sampleBounds.width, campus.userData.sampleBounds.depth)
    // 从像素地图进入建筑时，先将室外角色恢复到离开前的地图坐标；
    // enterIndoorPrototype 会快照该位置，退出室内后即可回到原地。
    if (Number.isFinite(options.initialPlayerPosition?.x) && Number.isFinite(options.initialPlayerPosition?.z)) {
      cameraRig.player.set(options.initialPlayerPosition.x, 1.7, options.initialPlayerPosition.z)
      cameraRig.updateThirdPersonDesired()
    }
    // 从明确标记为建筑的场景对象提取世界包围盒，避免把道路、树木等误判为墙体。
    campus.updateMatrixWorld(true)
    outdoorEntranceObjects = []
    campus.traverse((object) => {
      if (object.userData?.indoorEntrance) {
        outdoorEntranceObjects.push({ object, worldPosition: new THREE.Vector3() })
      }
    })
    lastEntranceCheckPosition = null
    const buildingObstacles = []
    const circularObstacles = []
    const buildingWallSets = []
    cameraObstacleRoots = []
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
        object.userData.collisionObstacleStart = buildingObstacles.length
        buildingObstacles.push(
          { minX: bounds.min.x, maxX: centerX - doorHalfWidth, minZ: frontZ - wallDepth, maxZ: frontZ + 0.12 },
          { minX: centerX + doorHalfWidth, maxX: bounds.max.x, minZ: frontZ - wallDepth, maxZ: frontZ + 0.12 },
          { minX: bounds.min.x, maxX: bounds.max.x, minZ: backZ - 0.12, maxZ: backZ + wallDepth },
          { minX: bounds.min.x, maxX: bounds.min.x + sideWidth, minZ: backZ, maxZ: frontZ },
          { minX: bounds.max.x - sideWidth, maxX: bounds.max.x, minZ: backZ, maxZ: frontZ },
        )
        object.userData.collisionObstacleCount = 5
      } else if (Array.isArray(object.userData?.collisionSegments) && object.userData.collisionSegments.length) {
        // 按建筑生成器的墙体分段数据注册碰撞，门洞本身不生成障碍。
        const polygons = object.userData.collisionSegments.map(segment => {
          const start = object.localToWorld(new THREE.Vector3(segment.start.x, 0, -segment.start.y))
          const end = object.localToWorld(new THREE.Vector3(segment.end.x, 0, -segment.end.y))
          const dx = end.x - start.x, dz = end.z - start.z
          const length = Math.hypot(dx, dz) || 1
          const half = Math.max(0.12, Number(segment.thickness) || 0.28) / 2
          const nx = -dz / length * half, nz = dx / length * half
          return [
            [start.x + nx, start.z + nz], [end.x + nx, end.z + nz],
            [end.x - nx, end.z - nz], [start.x - nx, start.z - nz],
          ]
        })
        buildingWallSets.push({ object, polygons })
      } else if (Array.isArray(object.userData?.collisionPolygon) && object.userData.collisionPolygon.length >= 3) {
        const polygon = object.userData.collisionPolygon
        const xs = polygon.map(point => point[0])
        const zs = polygon.map(point => point[1])
        buildingObstacles.push({
          polygon,
          holes: [],
          minX: Math.min(...xs), maxX: Math.max(...xs),
          minZ: Math.min(...zs), maxZ: Math.max(...zs),
        })
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
    for (const { object, polygons } of buildingWallSets) {
      object.userData.collisionObstacleStart = collisionWorld.obstacles.length
      polygons.forEach(polygon => collisionWorld.addPolygonObstacle({ outer: polygon }))
      object.userData.collisionObstacleCount = collisionWorld.obstacles.length - object.userData.collisionObstacleStart
    }
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
    // 3D 建筑模型延迟到用户切换 3D/跟随视角时加载，2.5D 总览不承担 GLB 下载与解析成本。
    input = new InputController(THREE, renderer.domElement, cameraRig, campus.userData.walkableBounds, collisionWorld)
    input.attach()
    renderer.domElement.addEventListener('pointerdown', onScenePointerDown)
    renderer.domElement.addEventListener('pointerup', onScenePointerUp)
    renderer.domElement.addEventListener('pointerup', requestFrame)
    // 总览模式按需渲染：用户操作、相机阻尼或窗口变化时才请求下一帧。
    renderer.domElement.addEventListener('pointerdown', requestFrame)
    renderer.domElement.addEventListener('pointermove', requestFrame)
    renderer.domElement.addEventListener('wheel', requestFrame, { passive: true })
    if (cameraRig.viewMode === '3d') void ensureCampusBuildingModelsLoaded()

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
    requestFrame()
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

  function shouldShowBuildingModels() {
    return !editorPreviewActive && !indoorGroup
      && (cameraRig?.viewMode === '3d' || cameraRig?.mode !== 'overview')
  }

  async function ensureCampusBuildingModelsLoaded() {
    if (isRpgSample || loadedBuildingModels.length || !scene || disposed) return
    if (buildingModelsLoadPromise) return buildingModelsLoadPromise
    // GLB 模型体积较大；2.5D 总览使用程序化像素场景，不提前下载/解析 3D 建筑资产。
    buildingModelsLoadPromise = import('../world/buildings/loadCampusBuildingModels.js')
      .then(({ loadCampusBuildingModels }) => loadCampusBuildingModels(scene))
      .then((result) => {
        if (disposed || !scene) {
          for (const model of result.models || []) {
            model.parent?.remove(model)
            disposeObjectGroup(model)
          }
          return result
        }
        loadedBuildingModels = result.models || []
        for (const model of loadedBuildingModels) {
          model.visible = shouldShowBuildingModels()
          model.userData.objectType = 'building'
          model.updateMatrixWorld(true)
          const bounds = new THREE.Box3().setFromObject(model)
          if (!bounds.isEmpty()) outdoorCollisionWorld?.addObstacle({
            minX: bounds.min.x, maxX: bounds.max.x,
            minZ: bounds.min.z, maxZ: bounds.max.z,
          })
        }
        cameraRig?.setObstructionObjects([...cameraObstacleRoots, ...loadedBuildingModels])
        callbacks.onAssetsLoaded?.(result)
        return result
      })
      .catch((error) => {
        buildingModelsLoadPromise = null
        callbacks.onAssetError?.(error)
        return null
      })
    return buildingModelsLoadPromise
  }

  function clearRpgPreview() {
    editorPreviewActive = false
    activeHorizonGround = null
    if (rpgPreviewGroup) {
      scene?.remove(rpgPreviewGroup)
      disposeObjectGroup(rpgPreviewGroup)
      rpgPreviewGroup = null
    }
    playerSpriteObject = campus?.getObjectByName('PixelExplorerSprite') || null
    requestFrame()
    // 基础校园由 campus 容器和独立加载的 GLB 建筑共同组成。
    // 预览退出时必须恢复两类对象，不能只恢复 campus 容器。
    if (campus) campus.visible = true
    loadedBuildingModels.forEach((model) => { model.visible = shouldShowBuildingModels() })
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
    requestFrame()
    if (campus) campus.visible = false
    loadedBuildingModels.forEach((model) => { model.visible = false })
    cameraRig?.focusBounds(width*unit,height*unit)
    return true
  }

  function previewCampusPlan(document) {
    if (!scene || !document) return false
    // Prefer the canonical GeoJSON FeatureCollection; legacy arrays are a transitional UI adapter.
    if (document.featureCollection?.type === 'FeatureCollection') {
      const canonicalDocument = fromCampusFeatureCollection(document.featureCollection)
      const sharedRenderData = createCampusSceneRenderData(document.featureCollection)
      document = { ...document, ...canonicalDocument, ...sharedRenderData.previewDocument }
    } else {
      const legacyFeatureCollection = toCampusFeatureCollection(document)
      const sharedRenderData = createCampusSceneRenderData(legacyFeatureCollection)
      document = { ...document, ...sharedRenderData.previewDocument }
    }
    if (!Array.isArray(document.buildings) || !Array.isArray(document.roads)) return false
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
      playerSpriteObject = previewPlayer
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
    for (const object of document.objects || []) if (object.geometry?.type === 'Point') addSourcePoints([object.geometry.coordinates])
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
    // 内容边界只由校园要素/工作区决定；远景地面尺寸不能参与相机取景和角色活动边界计算。
    const contentWidth = Math.max(20, maxX - minX)
    const contentDepth = Math.max(20, maxZ - minZ)
    const margin = Math.max(8, Math.max(contentWidth, contentDepth) * 0.04)
    // 远景地面只负责填充视野，不代表校园内容范围。
    const groundWidth = Math.max(4000, contentWidth + margin * 2)
    const groundDepth = Math.max(4000, contentDepth + margin * 2)
    const ground = new THREE.Mesh(
      // 相机低角度观察时，地面边界会被投影成横向截断线；大尺寸平面并随相机水平位置移动，
      // 让地面边缘始终远离当前视锥体。校园内容边界仍使用独立的 contentWidth/contentDepth。
      new THREE.PlaneGeometry(Math.max(12000, groundWidth), Math.max(12000, groundDepth)),
      new THREE.MeshStandardMaterial({ color: '#8eae69', roughness: 1 }),
    )
    ground.name = 'campus-preview-horizon-ground'
    ground.rotation.x = -Math.PI / 2
    ground.position.set(centerX, -0.12, centerZ)
    ground.receiveShadow = true
    activeHorizonGround = ground
    rpgPreviewGroup.add(ground)

    for (const area of document.areas || []) {
      if (area.polygon?.length >= 3) {
        const points = area.polygon.map(([x, y]) => {
          const p = calibratedPoint(x, y)
          return new THREE.Vector2(p.x, -p.z)
        })
        const shape = new THREE.Shape(points)
        for (const hole of area.holes || []) {
          if (!Array.isArray(hole) || hole.length < 3) continue
          const holePoints = hole.map(([x, y]) => {
            const point = calibratedPoint(x, y)
            return new THREE.Vector2(point.x, -point.z)
          })
          shape.holes.push(new THREE.Path(holePoints))
        }
        const mesh = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshStandardMaterial({ color: ({ water: '#68b9b5', sports: '#b9b69f', vegetation: '#78936d', plaza: '#b8b2a0', parking: '#858b8d' }[area.type] || '#a4bd83'), roughness: area.type === 'water' ? 0.32 : 1 }),
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
          new THREE.MeshStandardMaterial({ color: ({ water: '#68b9b5', sports: '#b9b69f', vegetation: '#78936d', plaza: '#b8b2a0', parking: '#858b8d' }[area.type] || '#829a70'), roughness: area.type === 'water' ? 0.32 : 1, side: THREE.DoubleSide }),
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = 0.02
        rpgPreviewGroup.add(mesh)
      }
    }

    // 点/实例类对象直接从统一 Feature 文档生成；不再依赖画布硬编码装饰。
    for (const feature of document.objects || []) {
      if (feature.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) continue
      const point = calibratedPoint(feature.geometry.coordinates[0], feature.geometry.coordinates[1])
      const type = feature.type || feature.properties?.type || 'tree'
      const scale = Math.max(0.2, Number(feature.properties?.scale) || 1)
      const group = new THREE.Group()
      group.name = `campus-feature-${feature.id || type}`
      group.userData.campusFeatureId = feature.id
      group.userData.objectType = type
      group.position.set(point.x, 0, point.z)
      group.rotation.y = THREE.MathUtils.degToRad(Number(feature.properties?.rotation) || 0)
      if (type === 'tree') {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 1.1 * scale, 5), new THREE.MeshStandardMaterial({ color: '#79583b', roughness: 1 }))
        trunk.position.y = 0.55 * scale
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.72 * scale, 1.65 * scale, 6), new THREE.MeshStandardMaterial({ color: '#477b48', roughness: 1 }))
        crown.position.y = 1.75 * scale
        group.add(trunk, crown)
      } else if (type === 'streetlight') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * scale, 0.06 * scale, 2.8 * scale, 6), new THREE.MeshStandardMaterial({ color: '#59645e', metalness: 0.35, roughness: 0.6 }))
        pole.position.y = 1.4 * scale
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16 * scale, 8, 6), new THREE.MeshStandardMaterial({ color: '#f5dfa0', emissive: '#b68a42', emissiveIntensity: 0.25 }))
        lamp.position.set(0, 2.82 * scale, 0)
        group.add(pole, lamp)
      } else if (type === 'bench') {
        const material = new THREE.MeshStandardMaterial({ color: '#98734f', roughness: 0.9 })
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1 * scale, 0.12 * scale, 0.38 * scale), material)
        seat.position.y = 0.48 * scale
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.1 * scale, 0.48 * scale, 0.1 * scale), material)
        back.position.set(0, 0.76 * scale, -0.14 * scale)
        group.add(seat, back)
      } else {
        const sculpture = new THREE.Mesh(new THREE.OctahedronGeometry(0.55 * scale, 0), new THREE.MeshStandardMaterial({ color: '#8c7b9e', roughness: 0.65, metalness: 0.18 }))
        sculpture.position.y = 0.58 * scale
        group.add(sculpture)
      }
      group.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true } })
      rpgPreviewGroup.add(group)
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
      minX: minX - margin, maxX: maxX + margin,
      minZ: minZ - margin, maxZ: maxZ + margin,
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
    // 相机按真实校园内容范围取景，不能按 4000 单位的远景地面取景。
    cameraRig?.focusBounds(contentWidth + margin * 2, contentDepth + margin * 2, centerX, centerZ, { immediate: true })
    if (cameraRig.mode === 'firstPerson') cameraRig.updateFirstPersonDesired()
    else if (cameraRig.mode === 'thirdPerson') cameraRig.updateThirdPersonDesired()
    requestFrame()
    return true
  }


  function clearNavigationVisuals() {
    if (!navigationVisualGroup) return
    scene?.remove(navigationVisualGroup)
    disposeObjectGroup(navigationVisualGroup)
    navigationVisualGroup = null
  }

  function showNavigationVisuals(path) {
    clearNavigationVisuals()
    if (!Array.isArray(path) || path.length < 2) return
    navigationVisualGroup = new THREE.Group()
    navigationVisualGroup.name = 'IndoorNavigationVisuals'
    const points = path.map(point => new THREE.Vector3(point.x, 0.075, point.z))
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xf5c85b, transparent: true, opacity: 0.95 }),
    )
    navigationVisualGroup.add(line)
    const target = path[path.length - 1]
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0xffdf78, side: THREE.DoubleSide }),
    )
    marker.rotation.x = -Math.PI / 2
    marker.position.set(target.x, 0.09, target.z)
    navigationVisualGroup.add(marker)
    scene.add(navigationVisualGroup)
  }

  function navigateIndoorTo(point) {
    const graph = indoorGroup?.userData.navigationGraph
    const route = graph?.findPath(
      { x: cameraRig.player.x, z: cameraRig.player.z },
      { x: point.x, z: point.z },
    )
    if (route?.length > 1 && input.setNavigationPath(route)) {
      showNavigationVisuals(route)
      navigationWasActive = true
      callbacks.onIndoorPromptChange?.({ visible: false })
      return true
    }
    input.setNavigationPath(null)
    clearNavigationVisuals()
    navigationWasActive = false
    callbacks.onIndoorPromptChange?.({ visible: true, text: '该位置不可到达，请选择走廊或房间入口' })
    return false
  }

  function getAdjacentStairTargetLevel() {
    if (!indoorBuilding || !indoorGroup?.userData?.stairPath || !cameraRig?.player) return null
    const levels = indoorBuilding.floors.map(floor => floor.level).sort((a, b) => a - b)
    const index = levels.indexOf(currentIndoorFloor)
    if (index < 0) return null
    const path = indoorGroup.userData.stairPath
    const distanceToStart = Math.hypot(cameraRig.player.x - path.start.x, cameraRig.player.z - path.start.z)
    const distanceToEnd = Math.hypot(cameraRig.player.x - path.end.x, cameraRig.player.z - path.end.z)
    // 楼梯两端分别代表上行/下行入口；按角色实际走到的平台决定方向。
    if (distanceToStart <= distanceToEnd) return levels[index + 1] ?? null
    return levels[index - 1] ?? null
  }

  function navigateToIndoorFloor(targetLevel) {
    if (!indoorGroup || !indoorBuilding || stairTransition || activeIndoorRoom) return false
    const plan = planIndoorFloorRoute(indoorBuilding, currentIndoorFloor, Number(targetLevel))
    if (!plan) return false
    if (!plan.transitions.length) {
      pendingIndoorFloorTarget = null
      input?.setNavigationPath(null)
      clearNavigationVisuals()
      navigationWasActive = false
      return true
    }
    pendingIndoorFloorTarget = Number(targetLevel)
    const stairPath = indoorGroup.userData.stairPath
    const traversal = getStairTraversalPoints(stairPath, plan.transitions[0].direction)
    if (!traversal) {
      pendingIndoorFloorTarget = null
      return false
    }
    if (isAtStairLanding(cameraRig.player, traversal.entry)) {
      const started = beginStairTransition(plan.transitions[0].toLevel)
      if (!started) pendingIndoorFloorTarget = null
      return started
    }
    const started = navigateIndoorTo(traversal.entry)
    if (!started) pendingIndoorFloorTarget = null
    return started
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
        const interaction = indoorTarget.userData.interactionData
        if (interaction.action === 'enter-room' && interaction.roomId) {
          const doorway = (indoorGroup.userData.roomInteractions || []).find(item => item.roomId === interaction.roomId)
          if (doorway) navigateIndoorTo(doorway.approach)
          return
        }
        if (interaction.action === 'change-floor') {
          const stairs = indoorGroup.userData.stairPoint
          if (stairs) navigateIndoorTo(stairs)
          return
        }
        selectIndoorObject(indoorTarget)
        return
      }
      // 点击室内地面时沿导航网格寻路；墙体、家具和楼梯仍由碰撞世界兜底。
      const floorHit = indoorHits.find(hit => hit.object.name === 'indoor-floor-slab')
      if (floorHit) {
        navigateIndoorTo({ x: floorHit.point.x, z: floorHit.point.z })
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
    requestFrame()
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
    requestFrame()
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
      if (nearOutdoorBuildingId) enterIndoorBuilding(nearOutdoorBuildingId)
      else if (nearOutdoorEntrance) enterIndoorPrototype()
      return
    }
    if (stairTransition) return
    if (nearIndoorExit) {
      exitIndoorPrototype()
      return
    }
    if (activeIndoorRoom && roomReturnPosition) {
      if (pendingRoomTransition) return
      pendingRoomTransition = { type: 'exit' }
      if (!navigateIndoorTo(roomReturnPosition)) pendingRoomTransition = null
      return
    }
    if (nearIndoorRoom) {
      if (pendingRoomTransition) return
      const interaction = indoorGroup.userData.roomInteractions?.find(item => item.roomId === nearIndoorRoom.roomId)
      if (!interaction) return
      roomReturnPosition = { x: cameraRig.player.x, y: cameraRig.player.y, z: cameraRig.player.z }
      pendingRoomTransition = { type: 'enter', roomId: interaction.roomId, roomName: interaction.roomName }
      nearIndoorRoom = null
      if (!navigateIndoorTo(interaction.inside)) {
        pendingRoomTransition = null
        roomReturnPosition = null
      }
      return
    }
    if (stairInteractionActive && indoorBuilding) {
      const target = getAdjacentStairTargetLevel()
      if (target !== null) navigateToIndoorFloor(target)
    }
  }

  function logRenderDiagnostics(stage) {
    if (!renderDebugEnabled || !renderer || !cameraRig) return
    const canvas = renderer.domElement
    const rect = canvas.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const gl = renderer.getContext()
    const camera = cameraRig.camera
    console.info('[CampusRenderDiagnostics]', {
      stage,
      container: { width: containerRect.width, height: containerRect.height, top: containerRect.top, bottom: containerRect.bottom },
      canvas: { cssWidth: rect.width, cssHeight: rect.height, top: rect.top, bottom: rect.bottom, width: canvas.width, height: canvas.height },
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
      scissor: Array.from(gl.getParameter(gl.SCISSOR_BOX)),
      scissorTest: gl.isEnabled(gl.SCISSOR_TEST),
      pixelRatio: renderer.getPixelRatio(),
      camera: {
        type: camera.type,
        near: camera.near,
        far: camera.far,
        zoom: camera.zoom,
        aspect: camera.aspect,
        position: camera.position.toArray(),
        target: cameraRig.currentTarget?.toArray?.() || null,
      },
    })
  }

  function resize() {
    if (!renderer || !cameraRig) return
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    renderer.setSize(width, height)
    cameraRig.resize(width / height)
    logRenderDiagnostics('resize')
    requestFrame()
  }

  function requestFrame() {
    if (disposed || frameId) return
    frameId = requestAnimationFrame(animate)
  }

  function animate(time) {
    frameId = 0
    const delta = Math.min((time - (previousTime || time)) / 1000, 0.05)
    previousTime = time
    if (stairTransition) updateStairTransition(delta)
    else if (cameraRig?.mode !== 'overview') input?.update(delta)
    if (pendingRoomTransition) {
      const completed = input?.consumeNavigationPathCompletion?.() || false
      if (completed) {
        const transition = pendingRoomTransition
        pendingRoomTransition = null
        if (transition.type === 'enter') {
          activeIndoorRoom = { id: transition.roomId, name: transition.roomName }
          callbacks.onIndoorStateChange?.({ active: true, floor: currentIndoorFloor, floors: indoorBuilding.floors.map(item => item.level), buildingId: indoorBuilding.id, buildingName: indoorBuilding.name, prototype: true, nearStairs: false, nearRoom: null, activeRoom: activeIndoorRoom })
        } else {
          activeIndoorRoom = null
          roomReturnPosition = null
          nearIndoorRoom = null
          callbacks.onIndoorStateChange?.({ active: true, floor: currentIndoorFloor, floors: indoorBuilding.floors.map(item => item.level), buildingId: indoorBuilding.id, buildingName: indoorBuilding.name, prototype: true, nearStairs: stairInteractionActive, nearRoom: null, activeRoom: null })
        }
      } else if (!input?.navigationPath) {
        // 玩家手动接管或路线被碰撞阻断时，取消未完成的房间切换，不传送角色。
        pendingRoomTransition = null
        if (!activeIndoorRoom) roomReturnPosition = null
      }
    }
    if (navigationWasActive && !input?.navigationPath) {
      navigationWasActive = false
      clearNavigationVisuals()
    }
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
    if (!indoorGroup && cameraRig?.player && !isRpgSample) {
      const player = cameraRig.player
      const movedSinceLastCheck = !lastEntranceCheckPosition
        || (player.x - lastEntranceCheckPosition.x) ** 2 + (player.z - lastEntranceCheckPosition.z) ** 2 > 0.0004
      // 入口提示只依赖玩家位置；静止帧跳过距离计算，移动时只检查初始化索引。
      if (movedSinceLastCheck) {
        lastEntranceCheckPosition = { x: player.x, z: player.z }
        let nearest = null
        for (const entry of outdoorEntranceObjects) {
          const { object, worldPosition } = entry
          const entrance = object.userData?.indoorEntrance
          if (!entrance || !object.userData?.buildingId) continue
          const point = object.localToWorld(worldPosition.set(entrance.x, 0, entrance.z))
          const distance = Math.hypot(player.x - point.x, player.z - point.z)
          if (distance <= (entrance.radius || 2.25) && (!nearest || distance < nearest.distance)) {
            nearest = { id: String(object.userData.buildingId), name: object.userData.displayName || object.name, distance }
          }
        }
        const nextId = nearest?.id || null
        if (nextId !== nearOutdoorBuildingId) {
          nearOutdoorBuildingId = nextId
          callbacks.onIndoorPromptChange?.(nearest
            ? { visible: true, text: '按 E 进入' + nearest.name }
            : { visible: false })
        }
      }
    }

    if (indoorGroup && cameraRig?.player && !stairTransition && pendingIndoorFloorTarget !== null && !activeIndoorRoom) {
      if (input?.keys?.size) {
        // 玩家主动接管移动时，取消自动楼层导航，避免之后意外触发楼层切换。
        pendingIndoorFloorTarget = null
      } else {
        const plan = planIndoorFloorRoute(indoorBuilding, currentIndoorFloor, pendingIndoorFloorTarget)
        const nextTransition = plan?.transitions?.[0]
        const traversal = getStairTraversalPoints(indoorGroup.userData.stairPath, nextTransition?.direction)
        if (!nextTransition || !traversal) {
          pendingIndoorFloorTarget = null
        } else if (isAtStairLanding(cameraRig.player, traversal.entry)) {
          input?.setNavigationPath(null)
          navigationWasActive = false
          clearNavigationVisuals()
          if (!beginStairTransition(nextTransition.toLevel)) pendingIndoorFloorTarget = null
        } else if (!input?.navigationPath) {
          // 自动寻路被碰撞中断或外部清空时，不能让楼层目标残留并在稍后误触发。
          pendingIndoorFloorTarget = null
          navigationWasActive = false
          clearNavigationVisuals()
        }
      }
    }
    if (indoorGroup && cameraRig?.player && !stairTransition) {
      const point = indoorGroup.userData.stairPoint
      const exitPoint = indoorGroup.userData.exitInteractions?.[0]
      const nearExit = !activeIndoorRoom && exitPoint && Math.hypot(cameraRig.player.x - exitPoint.x, cameraRig.player.z - exitPoint.z) <= 1.7
      nearIndoorExit = Boolean(nearExit)
      const nearStairs = !activeIndoorRoom && point && Math.hypot(cameraRig.player.x - point.x, cameraRig.player.z - point.z) <= 2.4
      const nearestRoom = activeIndoorRoom ? null : (indoorGroup.userData.roomInteractions || [])
        .map(item => ({ item, distance: Math.hypot(cameraRig.player.x - item.approach.x, cameraRig.player.z - item.approach.z) }))
        .filter(entry => entry.distance <= 1.7)
        .sort((a, b) => a.distance - b.distance)[0]?.item || null
      const nextRoom = nearestRoom ? { roomId: nearestRoom.roomId, roomName: nearestRoom.roomName } : null
      const roomChanged = nextRoom?.roomId !== nearIndoorRoom?.roomId
      const stairChanged = Boolean(nearStairs) !== stairInteractionActive
      if (stairChanged || roomChanged) {
        stairInteractionActive = Boolean(nearStairs)
        nearIndoorRoom = nextRoom
        callbacks.onIndoorStateChange?.({ active: true, floor: currentIndoorFloor, floors: indoorBuilding.floors.map(item => item.level), buildingId: indoorBuilding.id, buildingName: indoorBuilding.name, prototype: true, nearStairs: stairInteractionActive, nearRoom: nearIndoorRoom, activeRoom: activeIndoorRoom })
      }
      const stairTarget = nearStairs ? getAdjacentStairTargetLevel() : null
      const prompt = getIndoorInteractionPrompt({
        activeRoom: activeIndoorRoom,
        nearExit: Boolean(nearExit),
        nearStairs: Boolean(nearStairs && stairTarget !== null),
        stairTarget: stairTarget === null ? null : (stairTarget > currentIndoorFloor ? stairTarget : -stairTarget),
        nearRoom: nearestRoom,
        buildingName: indoorBuilding?.name || '建筑',
      })
      const nextPromptKey = prompt?.key || ''
      if (nextPromptKey !== indoorPromptKey) {
        indoorPromptKey = nextPromptKey
        callbacks.onIndoorPromptChange?.(prompt ? { visible: true, text: prompt.text } : { visible: false })
      }
    }
    const playerSprite = playerSpriteObject || scene?.getObjectByName('CampusPlanPlayerSprite')
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
    const cameraChanged = cameraRig?.update(delta) || false
    // 远景地面跟随相机的 X/Z 坐标，避免相机平移或低角度观察时看到有限平面的边缘。
    if (activeHorizonGround && cameraRig?.camera) {
      activeHorizonGround.position.x = cameraRig.camera.position.x
      activeHorizonGround.position.z = cameraRig.camera.position.z
    }
    renderer.render(scene, cameraRig.camera)
    if (renderDebugEnabled && ++renderDebugFrame % 120 === 0) logRenderDiagnostics('render')
    // 角色模式持续更新输入/动画；静止总览只在 OrbitControls 阻尼或交互引发变化时继续绘制。
    if (cameraRig?.mode !== 'overview' || cameraChanged) requestFrame()
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
    requestFrame()
    return true
  }

  function buildIndoorFloor(level, transitionPosition = null) {
    input?.setNavigationPath(null)
    navigationWasActive = false
    clearNavigationVisuals()
    const floor = indoorBuilding?.floors.find(item => item.level === level)
    if (!floor) return false
    const interiorPolygon = indoorBuilding.interiorFootprint?.polygon || (
      !indoorBuilding.interiorNormalized ? indoorBuilding.footprint?.polygon : null
    )
    const floorDefinition = interiorPolygon?.length >= 3
      ? { ...floor, footprintPolygon: interiorPolygon.map(point => ({ x: point.x, z: point.z })) }
      : floor
    const group = createIndoorFloor(THREE, floorDefinition, indoorBuilding.floorHeight)
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
    pendingRoomTransition = null
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
    outdoorState = {
      visible: campus.visible,
      player: cameraRig.player.clone(),
      mode: cameraRig.mode,
      collisionWorld,
      background: scene.background?.clone?.() ?? scene.background,
      fog: scene.fog?.clone?.() ?? scene.fog,
      loadedModelVisibility: loadedBuildingModels.map(model => ({ model, visible: model.visible })),
    }
    // 室内是独立空间：校园地面、树木及独立加载的建筑模型全部隐藏，不能从室内看到室外。
    campus.visible = false
    loadedBuildingModels.forEach(model => { model.visible = false })
    scene.background = new THREE.Color('#d9d4c5')
    scene.fog = new THREE.Fog('#d9d4c5', 38, 95)
    // 进入时直接落在一楼走廊内，以第一人称观察教室和家具，不再从建筑外部看剖面。
    cameraRig.setMode('firstPerson')
    input.setMode('firstPerson')
    buildIndoorFloor(definition.floors[0].level)
    // 楼层生成器已将建筑外门映射为室内门洞；直接使用同一门洞计算出的出生点。
    const firstFloor = definition.floors.find(floor => floor.level === currentIndoorFloor)
    const entranceLanding = firstFloor?.spawnPoint
    if (entranceLanding) {
      cameraRig.player.set(
        entranceLanding.x,
        indoorGroup.position.y + (entranceLanding.y ?? 1.7),
        entranceLanding.z,
      )
      if (cameraRig.mode === 'firstPerson') cameraRig.updateFirstPersonDesired()
      else cameraRig.updateThirdPersonDesired()
    }
    cameraRig.thirdDistance = 8
    cameraRig.updateThirdPersonDesired()
    return true
  }

  function syncOutdoorBuildingFootprint(definition) {
    if (!indoorOutdoorTarget || !indoorOutdoorBase || !definition?.footprintSize) return false
    const width = Number(definition.footprintSize.width)
    const depth = Number(definition.footprintSize.depth)
    if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) return false
    const target = indoorOutdoorTarget
    const rootScale = target.scale
    if (Math.abs(rootScale.x) < 1e-6 || Math.abs(rootScale.y) < 1e-6 || Math.abs(rootScale.z) < 1e-6) return false
    const localWidth = width / Math.abs(rootScale.x)
    const localDepth = depth / Math.abs(rootScale.z)
    const expansion = definition.footprint?.expansion || {}
    const shiftX = (Number(expansion.east) - Number(expansion.west)) / 2
    const shiftZ = (Number(expansion.south) - Number(expansion.north)) / 2
    const scaledPolygon = definition.footprint?.polygon
    const polygon = Array.isArray(scaledPolygon)
      ? scaledPolygon.map(point => ({ x: point.x / rootScale.x, z: point.z / rootScale.z }))
      : scaledPolygon
    const rebuildOptions = target.userData?.rebuildOptions

    // 对程序化校园建筑按真实多边形重新生成建筑实体，不再用 scale 把矩形模型硬拉伸。
    if (rebuildOptions && Array.isArray(polygon) && polygon.length >= 3) {
      const localFloorHeight = Number(definition.floorHeight) / Math.abs(rootScale.y)
      const geometryKey = JSON.stringify({
        polygon, width: localWidth, depth: localDepth,
        height: localFloorHeight * definition.floors.length,
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
        width: localWidth,
        depth: localDepth,
        height: localFloorHeight * definition.floors.length,
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
        const foundationIsLocal = foundation.parent === target
        const foundationDepth = foundationIsLocal ? 0.55 : 0.16
        const foundationGeometry = new THREE.ExtrudeGeometry(shape, { depth: foundationDepth, bevelEnabled: false, curveSegments: 1 })
        foundationGeometry.rotateX(-Math.PI / 2)
        foundation.geometry = foundationGeometry
        foundation.userData.generatedFoundationIsLocal = foundationIsLocal
      }
      indoorOutdoorBase.geometryKey = geometryKey
      }
      target.scale.copy(indoorOutdoorBase.scale)
      const worldShift = new THREE.Vector3(shiftX, 0, shiftZ).applyQuaternion(target.quaternion)
      target.position.copy(indoorOutdoorBase.position).add(worldShift)
      if (target.userData.foundationMesh) {
        const foundation = target.userData.foundationMesh
        if (foundation.parent === target) {
          // RPG 样板的基座是建筑组子对象，保持局部坐标。
          foundation.position.set(0, 0.18, 0)
        } else {
          // 常规校园建筑的基座挂在 campus 根节点下，使用建筑世界平面坐标。
          foundation.position.set(target.position.x, 0, target.position.z)
        }
      }
    } else {
      // 非程序化模型（含 RPG 样板手工建筑）暂保留原有包围盒缩放路径。
      indoorOutdoorTarget.scale.x = indoorOutdoorBase.scale.x * localWidth / indoorOutdoorBase.width
      indoorOutdoorTarget.scale.z = indoorOutdoorBase.scale.z * localDepth / indoorOutdoorBase.depth
      const worldShift = new THREE.Vector3(shiftX, 0, shiftZ).applyQuaternion(indoorOutdoorTarget.quaternion)
      indoorOutdoorTarget.position.copy(indoorOutdoorBase.position).add(worldShift)
    }
    indoorOutdoorTarget.updateMatrixWorld(true)

    // 室外碰撞体与重建后的建筑轮廓同步；样板楼保留入口缺口，不能用整栋多边形封死门洞。
    if (Number.isInteger(indoorOutdoorBase.collisionStart) && indoorOutdoorBase.collisionCount > 0 && outdoorCollisionWorld && rebuildOptions && Array.isArray(polygon) && polygon.length >= 3) {
      const worldPolygon = polygon.map(point => {
        const worldPoint = indoorOutdoorTarget.localToWorld(new THREE.Vector3(point.x, 0, point.z))
        return { x: worldPoint.x, z: worldPoint.z }
      })
      const wallThickness = 0.28
      const entranceEdgeIndex = Number(rebuildOptions?.entranceEdgeIndex ?? 0)
      const entranceGapHalf = Math.max(0.85, (Number(rebuildOptions?.doorWidth || indoorOutdoorTarget.userData?.entrance?.width || 1.35) + 0.18) / 2)
      const wallObstacles = []
      const appendWallSegment = (start, end) => {
        const dx = end.x - start.x, dz = end.z - start.z
        const length = Math.hypot(dx, dz)
        if (length < 0.15) return
        const nx = -dz / length * wallThickness / 2
        const nz = dx / length * wallThickness / 2
        const corners = [
          [start.x + nx, start.z + nz], [end.x + nx, end.z + nz],
          [end.x - nx, end.z - nz], [start.x - nx, start.z - nz],
        ]
        const xs = corners.map(point => point[0]), zs = corners.map(point => point[1])
        wallObstacles.push({
          polygon: corners.map(([x, z]) => ({ x, z })),
          holes: [],
          minX: Math.min(...xs), maxX: Math.max(...xs),
          minZ: Math.min(...zs), maxZ: Math.max(...zs),
        })
      }
      worldPolygon.forEach((start, index) => {
        const end = worldPolygon[(index + 1) % worldPolygon.length]
        if (index === entranceEdgeIndex) {
          const dx = end.x - start.x, dz = end.z - start.z
          const length = Math.hypot(dx, dz)
          const halfGap = Math.min(entranceGapHalf, length * 0.35)
          const middle = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 }
          const before = { x: middle.x - dx / length * halfGap, z: middle.z - dz / length * halfGap }
          const after = { x: middle.x + dx / length * halfGap, z: middle.z + dz / length * halfGap }
          appendWallSegment(start, before)
          appendWallSegment(after, end)
        } else appendWallSegment(start, end)
      })
      const previousCollisionCount = indoorOutdoorBase.collisionCount
      outdoorCollisionWorld.obstacles.splice(
        indoorOutdoorBase.collisionStart,
        previousCollisionCount,
        ...wallObstacles,
      )
      const collisionCountDelta = wallObstacles.length - previousCollisionCount
      if (collisionCountDelta) {
        campus?.traverse(object => {
          if (!Number.isInteger(object.userData?.collisionObstacleStart) ||
              object === indoorOutdoorTarget ||
              object.userData.collisionObstacleStart <= indoorOutdoorBase.collisionStart) return
          object.userData.collisionObstacleStart += collisionCountDelta
          const baseline = outdoorBuildingBaselines.get(object)
          if (baseline && Number.isInteger(baseline.collisionStart)) baseline.collisionStart += collisionCountDelta
        })
      }
      indoorOutdoorTarget.userData.collisionObstacleCount = wallObstacles.length
      indoorOutdoorBase.collisionCount = wallObstacles.length
      const baseline = outdoorBuildingBaselines.get(indoorOutdoorTarget)
      if (baseline) baseline.collisionCount = wallObstacles.length
      // 入口交互点跟随配置的入口边移动，避免扩建或拖动轮廓后仍提示旧门洞位置。
      const entranceIndex = Math.max(0, Math.min(worldPolygon.length - 1, Number(rebuildOptions?.entranceEdgeIndex || 0)))
      const entranceStart = worldPolygon[entranceIndex]
      const entranceEnd = worldPolygon[(entranceIndex + 1) % worldPolygon.length]
      const center = worldPolygon.reduce((sum, point) => ({ x: sum.x + point.x / worldPolygon.length, z: sum.z + point.z / worldPolygon.length }), { x: 0, z: 0 })
      const middle = { x: (entranceStart.x + entranceEnd.x) / 2, z: (entranceStart.z + entranceEnd.z) / 2 }
      const outwardLength = Math.hypot(middle.x - center.x, middle.z - center.z) || 1
      // 入口交互点存为建筑局部坐标；旋转、缩放后仍可正确反算到世界位置。
      const worldEntrance = new THREE.Vector3(
        middle.x + (middle.x - center.x) / outwardLength * 1.15,
        indoorOutdoorTarget.position.y,
        middle.z + (middle.z - center.z) / outwardLength * 1.15,
      )
      const localEntrance = indoorOutdoorTarget.worldToLocal(worldEntrance)
      indoorOutdoorTarget.userData.indoorEntrance = {
        x: localEntrance.x,
        z: localEntrance.z,
        radius: 2.15,
      }
    } else if (indoorOutdoorBase.collisionIndex >= 0 && outdoorCollisionWorld?.obstacles[indoorOutdoorBase.collisionIndex]) {
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
        collisionStart: target.userData?.collisionObstacleStart,
        collisionCount: target.userData?.collisionObstacleCount,
      }
      outdoorBuildingBaselines.set(target, baseline)
    }
    target.position.copy(baseline.position)
    target.scale.copy(baseline.scale)
    target.updateMatrixWorld(true)
    // 室内尺寸使用建筑自身局部坐标计算，避免旋转建筑的世界 AABB 被放大。
    const localBounds = getObjectLocalBounds(THREE, target)
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
      collisionStart: baseline.collisionStart,
      collisionCount: baseline.collisionCount,
      position: baseline.position.clone(),
      scale: baseline.scale.clone(),
    }
    const localEntrancePoint = options.entrancePoint || target.userData?.indoorEntrance || null
    const transformedFootprint = transformIndoorFootprint({
      minX: localBounds.min.x, maxX: localBounds.max.x,
      minZ: localBounds.min.z, maxZ: localBounds.max.z,
    }, target.scale, localEntrancePoint)
    const rebuildOptions = target.userData?.rebuildOptions
    const entranceEdgeIndex = Number(rebuildOptions?.entranceEdgeIndex ?? 0)
    const entranceEdgeStart = localBounds.isEmpty() ? null : (() => {
      const points = [
        { x: localBounds.min.x, z: localBounds.min.z },
        { x: localBounds.max.x, z: localBounds.min.z },
        { x: localBounds.max.x, z: localBounds.max.z },
        { x: localBounds.min.x, z: localBounds.max.z },
      ]
      const start = points[entranceEdgeIndex % points.length]
      const end = points[(entranceEdgeIndex + 1) % points.length]
      const edgeLength = Math.hypot(end.x - start.x, end.z - start.z) || 1
      return Math.hypot((end.x - start.x) * target.scale.x, (end.z - start.z) * target.scale.z) / edgeLength
    })()
    const footprint = {
      id: String(buildingId),
      name: options.name || target.userData?.name || target.name || '校园建筑',
      bounds: transformedFootprint.bounds,
    }
    // 室内尺寸按建筑根节点缩放同步；室内生成坐标仍以建筑局部中心为原点。
    const generationOptions = {
      ...options,
      floors: options.floors ?? options.floorsData?.length ?? target.userData?.floorCount ?? 1,
      floorHeight: options.floorHeight ?? (target.userData?.floorHeight ?? 3.6) * Math.abs(target.scale.y),
      doorWidth: options.doorWidth ?? ((rebuildOptions?.doorWidth || 1.28) * (entranceEdgeStart || Math.abs(target.scale.x))),
      entrancePoint: transformedFootprint.entrancePoint,
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
    const previousFloor = indoorBuilding.floors.find(item => item.level === currentIndoorFloor)
    const previousFloorBaseY = previousFloor ? (currentIndoorFloor - 1) * indoorBuilding.floorHeight : 0
    const playerHeightOffset = currentPosition.y - previousFloorBaseY
    indoorBuilding = definition
    const levels = definition.floors.map(item => item.level)
    const keepsCurrentFloor = levels.includes(currentIndoorFloor)
    const nextLevel = keepsCurrentFloor ? currentIndoorFloor : levels[0]
    const nextFloor = definition.floors.find(item => item.level === nextLevel)
    const transitionPosition = keepsCurrentFloor
      ? { x: currentPosition.x, z: currentPosition.z }
      : { x: nextFloor.spawnPoint.x, z: nextFloor.spawnPoint.z }
    buildIndoorFloor(nextLevel, transitionPosition)
    // 楼层编辑可能改变层高或删除当前楼层；保留玩家相对楼板的高度，而不是沿用旧世界 Y 坐标。
    const nextFloorBaseY = (nextLevel - 1) * definition.floorHeight
    const nextHeightOffset = keepsCurrentFloor
      ? Math.max(0.5, Math.min(definition.floorHeight - 0.25, playerHeightOffset))
      : nextFloor.spawnPoint.y
    cameraRig.player.y = nextFloorBaseY + nextHeightOffset
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
    const traversal = getStairTraversalPoints(indoorGroup.userData.stairPath, direction)
    if (!traversal) return false
    if (!isAtStairLanding(cameraRig.player, traversal.entry)) return false
    const fromY = cameraRig.player.y
    const horizontalDistance = Math.hypot(traversal.exit.x - traversal.entry.x, traversal.exit.z - traversal.entry.z)
    const travelDistance = Math.hypot(horizontalDistance, indoorBuilding.floorHeight)
    stairTransition = {
      targetLevel,
      fromX: traversal.entry.x,
      toX: traversal.exit.x,
      fromZ: traversal.entry.z,
      toZ: traversal.exit.z,
      fromY,
      direction,
      elapsed: 0, duration: Math.max(0.8, travelDistance / 5.5),
    }
    input.setMovementEnabled(false)
    return true
  }

  function updateStairTransition(delta) {
    if (!stairTransition) return
    const transition = stairTransition
    transition.elapsed = Math.min(transition.duration, transition.elapsed + delta)
    const progress = transition.elapsed / transition.duration
    // 楼梯几何为等高阶梯，按恒定进度沿楼梯轴线移动，避免缓入缓出造成悬浮感。
    cameraRig.player.x = transition.fromX + (transition.toX - transition.fromX) * progress
    const steppedRise = getStairStepHeight(progress, indoorBuilding.floorHeight)
    cameraRig.player.y = transition.fromY + transition.direction * steppedRise
    cameraRig.player.z = transition.fromZ + (transition.toZ - transition.fromZ) * progress
    if (cameraRig.mode === 'firstPerson') cameraRig.updateFirstPersonDesired()
    else cameraRig.updateThirdPersonDesired()
    if (progress >= 1) {
      stairTransition = null
      buildIndoorFloor(transition.targetLevel, { x: transition.toX, z: transition.toZ })
      input.setMovementEnabled(true)
      if (pendingIndoorFloorTarget === currentIndoorFloor) pendingIndoorFloorTarget = null
      else if (pendingIndoorFloorTarget !== null && indoorGroup?.userData.stairPoint) {
        const nextPlan = planIndoorFloorRoute(indoorBuilding, currentIndoorFloor, pendingIndoorFloorTarget)
        const nextTraversal = getStairTraversalPoints(indoorGroup.userData.stairPath, nextPlan?.transitions?.[0]?.direction)
        if (nextTraversal) navigateIndoorTo(nextTraversal.entry)
        else pendingIndoorFloorTarget = null
      }
    }
  }

  function exitIndoorPrototype() {
    input?.setNavigationPath(null)
    navigationWasActive = false
    clearNavigationVisuals()
    if (!indoorGroup || !outdoorState) return false
    scene.remove(indoorGroup)
    disposeObjectGroup(indoorGroup)
    indoorGroup = null
    stairInteractionActive = false
    nearIndoorRoom = null
    nearIndoorExit = false
    indoorPromptKey = ''
    callbacks.onIndoorPromptChange?.({ visible: false })
    activeIndoorRoom = null
    roomReturnPosition = null
    pendingRoomTransition = null
    stairTransition = null
    pendingIndoorFloorTarget = null
    input.setMovementEnabled(true)
    indoorBuilding = null
    indoorOutdoorTarget = null
    indoorOutdoorBase = null
    currentIndoorFloor = null
    campus.visible = outdoorState.visible
    for (const item of outdoorState.loadedModelVisibility || []) item.model.visible = item.visible
    scene.background = outdoorState.background
    scene.fog = outdoorState.fog
    nearOutdoorEntrance = false
    nearOutdoorBuildingId = null
    lastEntranceCheckPosition = null
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
    requestFrame()
    if (mode !== 'overview' && !editorPreviewActive) void ensureCampusBuildingModelsLoaded()
    loadedBuildingModels.forEach((model) => { model.visible = shouldShowBuildingModels() })
  }

  function setViewMode(mode) {
    cameraRig?.setViewMode(mode)
    requestFrame()
    if (mode === '3d' && !editorPreviewActive) void ensureCampusBuildingModelsLoaded()
    loadedBuildingModels.forEach((model) => { model.visible = shouldShowBuildingModels() })
  }

  function focusCampus() {
    cameraRig?.focusCampus()
    const spawn = isRpgSample ? campus?.userData.playerSpawn : mapPixelToWorld(...CAMPUS_PLAYER_SPAWN_PIXEL)
    input?.resetPosition(spawn || { x: 0, z: 14 })
    requestFrame()
  }

  function dispose() {
    disposed = true
    cancelAnimationFrame(frameId)
    resizeObserver?.disconnect()
    window.removeEventListener('keydown', onKeyDown)
    renderer?.domElement?.removeEventListener('pointerdown', onScenePointerDown)
    renderer?.domElement?.removeEventListener('pointerup', onScenePointerUp)
    renderer?.domElement?.removeEventListener('pointerup', requestFrame)
    renderer?.domElement?.removeEventListener('pointerdown', requestFrame)
    renderer?.domElement?.removeEventListener('pointermove', requestFrame)
    renderer?.domElement?.removeEventListener('wheel', requestFrame)
    clearSelection()
    clearNavigationVisuals()
    clearRpgPreview()
    activeHorizonGround = null
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

  return { init, setMode, setViewMode, setVirtualKey, focusCampus, enterIndoorPrototype, enterIndoorBuilding, getIndoorBuildingDefinition, updateIndoorBuildingDefinition, switchIndoorFloor, navigateToIndoorFloor, exitIndoorPrototype, selectObject, clearSelection, updateSceneObject, previewRpgMap, previewCampusPlan, clearRpgPreview, dispose, get initialized() { return initialized } }
}
