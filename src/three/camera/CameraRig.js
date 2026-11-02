import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export class CameraRig {
  constructor(THREE, domElement) {
    this.THREE = THREE
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 700)
    this.camera.position.set(0, 105, 112)
    this.target = new THREE.Vector3(0, 0, 0)
    this.currentPosition = this.camera.position.clone()
    this.currentTarget = this.target.clone()
    this.desiredPosition = this.camera.position.clone()
    this.desiredTarget = this.target.clone()
    this.mode = 'overview'
    this.thirdYaw = 0.35
    this.thirdPitch = 0.32
    this.thirdDistance = 15
    this.firstYaw = 0
    this.firstPitch = -0.12
    this.player = new THREE.Vector3(0, 1.7, 24)
    this.lookTarget = new THREE.Vector3()
    this.domElement = domElement

    this.orbit = new OrbitControls(this.camera, domElement)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.075
    this.orbit.screenSpacePanning = true
    this.orbit.maxPolarAngle = Math.PI * 0.49
    this.orbit.minDistance = 24
    this.orbit.maxDistance = 190
    this.orbit.target.set(0, 0, 0)
    this.orbit.enabled = true
    this.orbit.mouseButtons.LEFT = THREE.MOUSE.PAN
    this.orbit.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
    this.transitioningToOverview = false
  }

  setMode(mode) {
    if (!['overview', 'thirdPerson', 'firstPerson'].includes(mode)) return
    if (mode === this.mode) return
    this.mode = mode
    this.orbit.enabled = false
    if (mode === 'overview') {
      this.transitioningToOverview = true
      this.desiredPosition.set(0, 105, 112)
      this.desiredTarget.set(0, 0, 0)
    } else if (mode === 'thirdPerson') {
      this.orbit.enabled = false
      this.thirdYaw = Math.atan2(this.camera.position.x - this.player.x, this.camera.position.z - this.player.z)
      this.thirdDistance = 15
      this.updateThirdPersonDesired()
    } else {
      this.orbit.enabled = false
      const direction = new this.THREE.Vector3()
      this.camera.getWorldDirection(direction)
      this.firstYaw = Math.atan2(direction.x, direction.z)
      this.firstPitch = Math.asin(direction.y)
      // 保留当前漫游坐标，避免从第三人称切换时把角色瞬移到相机后方。
      this.updateFirstPersonDesired()
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
    this.thirdPitch = Math.max(-0.05, Math.min(0.85, this.thirdPitch + dy * 0.003))
    this.updateThirdPersonDesired()
  }

  rotateFirst(dx, dy) {
    this.firstYaw -= dx * 0.0022
    this.firstPitch = Math.max(-1.25, Math.min(1.25, this.firstPitch - dy * 0.0022))
    this.updateFirstPersonDesired()
  }

  zoomThird(delta) {
    this.thirdDistance = Math.max(6, Math.min(32, this.thirdDistance + delta * 0.012))
    this.updateThirdPersonDesired()
  }

  update(delta) {
    if (this.mode === 'overview' && !this.transitioningToOverview) {
      this.orbit.update()
      return
    }
    const alpha = 1 - Math.exp(-7 * delta)
    this.camera.position.lerp(this.desiredPosition, alpha)
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
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  focusCampus() {
    this.mode = 'overview'
    this.orbit.enabled = false
    this.transitioningToOverview = true
    this.orbit.target.set(0, 0, 0)
    this.camera.position.set(0, 105, 112)
    this.camera.lookAt(0, 0, 0)
    this.desiredPosition.copy(this.camera.position)
    this.desiredTarget.set(0, 0, 0)
    this.currentTarget.set(0, 0, 0)
    this.player.set(0, 1.7, 24)
  }
}
