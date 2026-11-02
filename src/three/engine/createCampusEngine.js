import * as THREE from 'three'
import { createCampusScene } from '../world/campus/createCampusScene.js'
import { CameraRig } from '../camera/CameraRig.js'
import { InputController } from '../controls/InputController.js'
import { loadCampusBuildingModels } from '../world/buildings/loadCampusBuildingModels.js'
import { buildFeatureObject } from '../world/buildFeatureObject.js'
import { mapPixelToWorld, mapRectToWorld } from '../../data/campus/campusLayout.js'
import { roadToPolygon } from '../../editor/campusEditorDocument.js'

export function createCampusEngine(container, callbacks = {}) {
  let renderer
  let scene
  let campus
  let lastPlayerX = 0
  let lastPlayerZ = 24
  let cameraRig
  let input
  let frameId = 0
  let resizeObserver
  let previousTime = 0
  let initialized = false
  let selectedFeatureObject = null
  let loadedSceneData = null
  let rpgPreviewGroup = null
  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  let pointerStart = null

  async function init() {
    if (!container) throw new Error('未找到三维场景容器')

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#aebfbd')
    scene.fog = new THREE.Fog('#aebfbd', 90, 260)

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

    if (typeof callbacks.loadSceneData === 'function') {
      try {
        const sceneData = await callbacks.loadSceneData()
        loadedSceneData = sceneData
        if (sceneData?.objects?.length) {
          campus = new THREE.Group()
          campus.name = 'GISDrivenCampusScene'
          campus.userData.isGISDriven = true
          campus.userData.coordinateSystem = 'campus-local'
          campus.userData.walkableBounds = {
            minX: -75, maxX: 75, minZ: -52.5, maxZ: 52.5,
          }
          for (const item of sceneData.objects) {
            campus.add(buildFeatureObject(item.feature, item.sceneObject, {
              mapCoordinateToWorld: sceneData.mapCoordinateToWorld,
            }))
          }
          callbacks.onSceneDataLoaded?.(sceneData)
        }
      } catch (error) {
        callbacks.onSceneDataError?.(error)
      }
    }
    // API 暂无可渲染要素或加载失败时，保留示意场景作为回退。
    if (!campus) campus = createCampusScene(THREE)
    scene.add(campus)
    if (!campus.userData.isGISDriven) {
      loadCampusBuildingModels(scene)
        .then((result) => callbacks.onAssetsLoaded?.(result))
        .catch((error) => callbacks.onAssetError?.(error))
    }
    cameraRig = new CameraRig(THREE, renderer.domElement)
    input = new InputController(THREE, renderer.domElement, cameraRig, campus.userData.walkableBounds)
    input.attach()
    renderer.domElement.addEventListener('pointerdown', onScenePointerDown)
    renderer.domElement.addEventListener('pointerup', onScenePointerUp)

    const hemi = new THREE.HemisphereLight(0xe8f0e8, 0x64735e, 2.0)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffedcf, 3.0)
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


  function disposeObjectGroup(group) {
    group?.traverse((object) => {
      object.geometry?.dispose?.()
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
      else object.material?.dispose?.()
    })
  }

  function clearRpgPreview() {
    if (!rpgPreviewGroup) return
    scene?.remove(rpgPreviewGroup)
    disposeObjectGroup(rpgPreviewGroup)
    rpgPreviewGroup = null
    if (campus) campus.visible = true
  }

  function previewRpgMap(document) {
    if (!scene || !document?.grid || !Array.isArray(document.layers)) return false
    clearRpgPreview()
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
    scene.add(rpgPreviewGroup); if (campus) campus.visible=false
    cameraRig?.focusBounds(width*unit,height*unit)
    return true
  }

  function previewCampusPlan(document) {
    if (!scene || !document || !Array.isArray(document.buildings) || !Array.isArray(document.roads)) return false
    clearRpgPreview()
    rpgPreviewGroup = new THREE.Group()
    rpgPreviewGroup.name = 'CampusPlanLivePreview'
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 96),
      new THREE.MeshStandardMaterial({ color: '#91a77b', roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.12
    ground.receiveShadow = true
    rpgPreviewGroup.add(ground)

    for (const area of document.areas || []) {
      if (area.polygon?.length >= 3) {
        const points = area.polygon.map(([x, y]) => {
          const p = mapPixelToWorld(x, y)
          return new THREE.Vector2(p.x, -p.z)
        })
        const shape = new THREE.Shape(points)
        const mesh = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshStandardMaterial({ color: area.type === 'water' ? '#6bb8b4' : '#9eaa83', roughness: 1 }),
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = 0.015
        mesh.receiveShadow = true
        rpgPreviewGroup.add(mesh)
      } else if (area.rect) {
        const bounds = mapRectToWorld(area.rect)
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(bounds.width, 0.08, bounds.depth),
          new THREE.MeshStandardMaterial({ color: area.type === 'sports' ? '#b9b69f' : '#829a70', roughness: 1 }),
        )
        mesh.position.set(bounds.x, 0.02, bounds.z)
        rpgPreviewGroup.add(mesh)
      }
    }

    for (const road of document.roads) {
      if (!Array.isArray(road.points) || road.points.length < 2) continue
      const width = Math.max(0.7, Number(road.width || 13) * 150 / 576)
      const footprint = roadToPolygon(road.points, Number(road.width || 13))
      if (footprint.length < 4) continue
      const shapePoints = footprint.map(([x, y]) => {
        const p = mapPixelToWorld(x, y)
        return new THREE.Vector2(p.x, -p.z)
      })
      const shape = new THREE.Shape(shapePoints)
      const geometry = new THREE.ShapeGeometry(shape)
      geometry.rotateX(-Math.PI / 2)
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: '#777b73', roughness: 1, side: THREE.DoubleSide }),
      )
      mesh.position.y = 0.075
      mesh.name = road.id
      mesh.receiveShadow = true
      mesh.userData.roadWidthWorld = width
      rpgPreviewGroup.add(mesh)
    }

    for (const building of document.buildings) {
      const footprint = Array.isArray(building.footprint) && building.footprint.length >= 3
        ? building.footprint
        : Array.isArray(building.rect) && building.rect.length === 4
          ? [[building.rect[0], building.rect[1]], [building.rect[2], building.rect[1]], [building.rect[2], building.rect[3]], [building.rect[0], building.rect[3]]]
          : null
      if (!footprint) continue
      const points = footprint.map(([x, y]) => {
        const point = mapPixelToWorld(x, y)
        return new THREE.Vector2(point.x, -point.z)
      })
      const shape = new THREE.Shape(points)
      const height = Math.max(1.8, Number(building.height || building.floors * 0.45 || 3.2))
      const bodyGeometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 })
      bodyGeometry.rotateX(-Math.PI / 2)
      const body = new THREE.Mesh(
        bodyGeometry,
        new THREE.MeshStandardMaterial({ color: building.color || '#c8a66e', roughness: 0.9 }),
      )
      body.castShadow = true
      body.receiveShadow = true
      body.name = building.label || building.id
      body.userData.campusBuildingId = building.id
      const roofGeometry = new THREE.ShapeGeometry(shape)
      roofGeometry.rotateX(-Math.PI / 2)
      const roof = new THREE.Mesh(roofGeometry, new THREE.MeshStandardMaterial({ color: '#8e7657', roughness: 0.95, side: THREE.DoubleSide }))
      roof.position.y = height
      roof.castShadow = true
      const group = new THREE.Group()
      group.add(body, roof)
      group.name = building.label || building.id
      group.userData.campusBuildingId = building.id
      rpgPreviewGroup.add(group)
    }

    scene.add(rpgPreviewGroup)
    if (campus) campus.visible = false
    cameraRig?.setMode('overview')
    cameraRig?.focusBounds(150, 96)
    return true
  }

  function onScenePointerDown(event) {
    if (event.button !== 0 || cameraRig?.mode !== 'overview') { pointerStart = null; return }
    pointerStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }

  function onScenePointerUp(event) {
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
    pointerStart = null
    if (moved > 5 || cameraRig?.mode !== 'overview') return
    const rect = renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointerNdc, cameraRig.camera)
    const hits = raycaster.intersectObjects(campus.children, true)
    let target = hits[0]?.object || null
    while (target && target !== campus && !target.userData?.featureId) target = target.parent
    if (!target || target === campus || !target.userData?.featureId) return clearSelection()
    selectObject(target.userData.featureId)
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
    if (!selectedFeatureObject) return
    restoreSelectionHighlight()
    callbacks.onObjectSelected?.(null)
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') input?.exitPointerLock()
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
    input?.update(delta)
    const playerSprite = scene?.getObjectByName('PixelExplorerSprite')
    if (playerSprite && cameraRig?.player) {
      // 第一人称相机位于角色眼部，隐藏自身 Sprite，避免角色贴图遮挡视野。
      playerSprite.visible = cameraRig.mode !== 'firstPerson'
      playerSprite.position.set(cameraRig.player.x, 2.1, cameraRig.player.z)
      const dx = cameraRig.player.x - lastPlayerX
      const dz = cameraRig.player.z - lastPlayerZ
      const moving = dx * dx + dz * dz > 0.000001
      campus?.userData.updatePlayerAnimation?.(moving, time / 1000)
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
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
      else object.material?.dispose?.()
    })
    item.sceneObject = sceneObject
    if (wasSelected) selectObject(item.feature.id)
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
    input?.resetPosition()
  }

  function dispose() {
    cancelAnimationFrame(frameId)
    resizeObserver?.disconnect()
    window.removeEventListener('keydown', onKeyDown)
    renderer?.domElement?.removeEventListener('pointerdown', onScenePointerDown)
    renderer?.domElement?.removeEventListener('pointerup', onScenePointerUp)
    clearSelection()
    clearRpgPreview()
    input?.dispose()
    cameraRig?.dispose()
    scene?.traverse((object) => {
      object.geometry?.dispose?.()
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose())
      else object.material?.dispose?.()
    })
    renderer?.dispose()
    renderer?.domElement?.remove()
    initialized = false
  }

  return { init, setMode, setVirtualKey, focusCampus, selectObject, clearSelection, updateSceneObject, previewRpgMap, previewCampusPlan, clearRpgPreview, dispose, get initialized() { return initialized } }
}
