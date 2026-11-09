import { CollisionWorld } from '../physics/CollisionWorld.js'
import { normalizeCharacterTraversalProfile } from '../physics/CharacterTraversalProfile.js'

export class InputController {
  constructor(THREE, domElement, cameraRig, bounds, collisionWorld = null) {
    this.THREE = THREE
    this.domElement = domElement
    this.cameraRig = cameraRig
    this.bounds = bounds || { minX: -75, maxX: 75, minZ: -75, maxZ: 75 }
    this._collisionWorld = collisionWorld || new CollisionWorld(this.bounds)
    this.physicsRuntime = null
    this.physicsCharacterId = null
    this.traversalProfile = normalizeCharacterTraversalProfile({
      radius: Number(this._collisionWorld.radius) || undefined,
    })
    this.groundRaycaster = THREE?.Raycaster ? new THREE.Raycaster() : null
    this.groundRayOrigin = THREE?.Vector3 ? new THREE.Vector3() : null
    this.groundRayDirection = THREE?.Vector3 ? new THREE.Vector3(0, -1, 0) : null
    this.gravity = 24
    this.verticalVelocity = 0
    this.grounded = true
    this.groundProbeDistance = 60
    this.mode = 'overview'
    this.movementEnabled = true
    this.freeCameraMovementEnabled = false
    this.keys = new Set()
    this.pointerDown = false
    this.lastPointer = { x: 0, y: 0 }
    this.pointerLocked = false
    this.touchLookPointerId = null
    this.navigationPath = null
    this.navigationPathIndex = 0
    this.navigationPathCompleted = false
    this.navigationPathPhysicsCommanded = false
    this.lastPhysicsStepCount = 0
    this.jumpActive = false
    this.jumpRequested = false
    this.jumpLaunched = false
    this.spawnPosition = null
    this.lastTouchLook = { x: 0, y: 0 }
    this.onKeyDown = (event) => {
      const key = event.key.toLowerCase()
      const target = event.target
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return
      if (key === 'r') { this.resetPosition(); event.preventDefault(); return }
      if (key === ' ' || key === 'space' || event.code === 'Space') { if (!event.repeat) this.jumpPlayer(); event.preventDefault(); return }
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) return
      this.keys.add(key)
      this.onMovementInput?.()
      // 第一人称 WASD 也必须阻止浏览器默认滚动，否则按键会同时滚动页面。
      event.preventDefault()
    }
    this.onKeyUp = (event) => { this.keys.delete(event.key.toLowerCase()); this.onMovementInput?.() }
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

  get playerColliderRadius() { return this.traversalProfile.radius }
  set playerColliderRadius(value) { this.traversalProfile = normalizeCharacterTraversalProfile({ ...this.traversalProfile, radius: value }) }

  get playerEyeHeight() { return this.traversalProfile.height }
  set playerEyeHeight(value) { this.traversalProfile = normalizeCharacterTraversalProfile({ ...this.traversalProfile, height: value }) }

  get maxWalkableSlopeDegrees() { return this.traversalProfile.maxSlopeClimbAngleDegrees }
  set maxWalkableSlopeDegrees(value) { this.traversalProfile = normalizeCharacterTraversalProfile({ ...this.traversalProfile, maxSlopeClimbAngleDegrees: value }) }

  get maxStepHeight() { return this.traversalProfile.maxStepHeight }
  set maxStepHeight(value) { this.traversalProfile = normalizeCharacterTraversalProfile({ ...this.traversalProfile, maxStepHeight: value }) }

  get collisionWorld() {
    return this._collisionWorld
  }

  set collisionWorld(world) {
    this._collisionWorld = world
    world?.setRadius?.(this.playerColliderRadius)
  }

