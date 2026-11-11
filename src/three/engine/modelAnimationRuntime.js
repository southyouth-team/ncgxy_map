import * as THREE from 'three'

const MAX_SOURCE_LENGTH = 120000
const MAX_DELTA_SECONDS = 0.05

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function normalizeWindDirection(value, fallback = null) {
  const fallbackX = Number(fallback?.x)
  const fallbackZ = Number(fallback?.z)
  const fallbackLength = Math.hypot(fallbackX, fallbackZ)
  const fallbackDirection = Number.isFinite(fallbackLength) && fallbackLength >= 1e-6
    ? { x: fallbackX / fallbackLength, z: fallbackZ / fallbackLength }
    : { x: 1, z: 0 }
  const x = Number(value?.x)
  const z = Number(value?.z)
  const length = Math.hypot(x, z)
  if (!Number.isFinite(length) || length < 1e-6) return fallbackDirection
  return { x: x / length, z: z / length }
}

/**
 * Normalize the sandbox's existing environment config into the stable data
 * contract consumed by generated animation controllers. Also accepts an
 * already normalized snapshot, which keeps editor/main-scene wiring identical.
 */
export function createSandboxEnvironmentSnapshot(config = {}, fallbackConfig = {}) {
  const source = config && typeof config === 'object' ? config : {}
  const fallback = fallbackConfig && typeof fallbackConfig === 'object' ? fallbackConfig : {}
  const rawHour = typeof source.time === 'object' ? source.time?.hour : source.time
  const hour = clamp(finiteNumber(rawHour, 14), 0, 24)
  const requestedPeriod = (typeof source.time === 'object' ? source.time?.period : null) ?? source.timeOfDay
  const period = ['day', 'night'].includes(requestedPeriod)
    ? requestedPeriod
    : (hour < 6 || hour >= 18 ? 'night' : 'day')

  const rawWeather = typeof source.weather === 'object' ? source.weather?.type : source.weather
  const weather = rawWeather === 'rain' ? 'rain' : 'clear'
  const rawRainIntensity = typeof source.weather === 'object' ? source.weather?.rainIntensity : undefined
  const rainIntensity = rawRainIntensity === undefined
    ? (weather === 'rain' ? 1 : 0)
    : clamp(finiteNumber(rawRainIntensity, weather === 'rain' ? 1 : 0), 0, 1)

  const rawWind = typeof source.wind === 'object' ? source.wind?.speed : source.wind
  const speed = clamp(finiteNumber(rawWind, 0), 0, 1)
  const fallbackDirection = fallback.windDirection
    ?? (typeof fallback.wind === 'object' ? fallback.wind?.direction : null)
  const rawDirection = source.windDirection
    ?? (typeof source.wind === 'object' ? source.wind?.direction : null)
    ?? fallbackDirection
  const direction = normalizeWindDirection(rawDirection, fallbackDirection)
  const artificialEnabled = source.lighting?.artificialEnabled
    ?? source.artificialLightingEnabled
    ?? true

  return Object.freeze({
    time: Object.freeze({ hour, period }),
    weather: Object.freeze({ type: weather, rainIntensity }),
    wind: Object.freeze({ speed, direction: Object.freeze(direction) }),
    lighting: Object.freeze({ artificialEnabled: Boolean(artificialEnabled) }),
  })
}

function isEnvironmentSnapshot(value) {
  return value && typeof value === 'object'
    && Number.isFinite(value.time?.hour)
    && Number.isFinite(value.wind?.speed)
    && typeof value.weather?.type === 'string'
    && typeof value.lighting?.artificialEnabled === 'boolean'
}

function resolveEnvironment(value, fallback) {
  if (value === undefined) return fallback
  return isEnvironmentSnapshot(value) ? value : createSandboxEnvironmentSnapshot(value, fallback)
}

/** Clone JSON-like model state and freeze every level against generated writes. */
function frozenDataCopy(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return null
  const result = Array.isArray(value) ? [] : {}
  seen.set(value, result)
  for (const key of Object.keys(value)) {
    const item = value[key]
    if (typeof item === 'function' || typeof item === 'symbol' || item === undefined) continue
    result[key] = frozenDataCopy(item, seen)
  }
  return Object.freeze(result)
}

function createControllerContext(entry, environment) {
  return {
    modelId: entry.id,
    parameters: frozenDataCopy(entry.model.userData?.proceduralModelParameterValues || {}),
    worldState: frozenDataCopy(entry.model.userData?.worldState || {}),
    environment,
  }
}

