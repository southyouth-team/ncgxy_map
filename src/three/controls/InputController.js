import { CollisionWorld } from '../physics/CollisionWorld.js'
import { normalizeCharacterTraversalProfile } from '../physics/CharacterTraversalProfile.js'
import { CharacterInputSystem } from './CharacterInputSystem.js'
import { CharacterMotor } from './CharacterMotor.js'

function normalizeControlKey(eventOrKey) {
  const event = typeof eventOrKey === 'object' && eventOrKey !== null ? eventOrKey : null
  const code = String(event?.code || '')
  const codeMap = {
    KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyR: 'r',
    ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
    ShiftLeft: 'shift', ShiftRight: 'shift', Space: 'space',
  }
  if (codeMap[code]) return codeMap[code]
  const key = String(event ? event.key : eventOrKey || '').toLowerCase()
  return key === ' ' || key === 'spacebar' ? 'space' : key
}

export class InputController {
  constructor(THREE, domElement, cameraRig, bounds, collisionWorld = null) {
    this.THREE = THREE
    this.domElement = domElement
    this.cameraRig = cameraRig
    this.bounds = bounds || { minX: -75, maxX: 75, minZ: -75, maxZ: 75 }
    this._collisionWorld = collisionWorld || new CollisionWorld(this.bounds)
    this.physicsRuntime = null
    this.physicsCharacterId = null
    this.traversalProfile = Object.freeze(normalizeCharacterTraversalProfile())
    this._collisionWorld?.setRadius?.(this.traversalProfile.radius)
    this.groundRaycaster = THREE?.Raycaster ? new THREE.Raycaster() : null
    this.groundRayOrigin = THREE?.Vector3 ? new THREE.Vector3() : null
    this.groundRayDirection = THREE?.Vector3 ? new THREE.Vector3(0, -1, 0) : null
    this.motor = new CharacterMotor({ traversalProfile: this.traversalProfile })
    this.groundProbeDistance = 60
    this.mode = 'overview'
    this.movementEnabled = true
    this.freeCameraMovementEnabled = false
    this.inputSystem = new CharacterInputSystem({
      onJump: () => this.jumpPlayer(),
      onReset: () => this.resetPosition(),
      onInputChange: () => this.onMovementInput?.(),
      onClearInput: () => { this.jumpBufferRemaining = 0 },
    })
    this.keys = this.inputSystem.keys
    this.pointerDown = false
    this.lastPointer = { x: 0, y: 0 }
    this.pointerLocked = false
    this.touchLookPointerId = null
    this.navigationPath = null
    this.navigationPathIndex = 0
    this.navigationPathCompleted = false
    this.navigationPathPhysicsCommanded = false
    this.spawnPosition = null
    this.lastTouchLook = { x: 0, y: 0 }
    this.attached = false
    // Compatibility aliases keep existing callers/tests stable while the input
    // system owns keyboard normalization, held state, and browser lifecycle.
    this.onKeyDown = event => this.inputSystem.handleKeyDown(event)
    this.onKeyUp = event => this.inputSystem.handleKeyUp(event)
    this.clearHeldInput = () => this.inputSystem.clearHeldInput()
    this.onWindowBlur = this.inputSystem.handleWindowBlur
    this.onWindowFocus = this.inputSystem.handleWindowFocus
    this.onVisibilityChange = this.inputSystem.handleVisibilityChange
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

  get physicsRuntime() { return this.motor.physicsRuntime }
  set physicsRuntime(value) { this.motor.setPhysicsRuntime(value, this.physicsCharacterId) }
  get physicsCharacterId() { return this.motor.physicsCharacterId }
  set physicsCharacterId(value) { this.motor.setPhysicsRuntime(this.physicsRuntime, value) }
  get gravity() { return this.motor.gravity }
  set gravity(value) { this.motor.gravity = Number(value) }
  get verticalVelocity() { return this.motor.verticalVelocity }
  set verticalVelocity(value) { this.motor.verticalVelocity = Number(value) || 0 }
  get grounded() { return this.motor.grounded }
  set grounded(value) { this.motor.grounded = Boolean(value) }
  get jumpActive() { return this.motor.jumpActive }
  set jumpActive(value) { this.motor.jumpActive = Boolean(value) }
  get jumpRequested() { return this.motor.jumpRequested }
  set jumpRequested(value) { this.motor.jumpRequested = Boolean(value) }
  get jumpLaunched() { return this.motor.jumpLaunched }
  set jumpLaunched(value) { this.motor.jumpLaunched = Boolean(value) }
  get jumpWasAirborne() { return this.motor.jumpWasAirborne }
  set jumpWasAirborne(value) { this.motor.jumpWasAirborne = Boolean(value) }
  get jumpBufferDuration() { return this.motor.jumpBufferDuration }
  set jumpBufferDuration(value) { this.motor.jumpBufferDuration = Number(value) }
  get coyoteTimeDuration() { return this.motor.coyoteTimeDuration }
  set coyoteTimeDuration(value) { this.motor.coyoteTimeDuration = Number(value) }
  get jumpBufferRemaining() { return this.motor.jumpBufferRemaining }
  set jumpBufferRemaining(value) { this.motor.jumpBufferRemaining = Number(value) || 0 }
  get coyoteTimeRemaining() { return this.motor.coyoteTimeRemaining }
  set coyoteTimeRemaining(value) { this.motor.coyoteTimeRemaining = Number(value) || 0 }
  get lastPhysicsStepCount() { return this.motor.lastPhysicsStepCount }
  set lastPhysicsStepCount(value) { this.motor.lastPhysicsStepCount = Number(value) || 0 }

  get playerColliderRadius() { return this.traversalProfile.radius }
  set playerColliderRadius(_value) { /* Global character dimensions are immutable in the MVP. */ }

  get playerEyeHeight() { return this.traversalProfile.height }
  set playerEyeHeight(_value) { /* Visual avatar scale must not change physics dimensions. */ }

  get maxWalkableSlopeDegrees() { return this.traversalProfile.maxSlopeClimbAngleDegrees }
  set maxWalkableSlopeDegrees(_value) { /* Traversal limits are global. */ }

  get maxStepHeight() { return this.traversalProfile.maxStepHeight }
  set maxStepHeight(_value) { /* Traversal limits are global. */ }

  get collisionWorld() {
    return this._collisionWorld
  }

  set collisionWorld(world) {
    this._collisionWorld = world
    world?.setRadius?.(this.traversalProfile.radius)
  }

  setPhysicsRuntime(runtime, { id = 'sandbox:player' } = {}) {
    if (this.physicsRuntime && this.physicsCharacterId) {
      this.physicsRuntime.removeBody?.(this.physicsCharacterId)
    }
    this.motor.setPhysicsRuntime(runtime, id)
    if (runtime && this.cameraRig?.player && !this.spawnPosition) {
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
    this.motor.reset()
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
    return this.motor.moveWithPhysics(player, dx, dz, delta, {
      movementEnabled: this.movementEnabled,
      mode: this.mode,
    })
  }

  syncPlayerFromPhysicsState() {
    return this.motor.syncPlayerFromPhysicsState(this.cameraRig?.player)
  }

  tryStartBufferedJump(grounded = this.grounded) {
    return this.motor.tryStartBufferedJump(grounded, { movementEnabled: this.movementEnabled, mode: this.mode })
  }

  updateJumpInputWindow(delta, grounded = this.grounded) {
    return this.motor.updateJumpInputWindow(delta, grounded, { movementEnabled: this.movementEnabled, mode: this.mode })
  }

  jumpPlayer() {
    return this.motor.jumpPlayer({ movementEnabled: this.movementEnabled, mode: this.mode })
  }

  setPlayerDimensions() {
    // Kept as a compatibility API for visual-avatar callers. The MVP player
    // collider and traversal profile are globally fixed and cannot be resized.
    return { eyeHeight: this.playerEyeHeight, colliderRadius: this.playerColliderRadius }
  }

  attach() {
    if (this.attached) return false
    this.attached = true
    this.inputSystem.attach()
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

  hasMovementInput() {
    if (!this.movementEnabled || this.mode === 'overview') return false
    const directionalInput = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
      .some(key => this.keys.has(key))
    return directionalInput || Boolean(this.navigationPath && !this.navigationPathCompleted)
  }

  setVirtualKey(key, pressed) {
    const normalized = normalizeControlKey(key)
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(normalized)) return false
    if (pressed) this.keys.add(normalized)
    else this.keys.delete(normalized)
    this.onMovementInput?.()
    return true
  }

  setMode(mode) {
    this.mode = mode
    this.keys.clear()
    this.jumpBufferRemaining = 0
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
    this.jumpWasAirborne = false
    this.jumpBufferRemaining = 0
    this.coyoteTimeRemaining = this.coyoteTimeDuration
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
    this.jumpWasAirborne = false
    this.jumpBufferRemaining = 0
    this.coyoteTimeRemaining = this.coyoteTimeDuration
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
      this.physicsRuntime.setKinematicCharacterAcceleration?.(this.physicsCharacterId, { x: 0, y: 0, z: 0 })
    }
  }

  setMovementEnabled(enabled) {
    this.movementEnabled = Boolean(enabled)
    if (!this.movementEnabled) {
      this.keys.clear()
      this.jumpActive = false; this.jumpRequested = false; this.jumpLaunched = false
      this.jumpWasAirborne = false
      this.jumpBufferRemaining = 0
      this.coyoteTimeRemaining = this.coyoteTimeDuration
      this.verticalVelocity = 0
      this.stopPhysicsCharacterMovement()
    }
  }

  setFreeCameraMovementEnabled(enabled) {
    this.freeCameraMovementEnabled = Boolean(enabled)
    if (!this.freeCameraMovementEnabled) this.stopPhysicsCharacterMovement()
  }

  getPlayerSupportHit(player, { walking = false, includeSteepSurfaces = false } = {}) {
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
      if (!includeSteepSurfaces && normal.y < maxSlopeCos) continue
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
    this.updateJumpInputWindow(dt, this.grounded)
    const hit = this.getPlayerSupportHit(player, { walking })
    const groundEyeY = hit ? hit.point.y + this.playerEyeHeight : this.playerEyeHeight

    // 只有从上方接近支撑面时才落地；向上运动不会被地面射线吸住。
    if (this.verticalVelocity <= 0 && player.y <= groundEyeY + this.maxStepHeight) {
      if (player.y >= groundEyeY - this.maxStepHeight && player.y <= groundEyeY + 0.08) {
        player.y = groundEyeY
        this.verticalVelocity = 0
        this.grounded = true
        this.jumpActive = false; this.jumpRequested = false; this.jumpLaunched = false
        this.jumpWasAirborne = false
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
      this.jumpActive = false; this.jumpRequested = false; this.jumpLaunched = false
      this.jumpWasAirborne = false
    }
  }

  resolvePlayerGroundHeight(player) {
    const hit = this.getPlayerSupportHit(player, { walking: false })
    if (hit) return hit.point.y + this.playerEyeHeight

    // If the player's feet are already resting on a declared but non-walkable
    // steep surface, do not snap the avatar down to the global ground plane.
    // The surface remains non-walkable; this only preserves the current height.
    const steepSupport = this.getPlayerSupportHit(player, {
      walking: false,
      includeSteepSurfaces: true,
    })
    const feetY = player.y - this.playerEyeHeight
    if (steepSupport && Math.abs(steepSupport.point.y - feetY) <= 0.08) return player.y
    return this.playerEyeHeight
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
    if (!this.attached) return
    this.attached = false
    this.inputSystem.dispose()
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
