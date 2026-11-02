import * as THREE from 'three'
import { createCampusScene } from '../world/campus/createCampusScene.js'
import { CameraRig } from '../camera/CameraRig.js'
import { InputController } from '../controls/InputController.js'
import { loadCampusBuildingModels } from '../world/buildings/loadCampusBuildingModels.js'

export function createCampusEngine(container, callbacks = {}) {
  let renderer
  let scene
  let cameraRig
  let input
  let frameId = 0
  let resizeObserver
  let previousTime = 0
  let initialized = false

  async function init() {
    if (!container) throw new Error('未找到三维场景容器')

    scene = new THREE.Scene()
    scene.background = new THREE.Color('#aebfbd')
    scene.fog = new THREE.Fog('#aebfbd', 90, 260)

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false })
    // 固定 1x 渲染倍率，避免高 DPI 屏幕二次缩放破坏像素边缘。\n    renderer.setPixelRatio(1)
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.BasicShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // 保留像素美术标准色板，避免电影色调映射改变颜色。\n    renderer.toneMapping = THREE.NoToneMapping
    container.appendChild(renderer.domElement)

    const campus = createCampusScene(THREE)
    scene.add(campus)
    loadCampusBuildingModels(scene)
      .then((result) => callbacks.onAssetsLoaded?.(result))
      .catch((error) => callbacks.onAssetError?.(error))
    cameraRig = new CameraRig(THREE, renderer.domElement)
    input = new InputController(THREE, renderer.domElement, cameraRig, campus.userData.walkableBounds)
    input.attach()

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
    window.addEventListener('keydown', onKeyDown)
    initialized = true
    callbacks.onReady?.()
    animate(0)
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
    if (playerSprite && cameraRig?.player) playerSprite.position.set(cameraRig.player.x, 2.1, cameraRig.player.z)
    cameraRig?.update(delta)
    renderer.render(scene, cameraRig.camera)
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
    input?.dispose()\n    cameraRig?.dispose()
    scene?.traverse((object) => {
      object.geometry?.dispose?.()
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose())
      else object.material?.dispose?.()
    })
    renderer?.dispose()
    renderer?.domElement?.remove()
    initialized = false
  }

  return { init, setMode, focusCampus, dispose, get initialized() { return initialized } }
}
