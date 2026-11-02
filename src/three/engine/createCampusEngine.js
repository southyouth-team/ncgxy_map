import * as THREE from 'three'
import { createCampusScene } from '../world/campus/createCampusScene.js'
import { CameraRig } from '../camera/CameraRig.js'
import { InputController } from '../controls/InputController.js'

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

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    container.appendChild(renderer.domElement)

    const campus = createCampusScene(THREE)
    scene.add(campus)
    cameraRig = new CameraRig(THREE, renderer.domElement)
    input = new InputController(THREE, renderer.domElement, cameraRig, campus.userData.walkableBounds)
    input.attach()

    const hemi = new THREE.HemisphereLight(0xe8f0e8, 0x64735e, 2.0)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffedcf, 3.0)
    sun.position.set(-55, 90, 45)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
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
    input?.dispose()
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
