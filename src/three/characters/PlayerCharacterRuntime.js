/**
 * Player visual assets are mounted under a stable character anchor.
 * The anchor remains owned by CameraRig/InputController; this runtime only
 * manages the rendered model and its animation state.
 */
export class PlayerCharacterRuntime {
  constructor(THREE, anchor) {
    if (!THREE || !anchor?.isObject3D) throw new TypeError('角色运行时需要 THREE 和有效的角色根节点')
    this.THREE = THREE
    this.anchor = anchor
    this.fallbackUpdater = anchor.userData?.updateAnimation || null
    this.fallbackVisual = new THREE.Group()
    this.fallbackVisual.name = 'player-character-fallback'
    const preserved = []
    for (const child of [...anchor.children]) {
      if (child.name === 'avatar-ground-marker' || child.name === 'player-contact-shadow') preserved.push(child)
      else this.fallbackVisual.add(child)
    }
    anchor.add(this.fallbackVisual)
    this.activeVisual = this.fallbackVisual
    this.mixer = null
    this.actions = new Map()
    this.activeAction = null
    this.assetId = 'builtin-placeholder'
    this.animationState = 'idle'
    this.animationOverride = null
    this.disposed = false
    anchor.userData.updateAnimation = (moving, seconds, dx, dz, running) => this.updateAnimation(moving, seconds, dx, dz, running)
  }

  setModel(model, animations = [], metadata = {}) {
    if (this.disposed) throw new Error('角色运行时已释放')
    if (!model?.isObject3D || model === this.anchor || model.parent) {
      throw new TypeError('角色模型必须是未挂载的 THREE.Object3D')
    }
    model.updateMatrixWorld(true)
    const bounds = new this.THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new this.THREE.Vector3())
    if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0.001) {
      throw new TypeError('角色模型缺少有效的三维尺寸')
    }

    const targetHeight = Math.max(0.5, Math.min(5, Number(metadata.targetHeight) || 2.25))
    const scale = targetHeight / size.y
    const wrapper = new this.THREE.Group()
    wrapper.name = 'player-character-asset'
    wrapper.userData.assetId = String(metadata.assetId || metadata.sourceUrl || 'external-glb')
    wrapper.scale.setScalar(scale)
    wrapper.position.set(
      -((bounds.min.x + bounds.max.x) / 2) * scale,
      -bounds.min.y * scale,
      -((bounds.min.z + bounds.max.z) / 2) * scale,
    )
    // 外部角色模型遵循世界统一的真实投影/接收规则，不继承来源文件中可能关闭的阴影标记。
    model.traverse(object => {
      if (!object.isMesh) return
      object.castShadow = true
      object.receiveShadow = true
    })
    wrapper.add(model)
    wrapper.updateMatrixWorld(true)

    this.clearMixer()
    if (this.activeVisual !== this.fallbackVisual) {
      this.anchor.remove(this.activeVisual)
      this.disposeObject(this.activeVisual)
    } else {
      this.fallbackVisual.visible = false
    }
    this.activeVisual = wrapper
    this.anchor.add(wrapper)
    this.assetId = wrapper.userData.assetId
    this.actions.clear()
    this.mixer = Array.isArray(animations) && animations.length
      ? new this.THREE.AnimationMixer(model)
      : null
    for (const clip of animations || []) {
      if (!clip?.name || !this.mixer) continue
      const key = clip.name.toLowerCase()
      if (/idle|stand|wait/.test(key)) this.actions.set('idle', this.mixer.clipAction(clip))
      else if (/walk|move/.test(key)) this.actions.set('walk', this.mixer.clipAction(clip))
      else if (/run|sprint/.test(key)) this.actions.set('run', this.mixer.clipAction(clip))
    }
    if (this.mixer && Array.isArray(animations) && animations.length && !this.actions.has('idle')) {
      const firstClip = (animations || []).find(clip => clip?.name)
      if (firstClip) this.actions.set('idle', this.mixer.clipAction(firstClip))
    }
    this.animationState = 'idle'
    this.animationOverride = null
    this.playState('idle')
    return this.getInfo()
  }

  playState(state) {
    const next = this.actions.get(state) || (state === 'run' ? this.actions.get('walk') : null)
      || (state !== 'idle' ? this.actions.get('idle') : null)
      || this.actions.values().next().value
    if (!next || next === this.activeAction) return Boolean(next)
    next.reset().fadeIn(0.16).play()
    this.activeAction?.fadeOut(0.16)
    this.activeAction = next
    return true
  }

  setAnimationState(state) {
    if (state === null || state === 'auto') {
      this.animationOverride = null
      return true
    }
    const normalized = ['idle', 'walk', 'run'].includes(String(state)) ? String(state) : null
    if (!normalized) return false
    this.animationOverride = normalized
    this.animationState = normalized
    if (this.activeVisual !== this.fallbackVisual) this.playState(normalized)
    return true
  }

  updateAnimation(moving, seconds, dx = 0, dz = 0, running = false) {
    if (this.disposed) return
    if (Math.hypot(dx, dz) > 0.0005) this.anchor.rotation.y = Math.atan2(dx, dz)
    if (this.activeVisual === this.fallbackVisual) {
      this.fallbackUpdater?.call(this.anchor, Boolean(moving), seconds, dx, dz)
      return
    }
    const state = this.animationOverride || (moving ? (running ? 'run' : 'walk') : 'idle')
    if (state !== this.animationState || !this.activeAction) this.animationState = state
    this.playState(state)
  }

  update(deltaSeconds) {
    this.mixer?.update(Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.1)))
  }

  getInfo() {
    return {
      assetId: this.assetId,
      hasExternalModel: this.activeVisual !== this.fallbackVisual,
      animations: [...this.actions.keys()],
      animationState: this.animationState,
    }
  }

  clearMixer() {
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer.uncacheRoot(this.mixer.getRoot())
    }
    this.mixer = null
    this.activeAction = null
    this.actions.clear()
  }

  disposeObject(root) {
    root?.traverse?.(object => {
      object.geometry?.dispose?.()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (!material) continue
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.dispose()
        }
        material.dispose?.()
      }
    })
  }

  restoreFallback() {
    if (this.disposed) return false
    this.clearMixer()
    if (this.activeVisual !== this.fallbackVisual) {
      this.anchor.remove(this.activeVisual)
      this.disposeObject(this.activeVisual)
      this.activeVisual = this.fallbackVisual
      this.fallbackVisual.visible = true
    }
    this.assetId = 'builtin-placeholder'
    this.animationState = 'idle'
    this.animationOverride = null
    return true
  }

  dispose() {
    if (this.disposed) return
    this.clearMixer()
    if (this.activeVisual !== this.fallbackVisual) {
      this.anchor.remove(this.activeVisual)
      this.disposeObject(this.activeVisual)
    }
    this.disposed = true
  }
}