  setPhysicsRuntime(runtime, { id = 'sandbox:player' } = {}) {
    if (this.physicsRuntime && this.physicsCharacterId) {
      this.physicsRuntime.removeBody?.(this.physicsCharacterId)
    }
    this.physicsRuntime = runtime || null
    this.physicsCharacterId = runtime ? String(id) : null
    if (runtime && this.cameraRig?.player) {
      const player = this.cameraRig.player
      this.spawnPosition = { x: player.x, y: player.y, z: player.z }
    }
    if (!runtime) return false
    this.createPhysicsCharacter()
    return true
  }

  createPhysicsCharacter() {
    if (!this.physicsRuntime || !this.physicsCharacterId || !this.cameraRig?.player) return false
    const player = this.cameraRig.player
    this.physicsRuntime.removeBody?.(this.physicsCharacterId)
    this.physicsRuntime.createKinematicCharacter({
      id: this.physicsCharacterId,
      ownerId: this.physicsCharacterId,
      translation: { x: player.x, y: player.y - this.playerEyeHeight, z: player.z },
      traversalProfile: this.traversalProfile,
    })
    this.verticalVelocity = 0
    this.grounded = true
    this.lastPhysicsStepCount = this.physicsRuntime.getKinematicCharacterState?.(this.physicsCharacterId)?.stepCount || 0
    return true
  }

  syncPhysicsCharacterPosition() {
    if (!this.physicsRuntime || !this.physicsCharacterId || !this.cameraRig?.player) return false
    const player = this.cameraRig.player
    const synced = this.physicsRuntime.setKinematicCharacterPosition(this.physicsCharacterId, {
      x: player.x,
      y: player.y - this.playerEyeHeight,
      z: player.z,
    })
    this.lastPhysicsStepCount = this.physicsRuntime.getKinematicCharacterState?.(this.physicsCharacterId)?.stepCount || 0
    return synced
  }

  moveWithPhysics(player, dx, dz, delta) {
    if (!this.physicsRuntime || !this.physicsCharacterId) return null
    const dt = Math.max(0, Math.min(Number(delta) || 0, 0.05))
    if (!dt) return null
    const previousStepCount = this.lastPhysicsStepCount
    const currentState = this.physicsRuntime.getKinematicCharacterState?.(this.physicsCharacterId)
    if (!currentState) return null
    const launchPending = this.jumpRequested
    if (currentState.grounded && !this.jumpActive) this.verticalVelocity = 0
    else if (!currentState.grounded && !launchPending) this.verticalVelocity -= this.gravity * dt
    let horizontalX = (Number(dx) || 0) / dt
    let horizontalZ = (Number(dz) || 0) / dt
    if (this.jumpActive && !currentState.grounded) {
      const flightTime = 2 * Math.sqrt((2 * this.traversalProfile.jumpHeight) / this.gravity)
      const maxAirSpeed = this.traversalProfile.jumpMaxDistance / Math.max(flightTime, 0.001)
      const horizontalSpeed = Math.hypot(horizontalX, horizontalZ)
      if (horizontalSpeed > maxAirSpeed) {
        const scale = maxAirSpeed / horizontalSpeed
        horizontalX *= scale
        horizontalZ *= scale
      }
    }
    const verticalSpeed = this.jumpActive ? this.verticalVelocity : (currentState.grounded ? -2 : this.verticalVelocity)
    this.physicsRuntime.setKinematicCharacterVelocity(this.physicsCharacterId, { x: horizontalX, y: verticalSpeed, z: horizontalZ })
    if (launchPending) { this.jumpRequested = false; this.jumpLaunched = true }
    const state = this.physicsRuntime.getKinematicCharacterState(this.physicsCharacterId)
    player.x = state.translation.x
    player.y = state.translation.y + this.playerEyeHeight
    player.z = state.translation.z
    this.grounded = state.grounded === true
    this.lastPhysicsStepCount = state.stepCount
    if (this.jumpActive && this.jumpLaunched && this.grounded && state.stepCount > previousStepCount) {
      this.jumpActive = false
      this.jumpLaunched = false
      this.verticalVelocity = 0
    } else if (this.grounded && !this.jumpActive && this.verticalVelocity < 0) {
      this.verticalVelocity = 0
    }
    return { ...state, physicsStepped: state.stepCount > previousStepCount }
  }

