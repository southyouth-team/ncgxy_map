import { CollisionWorld } from '../physics/CollisionWorld.js'

export class InputController {
  constructor(THREE, domElement, cameraRig, bounds, collisionWorld = null) {
    this.THREE = THREE
    this.domElement = domElement
    this.cameraRig = cameraRig
    this.bounds = bounds || { minX: -75, maxX: 75, minZ: -75, maxZ: 75 }
    this.collisionWorld = collisionWorld || new CollisionWorld(this.bounds)
    this.groundRaycaster = THREE?.Raycaster ? new THREE.Raycaster() : null
    this.groundRayOrigin = THREE?.Vector3 ? new THREE.Vector3() : null
    this.groundRayDirection = THREE?.Vector3 ? new THREE.Vector3(0, -1, 0) : null
    this.playerEyeHeight = 1.7
    this.maxWalkableSlopeDegrees = 50
    this.gravity = 24
    this.verticalVelocity = 0
    this.grounded = true
    this.maxStepHeight = 0.45
    this.groundProbeDistance = 60
    this.mode = 'overview'
    this.movementEnabled = true
    this.keys = new Set()
    this.pointerDown = false
    this.lastPointer = { x: 0, y: 0 }
    this.pointerLocked = false
    this.touchLookPointerId = null
    this.navigationPath = null
    this.navigationPathIndex = 0
    this.navigationPathCompleted = false
    this.lastTouchLook = { x: 0, y: 0 }
    this.onKeyDown = (event) => {
      const key = event.key.toLowerCase()
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) return
      const target = event.target
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return
      this.keys.add(key)
      // 第一人称 WASD 也必须阻止浏览器默认滚动，否则按键会同时滚动页面。
      event.preventDefault()
    }
    this.onKeyUp = (event) => this.keys.delete(event.key.toLowerCase())
    this.onWindowBlur = () => this.keys.clear()
    this.onMouseDown = (event) => {
      if (event.button !== 0) return
      this.pointerDown = true
      this.lastPointer = { x: event.clientX, y: event.clientY }
    }
    this.onMouseMove = (event) => {
      if (this.mode === 'firstPerson' && this.pointerLocked) {
        this.cameraRig.rotateFirst(event.movementX, event.movementY)
        return
      }
      if (!this.pointerDown) return
      const dx = event.clientX - this.lastPointer.x
      const dy = event.clientY - this.lastPointer.y
      this.lastPointer = { x: event.clientX, y: event.clientY }
      if (this.mode === 'thirdPerson') this.cameraRig.rotateThird(dx, dy)
    }
    this.onMouseUp = () => { this.pointerDown = false }
    this.onWheel = (event) => {
      if (this.mode === 'thirdPerson') {
        event.preventDefault()
        this.cameraRig.zoomThird(event.deltaY)
      }
    }
    this.onClick = () => {
      if (this.mode === 'firstPerson' && !this.pointerLocked) this.domElement.requestPointerLock?.()
    }
    this.onPointerLock = () => { this.pointerLocked = document.pointerLockElement === this.domElement }
    this.onTouchPointerDown = (event) => {
      if (event.pointerType !== 'touch' || this.mode === 'overview') return
      this.touchLookPointerId = event.pointerId
      this.lastTouchLook = { x: event.clientX, y: event.clientY }
      this.domElement.setPointerCapture?.(event.pointerId)
    }
    this.onTouchPointerMove = (event) => {
      if (event.pointerType !== 'touch' || event.pointerId !== this.touchLookPointerId) return
      const dx = event.clientX - this.lastTouchLook.x
      const dy = event.clientY - this.lastTouchLook.y
      this.lastTouchLook = { x: event.clientX, y: event.clientY }
      if (this.mode === 'firstPerson') this.cameraRig.rotateFirst(dx, dy)
      else if (this.mode === 'thirdPerson') this.cameraRig.rotateThird(dx, dy)
    }
    this.onTouchPointerUp = (event) => {
      if (event.pointerId === this.touchLookPointerId) this.touchLookPointerId = null
    }
  }

  attach() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onWindowBlur)
    this.domElement.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false })
    this.domElement.addEventListener('click', this.onClick)
    document.addEventListener('pointerlockchange', this.onPointerLock)
    this.domElement.addEventListener('pointerdown', this.onTouchPointerDown)
    this.domElement.addEventListener('pointermove', this.onTouchPointerMove)
    this.domElement.addEventListener('pointerup', this.onTouchPointerUp)
    this.domElement.addEventListener('pointercancel', this.onTouchPointerUp)
  }

  setVirtualKey(key, pressed) {
    if (pressed) this.keys.add(key)
    else this.keys.delete(key)
  }

  setMode(mode) {
    this.mode = mode
    this.keys.clear()
    this.navigationPath = null
    this.navigationPathIndex = 0
    this.navigationPathCompleted = false
    this.pointerDown = false
    if (mode !== 'firstPerson') this.exitPointerLock()
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.domElement) document.exitPointerLock?.()
  }

  resetPosition(position = { x: 0, z: 24 }) {
    this.keys.clear()
    this.cameraRig.player.set(Number(position.x) || 0, 1.7, Number(position.z) || 0)
    this.verticalVelocity = 0
    this.grounded = true
  }

  setNavigationPath(path) {
    this.navigationPath = Array.isArray(path) && path.length > 1
      ? path.map(point => ({ x: Number(point.x), z: Number(point.z) })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.z))
      : null
    this.navigationPathIndex = this.navigationPath ? 1 : 0
    this.navigationPathCompleted = false
    return Boolean(this.navigationPath)
  }

  consumeNavigationPathCompletion() {
    const completed = this.navigationPathCompleted
    this.navigationPathCompleted = false
    return completed
  }

  setMovementEnabled(enabled) {
    this.movementEnabled = Boolean(enabled)
    if (!this.movementEnabled) this.keys.clear()
  }

  getPlayerSupportHit(player, { walking = false } = {}) {
    if (!this.groundRaycaster || !this.groundRayOrigin || !this.groundRayDirection) return null
    const surfaces = this.collisionWorld?.supportSurfaces || []
    const meshes = surfaces
      .filter(surface => surface.enabled !== false && (
        walking ? surface.walkable === true : surface.supportsStanding === true
      ))
      .flatMap(surface => surface.meshes || [])
    if (!meshes.length) return null

    this.groundRayOrigin.set(player.x, player.y + 0.2, player.z)
    this.groundRayDirection.set(0, -1, 0)
    this.groundRaycaster.set(this.groundRayOrigin, this.groundRayDirection)
    this.groundRaycaster.far = this.groundProbeDistance
    const hits = this.groundRaycaster.intersectObjects(meshes, false)
    const maxSlopeCos = Math.cos(this.maxWalkableSlopeDegrees * Math.PI / 180)
    for (const hit of hits) {
      if (!hit.face || !hit.object || !Number.isFinite(hit.point?.y)) continue
      const normalMatrix = new this.THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
      const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()
      if (normal.y < maxSlopeCos) continue
      return hit
    }
    return null
  }

  updateVerticalMotion(player, delta, { walking = false } = {}) {
    const dt = Math.max(0, Math.min(Number(delta) || 0, 0.05))
    if (!dt) return
    const hit = this.getPlayerSupportHit(player, { walking })
    const groundEyeY = hit ? hit.point.y + this.playerEyeHeight : this.playerEyeHeight

    // 只有从上方接近支撑面时才落地；向上运动不会被地面射线吸住。
    if (this.verticalVelocity <= 0 && player.y <= groundEyeY + this.maxStepHeight) {
      if (player.y >= groundEyeY - 0.08 || (this.grounded && player.y <= groundEyeY + this.maxStepHeight)) {
        player.y = groundEyeY
        this.verticalVelocity = 0
        this.grounded = true
        return
      }
    }

    this.grounded = false
    this.verticalVelocity -= this.gravity * dt
    player.y += this.verticalVelocity * dt
    if (player.y <= this.playerEyeHeight) {
      player.y = this.playerEyeHeight
      this.verticalVelocity = 0
      this.grounded = true
    }
  }

  resolvePlayerGroundHeight(player) {
    const hit = this.getPlayerSupportHit(player, { walking: false })
    return hit ? hit.point.y + this.playerEyeHeight : this.playerEyeHeight
  }

  update(delta) {
    if (this.mode === 'overview' || !this.movementEnabled) return
    const forward = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0)
    const strafe = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0)
    if (forward || strafe) this.navigationPath = null
    if (!forward && !strafe && this.navigationPath) {
      const target = this.navigationPath[this.navigationPathIndex]
      if (!target) { this.navigationPath = null; this.navigationPathCompleted = true; return }
      const player = this.cameraRig.player
      const dx = target.x - player.x, dz = target.z - player.z
      const distance = Math.hypot(dx, dz)
      if (distance <= 0.16) {
        this.navigationPathIndex += 1
        if (this.navigationPathIndex >= this.navigationPath.length) {
          this.navigationPath = null
          this.navigationPathCompleted = true
        }
        return
      }
      const travel = Math.min(distance, 5.5 * delta)
      const movement = this.collisionWorld.move(player, dx / distance * travel, dz / distance * travel)
      const moved = Math.hypot(movement.x - player.x, movement.z - player.z)
      if (moved < 0.002) { this.navigationPath = null; this.navigationPathCompleted = false; return }
      const previousX = player.x, previousZ = player.z
      player.x = movement.x
      player.z = movement.z
      const support = this.getPlayerSupportHit(player, { walking: true })
      const standing = this.getPlayerSupportHit(player, { walking: false })
      if (this.grounded && !support && standing) {
        player.x = previousX
        player.z = previousZ
      }
      this.updateVerticalMotion(player, delta, { walking: Boolean(support) })
      if (this.mode === 'thirdPerson') this.cameraRig.updateThirdPersonDesired()
      else this.cameraRig.updateFirstPersonDesired()
      return
    }
    if (!forward && !strafe) {
      this.updateVerticalMotion(this.cameraRig.player, delta)
      return
    }
    const speed = (this.keys.has('shift') ? 18 : 9) * delta
    // 第三人称 yaw 描述的是相机相对角色的偏移方向，角色前进方向与其相反。
    const yaw = this.mode === 'firstPerson' ? this.cameraRig.firstYaw : this.cameraRig.thirdYaw + Math.PI
    const length = Math.hypot(forward, strafe) || 1
    const f = forward / length
    const s = strafe / length
    // 按当前镜头方向计算移动；修正横向输入符号，使 D/→ 向屏幕右侧、A/← 向屏幕左侧。
    const dx = Math.sin(yaw) * f - Math.cos(yaw) * s
    const dz = Math.cos(yaw) * f + Math.sin(yaw) * s
    const player = this.cameraRig.player
    const movement = this.collisionWorld.move(player, dx * speed, dz * speed)
    const previousX = player.x, previousZ = player.z
    player.x = movement.x
    player.z = movement.z
    const support = this.getPlayerSupportHit(player, { walking: true })
    const standing = this.getPlayerSupportHit(player, { walking: false })
    if (this.grounded && !support && standing) {
      player.x = previousX
      player.z = previousZ
    }
    this.updateVerticalMotion(player, delta, { walking: Boolean(support) })
    if (this.mode === 'thirdPerson') this.cameraRig.updateThirdPersonDesired()
    else this.cameraRig.updateFirstPersonDesired()
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onWindowBlur)
    this.domElement.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    this.domElement.removeEventListener('wheel', this.onWheel)
    this.domElement.removeEventListener('click', this.onClick)
    document.removeEventListener('pointerlockchange', this.onPointerLock)
    this.domElement.removeEventListener('pointerdown', this.onTouchPointerDown)
    this.domElement.removeEventListener('pointermove', this.onTouchPointerMove)
    this.domElement.removeEventListener('pointerup', this.onTouchPointerUp)
    this.domElement.removeEventListener('pointercancel', this.onTouchPointerUp)
    this.exitPointerLock()
  }
}
