/**
 * Sandbox-wide shadow invalidation and quality policy.
 *
 * Static scene changes and moving casters share the renderer's shadow map,
 * but use explicit invalidation paths so static scenes remain cached while
 * dynamic objects refresh their shadows only when they actually move.
 */
export class ShadowSystem {
  constructor(renderer) {
    this.renderer = renderer
    this.staticInvalidations = 0
    this.dynamicInvalidations = 0
    this.disposed = false
  }

  configure({ enabled = true, type } = {}) {
    if (this.disposed || !this.renderer) return
    this.renderer.shadowMap.enabled = Boolean(enabled)
    this.renderer.shadowMap.autoUpdate = false
    if (type !== undefined) this.renderer.shadowMap.type = type
    if (enabled) this.invalidateStatic()
  }

  invalidateStatic() {
    if (this.disposed || !this.renderer?.shadowMap?.enabled) return false
    this.staticInvalidations += 1
    this.renderer.shadowMap.needsUpdate = true
    return true
  }

  invalidateDynamic() {
    if (this.disposed || !this.renderer?.shadowMap?.enabled) return false
    this.dynamicInvalidations += 1
    this.renderer.shadowMap.needsUpdate = true
    return true
  }

  getDiagnostics() {
    return {
      enabled: Boolean(this.renderer?.shadowMap?.enabled),
      autoUpdate: Boolean(this.renderer?.shadowMap?.autoUpdate),
      staticInvalidations: this.staticInvalidations,
      dynamicInvalidations: this.dynamicInvalidations,
    }
  }

  dispose() {
    this.disposed = true
    this.renderer = null
  }
}
