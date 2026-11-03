import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export class CameraRig {
  constructor(THREE, domElement, options = {}) {
    this.THREE = THREE
    this.isometricRpg = Boolean(options.isometricRpg)
    this.domElement = domElement
    this.aspect = 1
    this.overviewSpan = 190
    this.overviewCamera = new THREE.OrthographicCamera(-95, 95, 95, -95, 0.1, 700)
    this.perspectiveCamera = new THREE.PerspectiveCamera(48, 1, 0.1, 700)
    this.camera = this.overviewCamera
    this.camera.position.set(0, 145, 145)
    this.target = new THREE.Vector3(0, 0, 0)
    this.currentPosition = this.camera.position.clone()
    this.currentTarget = this.target.clone()
    this.desiredPosition = this.camera.position.clone()
    this.desiredTarget = this.target.clone()
    this.mode = 'overview'
    this.thirdYaw = 0.35
    this.thirdPitch = this.isometricRpg ? 0.72 : 0.32
    this.thirdDistance = this.isometricRpg ? 24 : 15
    this.firstYaw = 0
    this.firstPitch = -0.12
    this.player = new THREE.Vector3(0, 1.7, 24)
    this.lookTarget = new THREE.Vector3()
    this.obstructionRaycaster = new THREE.Raycaster()
    this.obstructionObjects = []
    this.obstructionMargin = 0.38
    this.orbit = null
    this.createOrbitControls(this.overviewCamera)
    this.transitioningToOverview = false
    this.applyIsometricOrientation()
  }

  applyIsometricOrientation() {
    // 等距俯视：相机位于场景东北侧上方，使用正交投影避免透视收敛。
    this.camera.position.set(0, 145, 145)
    this.camera.lookAt(0, 0, 0)
    this.currentPosition.copy(this.camera.position)
    this.currentTarget.set(0, 0, 0)
    this.desiredPosition.copy(this.camera.position)
    this.desiredTarget.set(0, 0, 0)
  }

  createOrbitControls(camera) {
    this.orbit?.dispose()
    this.orbit = new OrbitControls(camera, this.domElement)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.075
    this.orbit.screenSpacePanning = true
    this.orbit.maxPolarAngle = Math.PI * 0.49
    this.orbit.minZoom = 0.55
    this.orbit.maxZoom = 2.8
    this.orbit.minDistance = 24
    this.orbit.maxDistance = 190
    this.orbit.target.set(0, 0, 0)
    this.orbit.enabled = this.mode === 'overview'
    this.orbit.mouseButtons.LEFT = this.THREE.MOUSE.PAN
    this.orbit.mouseButtons.RIGHT = this.THREE.MOUSE.ROTATE
  }

  activateCamera(camera) {
    this.camera = camera
    this.createOrbitControls(camera)
  }

  setMode(mode) {
    if (!['overview', 'thirdPerson', 'firstPerson'].includes(mode) || mode === this.mode) return
    const previousCamera = this.camera
    const previousMode = this.mode
    this.mode = mode
    this.orbit.enabled = false

    if (mode === 'overview') {
      this.activateCamera(this.overviewCamera)
      this.transitioningToOverview = true
      this.desiredPosition.set(0, 145, 145)
      this.desiredTarget.set(0, 0, 0)
    } else {
      if (this.isometricRpg && mode === 'thirdPerson') {
        this.activateCamera(this.overviewCamera)
        this.thirdPitch = 0.72
        this.thirdDistance = 24
        this.overviewCamera.zoom = 2.15
        this.overviewCamera.updateProjectionMatrix()
      } else if (previousCamera !== this.perspectiveCamera) {
        this.perspectiveCamera.position.copy(previousCamera.position)
        this.perspectiveCamera.quaternion.copy(previousCamera.quaternion)
        this.activateCamera(this.perspectiveCamera)
      }
      if (mode === 'thirdPerson') {
        this.thirdYaw = Math.atan2(this.camera.position.x - this.player.x, this.camera.position.z - this.player.z)
        this.thirdDistance = this.isometricRpg ? 24 : 15
        this.updateThirdPersonDesired()
      } else {
        // 从第三人称切入时沿用角色前进方向；从地图视角进入时默认朝向校园内部。
        if (previousMode === 'thirdPerson') {
          this.firstYaw = this.thirdYaw + Math.PI
          this.firstPitch = -this.thirdPitch
        } else {
          this.firstYaw = Math.PI
          this.firstPitch = -0.12
        }
        this.updateFirstPersonDesired()
      }
    }
    this.currentPosition.copy(this.camera.position)
    this.currentTarget.copy(this.camera.getWorldDirection(new this.THREE.Vector3()).add(this.camera.position))
  }

  updateThirdPersonDesired() {
    const horizontal = Math.cos(this.thirdPitch) * this.thirdDistance
    this.desiredPosition.set(
      this.player.x + Math.sin(this.thirdYaw) * horizontal,
      this.player.y + Math.sin(this.thirdPitch) * this.thirdDistance + 2,
      this.player.z + Math.cos(this.thirdYaw) * horizontal,
    )
    this.desiredTarget.set(this.player.x, this.player.y + 0.7, this.player.z)
    if (this.isometricRpg && this.camera === this.overviewCamera) {
      this.overviewCamera.zoom = Math.max(1.1, Math.min(3.1, 51.6 / this.thirdDistance))
      this.overviewCamera.updateProjectionMatrix()
    }
  }

  updateFirstPersonDesired() {
    this.desiredPosition.copy(this.player)
    const cp = Math.cos(this.firstPitch)
    this.desiredTarget.set(
      this.player.x + Math.sin(this.firstYaw) * cp,
      this.player.y + Math.sin(this.firstPitch),
      this.player.z + Math.cos(this.firstYaw) * cp,
    )
  }

  rotateThird(dx, dy) {
    this.thirdYaw -= dx * 0.004
    this.thirdPitch = this.isometricRpg
      ? Math.max(0.58, Math.min(0.92, this.thirdPitch + dy * 0.002))
      : Math.max(-0.05, Math.min(0.85, this.thirdPitch + dy * 0.003))
    this.updateThirdPersonDesired()
  }

  rotateFirst(dx, dy) {
    this.firstYaw -= dx * 0.0022
    this.firstPitch = Math.max(-1.25, Math.min(1.25, this.firstPitch - dy * 0.0022))
    this.updateFirstPersonDesired()
  }

  zoomThird(delta) {
    this.thirdDistance = Math.max(12, Math.min(this.isometricRpg ? 38 : 32, this.thirdDistance + delta * 0.012))
    this.updateThirdPersonDesired()
  }

  setObstructionObjects(objects = []) {
    this.obstructionObjects = Array.isArray(objects) ? objects.filter(Boolean) : []
  }

  getSafeThirdPersonPosition() {
    const direction = this.desiredPosition.clone().sub(this.desiredTarget)
    const desiredDistance = direction.length()
    if (!desiredDistance || !this.obstructionObjects.length) return { position: this.desiredPosition, obstructed: false }
    direction.normalize()
    this.obstructionRaycaster.set(this.desiredTarget, direction)
    this.obstructionRaycaster.near = 0.12
    this.obstructionRaycaster.far = desiredDistance
    const hit = this.obstructionRaycaster.intersectObjects(this.obstructionObjects, true)
      .find(item => item.distance > 0.12 && item.object.visible)
    if (!hit) return { position: this.desiredPosition, obstructed: false }
    const safeDistance = Math.max(1.25, hit.distance - this.obstructionMargin)
    return {
      position: this.desiredTarget.clone().addScaledVector(direction, Math.min(desiredDistance, safeDistance)),
      obstructed: true,
    }
  }

  update(delta) {
    if (this.mode === 'overview' && !this.transitioningToOverview) {
      this.orbit.update()
      return
    }
    const alpha = 1 - Math.exp(-7 * delta)
    const cameraTargetPosition = this.mode === 'thirdPerson'
      ? this.getSafeThirdPersonPosition()
      : { position: this.desiredPosition, obstructed: false }
    const cameraAlpha = cameraTargetPosition.obstructed ? 1 - Math.exp(-24 * delta) : alpha
    this.camera.position.lerp(cameraTargetPosition.position, cameraAlpha)
    this.currentTarget.lerp(this.desiredTarget, alpha)
    this.camera.lookAt(this.currentTarget)
    if (this.mode === 'overview' && this.transitioningToOverview && this.camera.position.distanceTo(this.desiredPosition) < 0.12) {
      this.camera.position.copy(this.desiredPosition)
      this.currentTarget.copy(this.desiredTarget)
      this.orbit.target.copy(this.desiredTarget)
      this.orbit.enabled = true
      this.transitioningToOverview = false
    }
  }

  resize(aspect) {
    this.aspect = aspect
    const halfHeight = this.overviewSpan / 2
    this.overviewCamera.left = -halfHeight * aspect
    this.overviewCamera.right = halfHeight * aspect
    this.overviewCamera.top = halfHeight
    this.overviewCamera.bottom = -halfHeight
    this.overviewCamera.updateProjectionMatrix()
    this.perspectiveCamera.aspect = aspect
    this.perspectiveCamera.updateProjectionMatrix()
  }

  focusBounds(width, depth, centerX = 0, centerZ = 0) {
    const span = Math.max(Number(width) || 80, Number(depth) || 60, 20) * 1.15
    const targetX = Number.isFinite(centerX) ? centerX : 0
    const targetZ = Number.isFinite(centerZ) ? centerZ : 0
    this.overviewSpan = span
    this.overviewCamera.left = -span * this.aspect / 2
    this.overviewCamera.right = span * this.aspect / 2
    this.overviewCamera.top = span / 2
    this.overviewCamera.bottom = -span / 2
    this.overviewCamera.updateProjectionMatrix()
    this.mode = 'overview'
    this.activateCamera(this.overviewCamera)
    this.transitioningToOverview = true
    this.desiredTarget.set(targetX, 0, targetZ)
    this.desiredPosition.set(targetX, span * 0.78, targetZ + span * 0.78)
    this.orbit.target.set(targetX, 0, targetZ)
  }

  focusCampus() {
    this.mode = 'overview'
    this.activateCamera(this.overviewCamera)
    this.transitioningToOverview = true
    this.orbit.target.set(0, 0, 0)
    this.applyIsometricOrientation()
    this.player.set(0, 1.7, this.isometricRpg ? 14 : 24)
    if (this.isometricRpg) {
      this.thirdPitch = 0.72
      this.thirdDistance = 24
      this.overviewCamera.zoom = 1
      this.overviewCamera.updateProjectionMatrix()
    }
  }

  dispose() {
    this.orbit?.dispose()
  }
}
