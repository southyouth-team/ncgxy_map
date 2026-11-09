import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export class CameraRig {
  constructor(THREE, domElement, options = {}) {
    this.THREE = THREE
    this.isometricRpg = Boolean(options.isometricRpg)
    // 展示投影与相机操控模式分离：2.5D 使用正交投影，3D 使用透视投影。
    this.viewMode = options.viewMode === '3d' ? '3d' : '2.5d'
    this.domElement = domElement
    // 右键拖动用于 3D 总览平移，必须屏蔽浏览器原生菜单，否则拖动可能被菜单打断。
    this.preventContextMenu = event => event.preventDefault()
    this.domElement.addEventListener('contextmenu', this.preventContextMenu)
    this.aspect = 1
    this.overviewSpan = 190
    this.overviewCamera = new THREE.OrthographicCamera(-95, 95, 95, -95, 0.5, 3200)
    this.perspectiveCamera = new THREE.PerspectiveCamera(48, 1, 0.5, 3200)
    // 首次进入时也必须尊重 URL/应用指定的投影模式，不能先创建正交相机再等待用户切换。
    this.camera = this.viewMode === '3d' ? this.perspectiveCamera : this.overviewCamera
    this.camera.position.set(0, 145, 145)
    this.target = new THREE.Vector3(0, 0, 0)
    // 2.5D 与 3D 总览各自维护平移中心，切换投影不串用另一视角的拖拽结果。
    this.overviewTargets = {
      '2.5d': new THREE.Vector3(0, 0, 0),
      '3d': new THREE.Vector3(0, 0, 0),
    }
    this.currentPosition = this.camera.position.clone()
    this.currentTarget = this.target.clone()
    this.desiredPosition = this.camera.position.clone()
    this.desiredTarget = this.target.clone()
    this.mode = 'overview'
    this.thirdYaw = 0.35
    // 宝可梦式 2.5D：固定世界方位的高位斜俯视，镜头只跟随玩家位置，不绕到玩家背后。
    // thirdPitch 为相对水平面的仰角；1.08 rad 约等于 62° 向下观察。
    this.thirdPitch = this.viewMode === '2.5d' ? 1.08 : 0.32
    this.thirdDistance = this.viewMode === '2.5d' ? 34 : 15
    this.fixed2dYaw = 0
    this.firstYaw = 0
    this.firstPitch = -0.12
    this.player = new THREE.Vector3(0, 1.7, 24)
    this.lookTarget = new THREE.Vector3()
    this.obstructionRaycaster = new THREE.Raycaster()
    this.obstructionObjects = []
    this.obstructionMargin = 0.38
    this.orbit = null
    this.orbitInteractionSuppressed = false
    this.createOrbitControls(this.camera)
    // 3D 总览独立处理右键/中键拖动，避免 OrbitControls 鼠标映射被浏览器或其他监听器干扰。
    this.panPointer = null
    this.onOverviewPanPointerDown = event => {
      if (this.mode !== 'overview' || this.viewMode !== '3d' || ![1, 2].includes(event.button)) return
      event.preventDefault()
      event.stopPropagation()
      this.panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
      this.orbit.enabled = false
      this.domElement.setPointerCapture?.(event.pointerId)
    }
    this.onOverviewPanPointerMove = event => {
      if (!this.panPointer || event.pointerId !== this.panPointer.id) return
      event.preventDefault()
      const dx = event.clientX - this.panPointer.x
      const dy = event.clientY - this.panPointer.y
      this.panPointer.x = event.clientX
      this.panPointer.y = event.clientY
      const distance = this.camera.position.distanceTo(this.orbit.target)
      const viewHeight = 2 * distance * Math.tan(this.THREE.MathUtils.degToRad(this.perspectiveCamera.fov) / 2)
      const scale = viewHeight / Math.max(this.domElement.clientHeight, 1)
      const right = new this.THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
      right.y = 0
      if (right.lengthSq() > 0.000001) right.normalize()
      const forward = this.camera.getWorldDirection(new this.THREE.Vector3())
      forward.y = 0
      if (forward.lengthSq() > 0.000001) forward.normalize()
      const offset = right.multiplyScalar(-dx * scale).add(forward.multiplyScalar(dy * scale))
      this.camera.position.add(offset)
      this.orbit.target.add(offset)
      this.overviewTargets['3d'].copy(this.orbit.target)
      this.currentPosition.copy(this.camera.position)
      this.currentTarget.copy(this.orbit.target)
      this.camera.updateMatrixWorld()
      this.orbit.update()
    }
    this.onOverviewPanPointerUp = event => {
      if (!this.panPointer || event.pointerId !== this.panPointer.id) return
      this.panPointer = null
      if (this.mode === 'overview') this.orbit.enabled = true
      if (this.domElement.hasPointerCapture?.(event.pointerId)) this.domElement.releasePointerCapture(event.pointerId)
    }
    // 在捕获阶段优先接管右键/中键，避免 OrbitControls 或页面其他监听器先消费右键手势。
    this.domElement.addEventListener('pointerdown', this.onOverviewPanPointerDown, true)
    this.domElement.addEventListener('pointermove', this.onOverviewPanPointerMove)
    this.domElement.addEventListener('pointerup', this.onOverviewPanPointerUp)
    this.domElement.addEventListener('pointercancel', this.onOverviewPanPointerUp)
    this.transitioningToOverview = false
    this.applyIsometricOrientation()
  }

  applyIsometricOrientation() {
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
    this.orbit.addEventListener('change', () => {
      if (this.mode === 'overview' && this.overviewTargets?.[this.viewMode]) {
        this.overviewTargets[this.viewMode].copy(this.orbit.target)
      }
    })
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
    // 2.5D 总览是固定方位的地图浏览，只允许平移/缩放；3D 总览保留旋转观察。
    this.orbit.enableRotate = this.viewMode === '3d'
    // 3D 总览遵循常见三维地图操作：左键旋转、右键平移；2.5D 左右键均平移。
    this.orbit.mouseButtons.LEFT = this.viewMode === '3d' ? this.THREE.MOUSE.ROTATE : this.THREE.MOUSE.PAN
    // 右键和中键均提供平移，避免触控板/鼠标中键习惯差异导致无法操作。
    this.orbit.mouseButtons.RIGHT = this.THREE.MOUSE.PAN
    this.orbit.mouseButtons.MIDDLE = this.THREE.MOUSE.PAN
    if (this.orbit.touches) {
      this.orbit.touches.ONE = this.viewMode === '3d' ? this.THREE.TOUCH.ROTATE : this.THREE.TOUCH.PAN
      this.orbit.touches.TWO = this.THREE.TOUCH.DOLLY_PAN
    }
  }

  activateCamera(camera) {
    this.camera = camera
    this.createOrbitControls(camera)
  }

  resetOverviewZoom() {
    // 正交相机的 zoom 会跨视角保留；总览必须回到 1，否则地图边界计算正确
    // 但实际可视范围仍会被旧 zoom 二次放大，表现为校园逐渐变小/取景不一致。
    this.overviewCamera.zoom = 1
    this.overviewCamera.updateProjectionMatrix()
  }

  setMode(mode) {
    if (!['overview', 'thirdPerson', 'firstPerson'].includes(mode) || mode === this.mode) return
    // 第一人称仅属于 3D；2.5D 的角色跟随始终保持固定斜俯视。 
    if (mode === 'firstPerson' && this.viewMode !== '3d') return
    const previousCamera = this.camera
    const previousMode = this.mode
    this.mode = mode
    this.orbit.enabled = false

    if (mode === 'overview') {
      this.activateCamera(this.viewMode === '2.5d' ? this.overviewCamera : this.perspectiveCamera)
      if (this.viewMode === '2.5d') this.resetOverviewZoom()
      this.transitioningToOverview = true
      this.desiredPosition.set(0, 145, 145)
      this.desiredTarget.set(0, 0, 0)
    } else {
      const targetCamera = mode === 'firstPerson' || this.viewMode === '3d'
        ? this.perspectiveCamera
        : this.overviewCamera
      if (previousCamera !== targetCamera) {
        targetCamera.position.copy(previousCamera.position)
        targetCamera.quaternion.copy(previousCamera.quaternion)
        this.activateCamera(targetCamera)
      }
      if (mode === 'thirdPerson') {
        if (this.viewMode === '2.5d') {
          this.thirdPitch = 1.08
          this.thirdDistance = 34
          this.thirdYaw = this.fixed2dYaw
        } else {
          this.thirdPitch = 0.32
          this.thirdDistance = 15
        }
      }
      if (mode === 'thirdPerson') {
        if (this.viewMode === '2.5d') {
          // 固定地图方位，不根据切换前相机位置计算人物背后方向。
          this.thirdYaw = this.fixed2dYaw
        } else {
          this.thirdYaw = Math.atan2(this.camera.position.x - this.player.x, this.camera.position.z - this.player.z)
        }
        this.updateThirdPersonDesired()
      } else {
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
    if (mode === 'firstPerson') {
      // 第一人称必须使用透视相机，并直接落到角色眼部位置，不能沿用 2.5D 正交总览镜头缓慢飞行。
      this.camera.position.copy(this.desiredPosition)
      this.currentPosition.copy(this.desiredPosition)
      this.currentTarget.copy(this.desiredTarget)
      this.camera.lookAt(this.desiredTarget)
    } else {
      this.currentPosition.copy(this.camera.position)
      this.currentTarget.copy(this.camera.getWorldDirection(new this.THREE.Vector3()).add(this.camera.position))
    }
  }

  setViewMode(viewMode) {
    if (!['2.5d', '3d'].includes(viewMode) || viewMode === this.viewMode) return
    const previousCamera = this.camera
    const previousPosition = previousCamera.position.clone()
    const previousQuaternion = previousCamera.quaternion.clone()
    // 总览模式以 OrbitControls 的实时目标为准；currentTarget 在用户拖拽后不一定同步。
    const previousTarget = this.mode === 'overview'
      ? this.orbit.target.clone()
      : this.currentTarget.clone()
    if (this.mode === 'overview') this.overviewTargets[this.viewMode].copy(previousTarget)
    const nextOverviewTarget = this.overviewTargets[viewMode].clone()
    const viewDirection = previousPosition.clone().sub(previousTarget)
    const previousDistance = Math.max(viewDirection.length(), 0.001)
    viewDirection.normalize()

    this.viewMode = viewMode
    // 第一人称始终保持透视投影；2.5D/3D 切换只影响总览与跟随模式。
    const targetCamera = this.mode === 'firstPerson' || viewMode === '3d'
      ? this.perspectiveCamera
      : this.overviewCamera

    if (this.mode === 'overview') {
      // 正交与透视相机使用不同的缩放机制。按垂直视场高度换算，
      // 但 2.5D 必须使用独立的固定方位，不能继承 3D 总览最后一次旋转/俯仰。
      let visibleHeight
      if (viewMode === '2.5d') {
        visibleHeight = previousCamera.isOrthographicCamera
          ? (previousCamera.top - previousCamera.bottom) / previousCamera.zoom
          : 2 * previousDistance * Math.tan(this.THREE.MathUtils.degToRad(previousCamera.fov) / 2)
        this.overviewSpan = visibleHeight
        const halfHeight = visibleHeight / 2
        this.overviewCamera.left = -halfHeight * this.aspect
        this.overviewCamera.right = halfHeight * this.aspect
        this.overviewCamera.top = halfHeight
        this.overviewCamera.bottom = -halfHeight
        this.resetOverviewZoom()
        // 2.5D 总览固定为北向上、45° 斜俯视；只继承观察中心，不继承 3D 相机姿态。
        const fixedDistance = Math.max(145, this.overviewSpan * 1.1)
        targetCamera.position.set(nextOverviewTarget.x, fixedDistance, nextOverviewTarget.z + fixedDistance)
      } else if (previousCamera.isOrthographicCamera) {
        visibleHeight = (previousCamera.top - previousCamera.bottom) / previousCamera.zoom
        const perspectiveDistance = visibleHeight / (2 * Math.tan(this.THREE.MathUtils.degToRad(targetCamera.fov) / 2))
        targetCamera.position.copy(nextOverviewTarget).addScaledVector(viewDirection, perspectiveDistance)
      } else {
        visibleHeight = 2 * previousDistance * Math.tan(this.THREE.MathUtils.degToRad(previousCamera.fov) / 2)
        targetCamera.position.copy(nextOverviewTarget).addScaledVector(viewDirection, previousDistance)
      }
      targetCamera.lookAt(nextOverviewTarget)
    } else {
      // 跟随与第一人称的镜头位置由角色状态驱动，切换投影后再按各自模式重算目标位置。
      targetCamera.position.copy(previousPosition)
      targetCamera.quaternion.copy(previousQuaternion)
      if (this.mode === 'thirdPerson') {
        this.thirdPitch = viewMode === '2.5d' ? 1.08 : 0.32
        this.thirdDistance = viewMode === '2.5d' ? 34 : 15
        if (viewMode === '2.5d') this.thirdYaw = this.fixed2dYaw
      }
    }

    this.activateCamera(targetCamera)
    this.currentPosition.copy(targetCamera.position)
    const activeTarget = this.mode === 'overview' ? nextOverviewTarget : previousTarget
    this.currentTarget.copy(activeTarget)
    this.desiredPosition.copy(targetCamera.position)
    this.desiredTarget.copy(activeTarget)
    this.transitioningToOverview = false

    if (this.mode === 'overview') {
      this.orbit.target.copy(nextOverviewTarget)
      this.orbit.enabled = true
    } else {
      this.orbit.enabled = false
      if (this.mode === 'thirdPerson') this.updateThirdPersonDesired()
      else this.updateFirstPersonDesired()
    }
    targetCamera.lookAt(this.mode === 'overview' ? nextOverviewTarget : this.desiredTarget)
  }

  updateThirdPersonDesired() {
    const horizontal = Math.cos(this.thirdPitch) * this.thirdDistance
    this.desiredPosition.set(
      this.player.x + Math.sin(this.thirdYaw) * horizontal,
      this.player.y + Math.sin(this.thirdPitch) * this.thirdDistance + 2,
      this.player.z + Math.cos(this.thirdYaw) * horizontal,
    )
    this.desiredTarget.set(this.player.x, this.player.y + 0.7, this.player.z)
    if (this.viewMode === '2.5d' && this.camera === this.overviewCamera) {
      // 固定斜俯视使用正交投影，默认纵向视野约 48 个世界单位，接近经典宝可梦地图的取景密度。
      // 镜头空间距离与地图缩放解耦，避免改变俯仰角时人物比例忽大忽小。
      this.overviewCamera.zoom = Math.max(2.2, Math.min(5.2, 190 / 48 / (this.thirdDistance / 34)))
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
    // 2.5D 跟随严格锁定地图方位与俯角；仅 3D 跟随允许自由调整观察角度。
    if (this.viewMode === '2.5d') return
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
    this.thirdDistance = Math.max(this.viewMode === '2.5d' ? 24 : 6, Math.min(this.viewMode === '2.5d' ? 46 : 32, this.thirdDistance + delta * 0.012))
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
    // Sprite.raycast 需要 camera.matrixWorld；第三人称遮挡检测复用场景相机，
    // 否则加入 2.5D 图片 Sprite 后会因 Raycaster.camera=null 触发运行时异常。
    this.camera.updateMatrixWorld(true)
    this.obstructionRaycaster.camera = this.camera
    this.obstructionRaycaster.set(this.desiredTarget, direction)
    this.obstructionRaycaster.near = 0.12
    this.obstructionRaycaster.far = desiredDistance
    const obstructionRoots = this.obstructionObjects.filter(object => object?.isObject3D && object.parent)
    const hit = this.obstructionRaycaster.intersectObjects(obstructionRoots, true)
      .find(item => item.distance > 0.12 && item.object?.visible && !item.object.isSprite)
    if (!hit) return { position: this.desiredPosition, obstructed: false }
    const safeDistance = Math.max(1.25, hit.distance - this.obstructionMargin)
    return {
      position: this.desiredTarget.clone().addScaledVector(direction, Math.min(desiredDistance, safeDistance)),
      obstructed: true,
    }
  }

  setOrbitInteractionEnabled(enabled) {
    // TransformControls 拖动期间暂停总览相机输入，避免同一指针手势同时驱动模型和 OrbitControls。
    this.orbitInteractionSuppressed = !enabled
    this.orbit.enabled = Boolean(enabled) && this.mode === 'overview' && !this.transitioningToOverview
  }

  update(delta) {
    if (this.mode === 'overview' && !this.transitioningToOverview) {
      // 拖拽模型时连 OrbitControls 的阻尼更新也暂停，避免残余惯性继续推动镜头。
      if (this.orbitInteractionSuppressed) return false
      // OrbitControls.update() 返回相机是否仍在变化；供引擎判断是否需要下一帧。
      return this.orbit.update()
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
    return this.mode !== 'overview' || this.transitioningToOverview
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

  focusBounds(width, depth, centerX = 0, centerZ = 0, options = {}) {
    const aspect = Math.max(this.aspect, 0.1)
    const fitHeight = Math.max(Number(depth) || 60, (Number(width) || 80) / aspect, 20)
    const span = fitHeight * 1.15
    const targetX = Number.isFinite(centerX) ? centerX : 0
    const targetZ = Number.isFinite(centerZ) ? centerZ : 0
    this.overviewSpan = span
    this.overviewCamera.left = -span * aspect / 2
    this.overviewCamera.right = span * aspect / 2
    this.overviewCamera.top = span / 2
    this.overviewCamera.bottom = -span / 2
    this.resetOverviewZoom()
    this.mode = 'overview'
    this.activateCamera(this.viewMode === '2.5d' ? this.overviewCamera : this.perspectiveCamera)
    this.desiredTarget.set(targetX, 0, targetZ)
    this.desiredPosition.set(targetX, span * 0.78, targetZ + span * 0.78)
    // 首次按校园内容包络聚焦时，同步初始化两套视角中心；后续用户平移互不覆盖。
    this.overviewTargets['2.5d'].set(targetX, 0, targetZ)
    this.overviewTargets['3d'].set(targetX, 0, targetZ)
    this.orbit.target.set(targetX, 0, targetZ)

    if (options.immediate) {
      this.camera.position.copy(this.desiredPosition)
      this.currentPosition.copy(this.desiredPosition)
      this.currentTarget.copy(this.desiredTarget)
      this.camera.lookAt(this.currentTarget)
      this.transitioningToOverview = false
      this.orbit.enabled = true
    } else {
      this.transitioningToOverview = true
    }
  }

  focusCampus() {
    this.mode = 'overview'
    this.activateCamera(this.viewMode === '2.5d' ? this.overviewCamera : this.perspectiveCamera)
    if (this.viewMode === '2.5d') this.resetOverviewZoom()
    this.transitioningToOverview = true
    this.overviewTargets['2.5d'].set(0, 0, 0)
    this.overviewTargets['3d'].set(0, 0, 0)
    this.orbit.target.set(0, 0, 0)
    this.applyIsometricOrientation()
    this.player.set(0, 1.7, this.isometricRpg ? 14 : 24)
    if (this.viewMode === '2.5d') {
      this.thirdPitch = 1.08
      this.thirdDistance = 34
      this.thirdYaw = this.fixed2dYaw
    }
  }

  dispose() {
    this.orbit?.dispose()
    this.domElement?.removeEventListener('contextmenu', this.preventContextMenu)
    this.domElement?.removeEventListener('pointerdown', this.onOverviewPanPointerDown, true)
    this.domElement?.removeEventListener('pointermove', this.onOverviewPanPointerMove)
    this.domElement?.removeEventListener('pointerup', this.onOverviewPanPointerUp)
    this.domElement?.removeEventListener('pointercancel', this.onOverviewPanPointerUp)
  }
}
