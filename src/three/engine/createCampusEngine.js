import * as THREE from 'three'
import { createCampusScene } from '../world/campus/createCampusScene.js'
import { CameraRig } from '../camera/CameraRig.js'
import { InputController } from '../controls/InputController.js'
import { loadCampusBuildingModels } from '../world/buildings/loadCampusBuildingModels.js'
import { buildFeatureObject } from '../world/buildFeatureObject.js'

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

  return { init, setMode, setVirtualKey, focusCampus, selectObject, clearSelection, updateSceneObject, dispose, get initialized() { return initialized } }
}