  jumpPlayer() {
    if (!this.movementEnabled || this.mode === 'overview' || !this.grounded || this.jumpActive) return false
    this.verticalVelocity = Math.sqrt(2 * this.gravity * this.traversalProfile.jumpHeight)
    this.jumpActive = true
    this.jumpRequested = true
    this.jumpLaunched = false
    this.grounded = false
    return true
  }

  setPlayerDimensions({ eyeHeight, colliderRadius } = {}) {
    const previousEyeHeight = this.playerEyeHeight
    const nextEyeHeight = Number(eyeHeight)
    const nextRadius = Number(colliderRadius)
    if (Number.isFinite(nextRadius) && nextRadius > 0) {
      this.playerColliderRadius = Math.max(0.1, Math.min(1.5, nextRadius))
      this.collisionWorld?.setRadius?.(this.playerColliderRadius)
    }
    if (Number.isFinite(nextEyeHeight) && nextEyeHeight > 0.5) {
      this.playerEyeHeight = Math.max(0.8, Math.min(2.8, nextEyeHeight))
    }
    const eyeHeightDelta = this.playerEyeHeight - previousEyeHeight
    if (Math.abs(eyeHeightDelta) > 0.0001 && this.grounded && this.cameraRig?.player) {
      this.cameraRig.player.y += eyeHeightDelta
      if (this.mode === 'thirdPerson') this.cameraRig.updateThirdPersonDesired()
      else if (this.mode === 'firstPerson') this.cameraRig.updateFirstPersonDesired()
    }
    if (this.physicsRuntime) this.createPhysicsCharacter()
    return { eyeHeight: this.playerEyeHeight, colliderRadius: this.playerColliderRadius }
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
    this.navigationPathPhysicsCommanded = false
    this.pointerDown = false
    if (mode !== 'firstPerson') this.exitPointerLock()
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.domElement) document.exitPointerLock?.()
  }

  resetPosition(position = this.spawnPosition || { x: 0, z: 24 }) {
    this.keys.clear()
    this.setNavigationPath(null)
    this.jumpActive = false; this.jumpRequested = false; this.jumpLaunched = false
    this.verticalVelocity = 0; this.grounded = true
    const x = Number(position.x) || 0
    const y = Number.isFinite(Number(position.y)) ? Number(position.y) : this.playerEyeHeight
    const z = Number(position.z) || 0
    this.cameraRig.player.set(x, y, z)
    this.syncPhysicsCharacterPosition()
    if (this.mode === 'thirdPerson') this.cameraRig.updateThirdPersonDesired?.()
    else if (this.mode === 'firstPerson') this.cameraRig.updateFirstPersonDesired?.()
  }

  teleportPlayer(position) {
    const values = ['x', 'y', 'z'].map(axis => Number(position?.[axis]))
    if (!values.every(Number.isFinite)) return false
    this.keys.clear()
    this.setNavigationPath(null)
    this.pointerDown = false
    this.verticalVelocity = 0
    this.jumpActive = false; this.jumpRequested = false; this.jumpLaunched = false
    this.grounded = true
    this.cameraRig.player.set(values[0], values[1], values[2])
    this.syncPhysicsCharacterPosition()
    return true
  }

  setNavigationPath(path) {
    this.navigationPath = Array.isArray(path) && path.length > 1
      ? path.map(point => ({ x: Number(point.x), z: Number(point.z) })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.z))
      : null
    this.navigationPathIndex = this.navigationPath ? 1 : 0
    this.navigationPathCompleted = false
    this.navigationPathPhysicsCommanded = false
    return Boolean(this.navigationPath)
  }

  consumeNavigationPathCompletion() {
    const completed = this.navigationPathCompleted
    this.navigationPathCompleted = false
    return completed
  }

  stopPhysicsCharacterMovement() {
    if (this.physicsRuntime && this.physicsCharacterId) {
      this.physicsRuntime.setKinematicCharacterVelocity(this.physicsCharacterId, { x: 0, y: 0, z: 0 })
    }
  }

  setMovementEnabled(enabled) {
    this.movementEnabled = Boolean(enabled)
    if (!this.movementEnabled) {
      this.keys.clear()
      this.stopPhysicsCharacterMovement()
    }
  }

  setFreeCameraMovementEnabled(enabled) {
    this.freeCameraMovementEnabled = Boolean(enabled)
    if (!this.freeCameraMovementEnabled) this.stopPhysicsCharacterMovement()
  }

  getPlayerSupportHit(player, { walking = false } = {}) {
    if (!this.groundRaycaster || !this.groundRayOrigin || !this.groundRayDirection) return null
    const surfaces = this.collisionWorld?.supportSurfaces || []
    const meshes = surfaces
      .filter(surface => surface.enabled !== false && (
        walking ? surface.walkable === true : (surface.supportsStanding === true || surface.walkable === true)
      ))
      .flatMap(surface => surface.meshes || [])
    if (!meshes.length) return null

    // 从角色上方的探测高度向下扫描，不能从角色眼睛附近起射：
    // 高于当前人物位置的地形/坡面否则会被直接漏检。
    this.groundRayOrigin.set(player.x, player.y + this.groundProbeDistance, player.z)
    this.groundRayDirection.set(0, -1, 0)
    this.groundRaycaster.set(this.groundRayOrigin, this.groundRayDirection)
    this.groundRaycaster.far = this.groundProbeDistance * 2
    const hits = this.groundRaycaster.intersectObjects(meshes, false)
    const maxSlopeCos = Math.cos(this.maxWalkableSlopeDegrees * Math.PI / 180)
    const feetY = player.y - this.playerEyeHeight
    const highestReachableY = feetY + this.maxStepHeight + 0.08
    for (const hit of hits) {
      if (!hit.face || !hit.object || !Number.isFinite(hit.point?.y)) continue
      // 不能把人物脚底上方过高的楼层/平台当作当前支撑面，否则会隔空吸附。
      if (hit.point.y > highestReachableY) continue
      const normalMatrix = new this.THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
      const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()
      if (normal.y < maxSlopeCos) continue
      return hit
    }
    return null
  }

  resolveHorizontalPosition(player, movement) {
    const previous = { x: player.x, z: player.z }
    const currentSupport = this.getPlayerSupportHit(player, { walking: false })
    const nextPlayer = { ...player, x: movement.x, z: movement.z }
    const nextWalkable = this.getPlayerSupportHit(nextPlayer, { walking: true })
    const nextStanding = this.getPlayerSupportHit(nextPlayer, { walking: false })

    if (this.grounded && currentSupport) {
      // 有站立支撑的平台边缘：不允许跨到不可行走区域或超过台阶上限的高差。
      if (nextStanding && !nextWalkable) return previous
      if (nextWalkable) {
        const currentY = currentSupport.point.y
        const nextY = nextWalkable.point.y
        if (nextY - currentY > this.maxStepHeight) return previous
      }
    } else if (this.grounded && nextStanding && !nextWalkable) {
      return previous
    }

    return { x: movement.x, z: movement.z, support: nextWalkable || nextStanding }
  }

  updateVerticalMotion(player, delta, { walking = false } = {}) {
    const dt = Math.max(0, Math.min(Number(delta) || 0, 0.05))
    if (!dt) return
    const hit = this.getPlayerSupportHit(player, { walking })
    const groundEyeY = hit ? hit.point.y + this.playerEyeHeight : this.playerEyeHeight

    // 只有从上方接近支撑面时才落地；向上运动不会被地面射线吸住。
    if (this.verticalVelocity <= 0 && player.y <= groundEyeY + this.maxStepHeight) {
      if (player.y >= groundEyeY - this.maxStepHeight && player.y <= groundEyeY + 0.08) {
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
    if ((this.mode === 'overview' && !this.freeCameraMovementEnabled) || !this.movementEnabled) return
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
      if (this.physicsRuntime) {
        const previous = { x: player.x, y: player.y, z: player.z }
        const result = this.moveWithPhysics(player, dx / distance * travel, dz / distance * travel, delta)
        const moved = result ? Math.hypot(player.x - previous.x, player.z - previous.z) : 0
        if (this.navigationPathPhysicsCommanded && result?.physicsStepped && moved < 0.002) {
          this.navigationPath = null
          this.navigationPathCompleted = false
          this.navigationPathPhysicsCommanded = false
          return
        }
        this.navigationPathPhysicsCommanded = true
      } else {
        const movement = this.collisionWorld.move(player, dx / distance * travel, dz / distance * travel)
        const moved = Math.hypot(movement.x - player.x, movement.z - player.z)
        if (moved < 0.002) { this.navigationPath = null; this.navigationPathCompleted = false; return }
        const resolved = this.resolveHorizontalPosition(player, movement)
        player.x = resolved.x
        player.z = resolved.z
        this.updateVerticalMotion(player, delta, { walking: Boolean(resolved.support) })
      }
      if (this.mode === 'thirdPerson') this.cameraRig.updateThirdPersonDesired()
      else if (this.mode === 'firstPerson') this.cameraRig.updateFirstPersonDesired()
      return
    }
    if (!forward && !strafe) {
      const player = this.cameraRig.player
      const previous = { x: player.x, y: player.y, z: player.z }
      if (this.physicsRuntime) this.moveWithPhysics(player, 0, 0, delta)
      else this.updateVerticalMotion(player, delta)
      // 物理固定步长可能在当前渲染帧开始时完成移动；三个轴都必须同步到跟随相机。
      if (Math.hypot(player.x - previous.x, player.y - previous.y, player.z - previous.z) > 0.0001) {
        if (this.mode === 'thirdPerson') this.cameraRig.updateThirdPersonDesired()
        else if (this.mode === 'firstPerson') this.cameraRig.updateFirstPersonDesired()
      }
      return
    }
    const speed = (this.keys.has('shift') ? 18 : 9) * delta
    // 第三人称 yaw 描述的是相机相对角色的偏移方向，角色前进方向与其相反。
    const yaw = this.mode === 'firstPerson'
      ? this.cameraRig.firstYaw
      : this.mode === 'thirdPerson'
        ? this.cameraRig.thirdYaw + Math.PI
        : Math.atan2(
          (this.cameraRig.orbit?.target?.x ?? 0) - this.cameraRig.camera.position.x,
          (this.cameraRig.orbit?.target?.z ?? 0) - this.cameraRig.camera.position.z,
        )
    const length = Math.hypot(forward, strafe) || 1
    const f = forward / length
    const s = strafe / length
    // 按当前镜头方向计算移动；修正横向输入符号，使 D/→ 向屏幕右侧、A/← 向屏幕左侧。
    const dx = Math.sin(yaw) * f - Math.cos(yaw) * s
    const dz = Math.cos(yaw) * f + Math.sin(yaw) * s
    const player = this.cameraRig.player
    if (this.physicsRuntime) {
      this.moveWithPhysics(player, dx * speed, dz * speed, delta)
    } else {
      const movement = this.collisionWorld.move(player, dx * speed, dz * speed)
      const resolved = this.resolveHorizontalPosition(player, movement)
      player.x = resolved.x
      player.z = resolved.z
      this.updateVerticalMotion(player, delta, { walking: Boolean(resolved.support) })
    }
    if (this.mode === 'thirdPerson') this.cameraRig.updateThirdPersonDesired()
    else if (this.mode === 'firstPerson') this.cameraRig.updateFirstPersonDesired()
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