function encodeDataModule(source) {
  return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source)
}

async function importAnimationModule(source) {
  if (typeof source !== 'string' || !source.trim()) return null
  if (source.length > MAX_SOURCE_LENGTH) throw new RangeError('Three.js 动画源码超过 120 KB')

  const canUseBlobUrl = typeof window !== 'undefined'
    && typeof Blob !== 'undefined'
    && typeof URL?.createObjectURL === 'function'
  let objectUrl = null
  try {
    const moduleUrl = canUseBlobUrl
      ? (objectUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })))
      : encodeDataModule(source)
    return await import(/* @vite-ignore */ moduleUrl)
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

const PERSISTED_HOST_STATE_KEYS = [
  'worldState',
  'environmentOverrides',
  'proceduralModelCapabilityControlDocument',
  'proceduralModelParameterValues',
  'proceduralModelConfig',
  'proceduralModelVisualQuality',
  'interactionRadius',
]

function cloneSerializedData(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function captureStaticModel(model) {
  model.updateWorldMatrix(true, true)
  return cloneSerializedData(model.toJSON())
}

function collectDeclaredTargets(model) {
  const targets = new Map()
  model.traverse(object => {
    const id = object.userData?.componentId
    if (typeof id !== 'string' || !id.trim()) return
    const list = targets.get(id) || []
    list.push(object)
    targets.set(id, list)
  })
  return targets
}

function isSameOrAncestor(ancestor, object) {
  let node = object
  while (node) {
    if (node === ancestor) return true
    node = node.parent
  }
  return false
}

function assertVisualOnlyAnimationTargets(model) {
  const capabilities = model.userData?.proceduralModelCapabilityManifest?.capabilities || {}
  const animations = Array.isArray(capabilities.visual?.animations) ? capabilities.visual.animations : []
  if (!animations.length) return
  const spatial = capabilities.spatial || {}
  const physicsRecords = [
    ...(Array.isArray(spatial.colliders) ? spatial.colliders : [])
      .filter(item => item?.enabled !== false && item?.blocksMovement !== false)
      .map(item => ({ ...item, kind: '碰撞体' })),
    ...(Array.isArray(spatial.surfaces) ? spatial.surfaces : [])
      .filter(item => item?.enabled !== false && (item?.walkable === true || item?.supportsStanding === true))
      .map(item => ({ ...item, kind: '站立面' })),
    ...['stairs', 'ramps'].flatMap(key => (Array.isArray(spatial.traversability?.[key])
      ? spatial.traversability[key]
      : [])
      .filter(item => item?.enabled !== false)
      .map(item => ({ ...item, kind: '通行碰撞' }))),
  ]
  if (!physicsRecords.length) return
  const targets = collectDeclaredTargets(model)

  for (const animation of animations) {
    if (typeof animation?.targetPartId !== 'string') continue
    for (const physics of physicsRecords) {
      if (typeof physics?.targetPartId !== 'string') continue
      for (const animatedTarget of targets.get(animation.targetPartId) || []) {
        for (const physicsTarget of targets.get(physics.targetPartId) || []) {
          if (isSameOrAncestor(animatedTarget, physicsTarget) || isSameOrAncestor(physicsTarget, animatedTarget)) {
            throw new Error(
              `动画目标 ${animation.targetPartId} 与静态物理目标 ${physics.targetPartId}（${physics.kind}）重叠；`
              + '请只动画独立视觉部件，或移除该静态物理声明',
            )
          }
        }
      }
    }
  }
}

async function createControllerFromSource(entry, environment) {
  assertVisualOnlyAnimationTargets(entry.model)
  const source = entry.model.userData?.proceduralModelSource
  const modelModule = await importAnimationModule(source)
  if (typeof modelModule?.createModelAnimation !== 'function') return null
  const controller = await modelModule.createModelAnimation(
    THREE,
    entry.model,
    createControllerContext(entry, environment),
  )
  if (controller == null) return null
  if (typeof controller.update !== 'function') {
    throw new TypeError('createModelAnimation() 必须返回包含 update(frame) 的控制器或 null')
  }
  return controller
}

/**
 * Own generated controllers, never their effect categories. Each entry rebuilds
 * behavior from persisted source after ObjectLoader restoration; the host owns
 * clock, environment distribution, failure isolation and disposal.
 */
export function createModelAnimationRuntime({ onError, onActiveChange } = {}) {
  const entries = new Map()
  let disposed = false
  let active = false
  let currentEnvironment = createSandboxEnvironmentSnapshot()

  function report(error, modelId, phase) {
    try { onError?.(error instanceof Error ? error : new Error(String(error)), { modelId, phase }) } catch { /* observers cannot break the scene */ }
  }

  function syncActive() {
    const next = Array.from(entries.values()).some(entry => entry.controller && !entry.failed)
    if (next === active) return
    active = next
    try { onActiveChange?.(active) } catch (error) { report(error, null, 'active-change') }
  }

  function disposeController(controller, modelId) {
    if (!controller) return
    try { controller.dispose?.() } catch (error) { report(error, modelId, 'dispose') }
  }

  function failController(entry, error, phase) {
    if (entry.failed) return
    entry.failed = true
    const controller = entry.controller
    entry.controller = null
    report(error, entry.id, phase)
    disposeController(controller, entry.id)
    syncActive()
  }

  function remove(id) {
    const key = String(id)
    const entry = entries.get(key)
    if (!entry) return false
    entries.delete(key)
    entry.removed = true
    const controller = entry.controller
    entry.controller = null
    disposeController(controller, key)
    syncActive()
    return true
  }

  function register(id, model, environment) {
    const key = String(id)
    remove(key)
    if (disposed || !model?.isObject3D) return Promise.resolve(null)
    const source = model.userData?.proceduralModelSource
    if (typeof source !== 'string' || !source.trim()) return Promise.resolve(null)

    const initialEnvironment = resolveEnvironment(environment, currentEnvironment)
    const entry = { id: key, model, controller: null, failed: false, removed: false, staticSnapshot: null }
    entries.set(key, entry)
    try {
      // Capture before generated code can deform existing nodes or add particles.
      entry.staticSnapshot = captureStaticModel(model)
    } catch (error) {
      report(error, key, 'snapshot')
    }

    const pending = (async () => {
      let controller = null
      try {
        controller = await createControllerFromSource(entry, initialEnvironment)
        if (disposed || entry.removed || entries.get(key) !== entry) {
          disposeController(controller, key)
          return null
        }
        entry.controller = controller
        syncActive()
        return controller
      } catch (error) {
        entry.failed = true
        entry.controller = null
        disposeController(controller, key)
        report(error, key, 'create')
        syncActive()
        return null
      }
    })()
    entry.pending = pending
    return pending
  }

  function update(time, deltaTime, environment) {
    if (disposed) return
    currentEnvironment = resolveEnvironment(environment, currentEnvironment)
    const seconds = Math.max(0, finiteNumber(time, 0))
    const delta = clamp(finiteNumber(deltaTime, 0), 0, MAX_DELTA_SECONDS)
    for (const entry of Array.from(entries.values())) {
      if (!entry.controller || entry.failed || entries.get(entry.id) !== entry) continue
      try {
        const outcome = entry.controller.update({
          time: seconds,
          deltaTime: delta,
          ...createControllerContext(entry, currentEnvironment),
        })
        // The contract requires a synchronous update, but generated code that
        // returns a rejected promise must still be isolated instead of leaking
        // an unhandled rejection that the host loop cannot catch.
        if (outcome && typeof outcome.then === 'function') {
          Promise.resolve(outcome).catch(error => {
            if (disposed || entry.removed || entry.failed || entries.get(entry.id) !== entry) return
            failController(entry, error, 'update')
          })
        }
      } catch (error) {
        failController(entry, error, 'update')
      }
    }
  }

  function serializeModel(id) {
    const entry = entries.get(String(id))
    if (!entry?.staticSnapshot) return null
    const serialized = cloneSerializedData(entry.staticSnapshot)
    entry.model.updateMatrix()
    serialized.object.matrix = entry.model.matrix.toArray()
    serialized.object.name = entry.model.name
    const userData = { ...(serialized.object.userData || {}) }
    for (const key of PERSISTED_HOST_STATE_KEYS) {
      const value = entry.model.userData?.[key]
      if (value === undefined) delete userData[key]
      else userData[key] = cloneSerializedData(value)
    }
    serialized.object.userData = userData
    return serialized
  }

  function dispose() {
    if (disposed) return
    disposed = true
    const current = Array.from(entries.values())
    entries.clear()
    for (const entry of current) {
      entry.removed = true
      const controller = entry.controller
      entry.controller = null
      disposeController(controller, entry.id)
    }
    syncActive()
  }

  return {
    register,
    update,
    remove,
    serializeModel,
    dispose,
    hasActiveAnimations: () => active,
  }
}
