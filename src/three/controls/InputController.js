import { CollisionWorld } from '../physics/CollisionWorld.js'

export class InputController {
  constructor(THREE, domElement, cameraRig, bounds, collisionWorld = null) {
    this.THREE = THREE
    this.domElement = domElement
    this.cameraRig = cameraRig
    this.bounds = bounds || { minX: -75, maxX: 75, minZ: -75, maxZ: 75 }
    this.collisionWorld = collisionWorld || new CollisionWorld(this.bounds)
    this.mode = 'overview'
    this.keys = new Set()
    this.pointerDown = false
    this.lastPointer = { x: 0, y: 0 }
    this.pointerLocked = false
    this.touchLookPointerId = null
    this.lastTouchLook = { x: 0, y: 0 }
    this.onKeyDown = (event) => {
      const key = event.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
        this.keys.add(key)
        if (this.mode !== 'firstPerson') event.preventDefault()
      }
    }
    this.onKeyUp = (event) => this.keys.delete(event.key.toLowerCase())
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
    this.pointerDown = false
    if (mode !== 'firstPerson') this.exitPointerLock()
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.domElement) document.exitPointerLock?.()
  }

  resetPosition() {
    this.keys.clear()
    this.cameraRig.player.set(0, 1.7, 24)
  }

  update(delta) {
    if (this.mode === 'overview') return
    const forward = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0)
    const strafe = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0)
    if (!forward && !strafe) return
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
    player.x = movement.x
    player.z = movement.z
    if (this.mode === 'thirdPerson') this.cameraRig.updateThirdPersonDesired()
    else this.cameraRig.updateFirstPersonDesired()
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
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
