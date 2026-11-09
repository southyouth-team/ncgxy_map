/**
 * Build grounded movement obstacles from a model's data-only spatial manifest.
 * Coordinates are expressed in the target part's local space and transformed
 * into world-space AABBs. CollisionWorld currently resolves movement on XZ.
 */
import { resolveCapabilityRecords } from '../sandbox/capabilityControl.js'
import { analyzeModelTraversability } from '../sandbox/modelTraversabilityAnalyzer.js'

export function collectModelMovementObstacles(THREE, root, ownerId, { includeAllHeights = false } = {}) {
  if (!THREE?.Box3 || !root?.traverse || !ownerId) return []
  const manifest = root.userData?.proceduralModelCapabilityManifest
  const colliders = manifest?.capabilities?.spatial?.colliders
  if (!Array.isArray(colliders) || !colliders.length) return []

  root.updateWorldMatrix(true, true)
  const parts = new Map()
  root.traverse(object => {
    const id = object.userData?.componentId
    if (id != null) parts.set(String(id), object)
  })

  const control = root.userData?.proceduralModelCapabilityControlDocument || {}
  const definitions = colliders.filter(collider => collider && typeof collider.targetPartId === 'string').map(collider => ({
    capabilityId: 'spatial.collider.' + String(collider.id || collider.targetPartId) + '.blocksMovement',
    scope: { targetType: 'part', targetId: collider.targetPartId },
    value: { blocksMovement: collider.blocksMovement !== false },
  }))
  const resolved = resolveCapabilityRecords({
    definitions,
    proposals: control.inference?.proposals || [],
    overrides: control.overrides || [],
  })
  const resolvedByKey = new Map(resolved.map(record => [
    record.capabilityId + ':' + String(record.scope?.targetId || '*'),
    record,
  ]))
  const obstacles = []
  for (const collider of colliders) {
    if (!collider || collider.enabled === false) continue
    if (collider.shape !== 'box' || typeof collider.targetPartId !== 'string') continue
    const capabilityId = 'spatial.collider.' + String(collider.id || collider.targetPartId) + '.blocksMovement'
    const capability = resolvedByKey.get(capabilityId + ':' + collider.targetPartId)
    const hasUserOverride = capability?.source === 'user-override'
    let blocksMovement = capability?.value?.blocksMovement ?? collider.blocksMovement !== false

    // A state-conditioned collider is used for movable parts such as a hinged
    // door leaf. The model instance state is authoritative; absent state uses
    // the declared defaultValue. Explicit user capability overrides take priority.
    // Model parameters may bind to a capability property without coupling the
    // parameter UI to a particular model category. Explicit capability overrides
    // remain authoritative; otherwise a bound parameter controls this collider.
    const parameterDefinitions = Array.isArray(manifest.parameters)
      ? manifest.parameters
      : (Array.isArray(root.userData?.proceduralModelParameters) ? root.userData.proceduralModelParameters : [])
    const parameterValues = root.userData?.proceduralModelParameterValues || {}
    let hasParameterBinding = false
    for (const parameter of (hasUserOverride ? [] : parameterDefinitions)) {
      if (!parameter || typeof parameter.id !== 'string' || !Array.isArray(parameter.bindings)) continue
      const binding = parameter.bindings.find(item =>
        item && item.capabilityId === capabilityId && item.property === 'blocksMovement')
      if (!binding) continue
      const value = Object.prototype.hasOwnProperty.call(parameterValues, parameter.id)
        ? parameterValues[parameter.id]
        : parameter.default
      if (typeof value === 'boolean') {
        blocksMovement = value
        hasParameterBinding = true
      }
      break
    }

    const condition = collider.stateCondition
    if (!hasUserOverride && !hasParameterBinding && condition && typeof condition.key === 'string') {
      const worldState = root.userData?.worldState || {}
      const stateValue = Object.prototype.hasOwnProperty.call(worldState, condition.key)
        ? worldState[condition.key]
        : condition.defaultValue
      blocksMovement = blocksMovement && stateValue === condition.equals
    }

    if (capability?.enabled === false || !blocksMovement) continue
    const part = parts.get(collider.targetPartId)
    if (!part) continue
    const center = collider.center || {}
    const size = collider.size || {}
    const values = [center.x ?? 0, center.y ?? 0, center.z ?? 0, size.x, size.y, size.z].map(Number)
    if (!values.every(Number.isFinite) || values.slice(3).some(value => value <= 0)) continue
    const localBounds = new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(values[0], values[1], values[2]),
      new THREE.Vector3(values[3], values[4], values[5]),
    )
    const worldBounds = localBounds.applyMatrix4(part.matrixWorld)
    // The current player controller is a grounded XZ mover. Ignore elevated
    // colliders that do not intersect the player's standing-height interval.
    if (!includeAllHeights && (worldBounds.min.y > 1.7 || worldBounds.max.y < 0)) continue
    obstacles.push({
      ownerId: String(ownerId),
      colliderId: String(collider.id || collider.targetPartId),
      targetPartId: collider.targetPartId,
      minY: worldBounds.min.y,
      maxY: worldBounds.max.y,
      minX: worldBounds.min.x,
      maxX: worldBounds.max.x,
      minZ: worldBounds.min.z,
      maxZ: worldBounds.max.z,
    })
  }
  return obstacles
}


/**
 * Collects declared standing/traversal surfaces from real model geometry.
 * Returned mesh references are transient Runtime handles, never manifest data.
 */
export function collectModelSupportSurfaces(root, ownerId) {
  if (!root?.traverse || !ownerId) return []
  const declarations = root.userData?.proceduralModelCapabilityManifest?.capabilities?.spatial?.surfaces
  if (!Array.isArray(declarations) || !declarations.length) return []

  root.updateWorldMatrix(true, true)
  const parts = new Map()
  root.traverse(object => {
    const id = object.userData?.componentId
    if (id != null) parts.set(String(id), object)
  })

  const result = []
  for (const declaration of declarations) {
    if (!declaration || declaration.enabled === false || declaration.shape !== 'mesh'
      || typeof declaration.targetPartId !== 'string') continue
    if (declaration.supportsStanding !== true && declaration.walkable !== true) continue
    const target = parts.get(declaration.targetPartId)
    if (!target?.traverse) continue
    const meshes = []
    target.traverse(object => {
      const position = object.geometry?.getAttribute?.('position')
      if (object.isMesh && position && position.count >= 3) meshes.push(object)
    })
    if (!meshes.length) continue
    result.push({
      ownerId: String(ownerId),
      surfaceId: String(declaration.id || declaration.targetPartId),
      targetPartId: declaration.targetPartId,
      supportsStanding: declaration.supportsStanding === true,
      walkable: declaration.walkable === true,
      meshes,
    })
  }
  return result
}


/**
 * Compile explicitly declared static Mesh blockers into world-space Rapier
 * triangle buffers. This is opt-in: visible render meshes never become
 * colliders unless their component has a spatial collider declaration.
 *
 * Mesh geometry is preserved as authored (including real openings); callers
 * should provide collision-ready geometry rather than decorative render detail.
 */
export function collectModelDeclaredMeshColliders(THREE, model, ownerId) {
  if (!THREE?.Vector3 || !model?.traverse || !ownerId) return []
  model.updateWorldMatrix(true, true)
  const colliders = model.userData?.proceduralModelCapabilityManifest
    ?.capabilities?.spatial?.colliders
  if (!Array.isArray(colliders) || !colliders.length) return []

  const parts = new Map()
  const duplicates = new Set()
  model.traverse(object => {
    const id = object.userData?.componentId
    if (typeof id !== 'string' || !id.trim()) return
    if (parts.has(id)) duplicates.add(id)
    else parts.set(id, object)
  })

  const output = []
  const seenTargets = new Set()
  for (const declaration of colliders) {
    if (!declaration || declaration.enabled === false || declaration.shape !== 'mesh'
      || declaration.blocksMovement === false
      || typeof declaration.targetPartId !== 'string') continue
    const condition = declaration.stateCondition
    if (condition && typeof condition.key === 'string') {
      const worldState = model.userData?.worldState || {}
      const stateValue = Object.prototype.hasOwnProperty.call(worldState, condition.key)
        ? worldState[condition.key]
        : condition.defaultValue
      if (stateValue !== condition.equals) continue
    }
    const targetPartId = declaration.targetPartId
    if (duplicates.has(targetPartId) || seenTargets.has(targetPartId)) continue
    const target = parts.get(targetPartId)
    if (!target?.traverse) continue

    const vertices = []
    const indices = []
    target.traverse(mesh => {
      if (!mesh.isMesh || mesh.visible === false
        || mesh.userData?.physicsCollision === false
        || mesh.userData?.collisionMode === 'none') return
      const meshComponentId = mesh.userData?.componentId
      if (mesh !== target && typeof meshComponentId === 'string'
        && meshComponentId !== targetPartId) return
      let ancestor = mesh.parent
      while (ancestor && ancestor !== target) {
        const ancestorComponentId = ancestor.userData?.componentId
        if (typeof ancestorComponentId === 'string' && ancestorComponentId !== targetPartId) return
        ancestor = ancestor.parent
      }
      const position = mesh.geometry?.getAttribute?.('position')
      if (!position || position.itemSize < 3 || position.count < 3) return
      const index = mesh.geometry.index
      const availableCount = index ? index.count : position.count
      const start = Math.max(0, Number(mesh.geometry.drawRange?.start) || 0)
      const requestedCount = Number(mesh.geometry.drawRange?.count)
      const end = Math.min(
        availableCount,
        Number.isFinite(requestedCount) ? start + requestedCount : availableCount,
      )
      const vertexOffset = vertices.length / 3
      const point = new THREE.Vector3()
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
        point.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld)
        vertices.push(point.x, point.y, point.z)
      }
      const readIndex = i => index ? index.getX(i) : i
      for (let i = start; i + 2 < end; i += 3) {
        indices.push(
          vertexOffset + readIndex(i),
          vertexOffset + readIndex(i + 1),
          vertexOffset + readIndex(i + 2),
        )
      }
    })
    if (vertices.length < 9 || indices.length < 3) continue
    seenTargets.add(targetPartId)
    output.push({
      ownerId: String(ownerId),
      colliderId: String(declaration.id || targetPartId),
      surfaceId: String(declaration.id || targetPartId),
      targetPartId,
      vertices: new Float32Array(vertices),
      indices: new Uint32Array(indices),
    })
  }
  return output
}


/**
 * Compile validated stair/ramp Mesh geometry into world-space triangle buffers.
 * These are static collision shapes; they do not by themselves certify that a
 * character can traverse the complete route.
 */
export function collectModelTraversalTrimeshes(THREE, model, ownerId) {
  if (!THREE?.Vector3 || !model?.traverse || !ownerId) return []
  model.updateWorldMatrix(true, true)
  const manifest = model.userData?.proceduralModelCapabilityManifest
  const declarations = manifest?.capabilities?.spatial?.traversability || {}
  const analysis = analyzeModelTraversability(THREE, model)
  model.userData.proceduralModelTraversabilityAnalysis = analysis
  const parts = new Map()
  model.traverse(object => {
    const id = object.userData?.componentId
    if (typeof id === 'string' && !parts.has(id)) parts.set(id, object)
  })
  const output = []
  const seenParts = new Set()
  for (const record of analysis.records || []) {
    if (!record.bound || record.status !== 'geometry-bound'
      || !['stairs', 'ramps'].includes(record.type)
      || seenParts.has(record.targetPartId)) continue
    seenParts.add(record.targetPartId)
    const target = parts.get(record.targetPartId)
    if (!target?.traverse) continue
    const vertices = []
    const indices = []
    target.traverse(mesh => {
      if (!mesh.isMesh || mesh.visible === false) return
      const position = mesh.geometry?.getAttribute?.('position')
      if (!position || position.itemSize < 3 || position.count < 3) return
      const index = mesh.geometry.index
      const availableCount = index ? index.count : position.count
      const start = Math.max(0, Number(mesh.geometry.drawRange?.start) || 0)
      const requestedCount = Number(mesh.geometry.drawRange?.count)
      const end = Math.min(availableCount, Number.isFinite(requestedCount) ? start + requestedCount : availableCount)
      const vertexOffset = vertices.length / 3
      const point = new THREE.Vector3()
      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
        point.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld)
        vertices.push(point.x, point.y, point.z)
      }
      for (let cursor = start; cursor + 2 < end; cursor += 3) {
        const readIndex = index ? item => index.getX(item) : item => item
        const a = readIndex(cursor)
        const b = readIndex(cursor + 1)
        const c = readIndex(cursor + 2)
        if ([a, b, c].every(value => Number.isInteger(value) && value >= 0 && value < position.count)) {
          indices.push(vertexOffset + a, vertexOffset + b, vertexOffset + c)
        }
      }
    })
    if (vertices.length < 9 || indices.length < 3) continue
    output.push({
      ownerId: String(ownerId),
      surfaceId: String(record.id || record.targetPartId),
      targetPartId: record.targetPartId,
      type: record.type,
      vertices: new Float32Array(vertices),
      indices: new Uint32Array(indices),
    })
  }
  return output
}


/**
 * Replace an instance's live collision/support registrations from its current
 * manifest and Object3D hierarchy. The registry is rebuilt from the same model
 * that the renderer currently owns, so removed declarations cannot leave stale
 * obstacle or Mesh handles behind.
 */
export function refreshModelSpatialRegistration(THREE, model, collisionWorld) {
  const ownerId = model?.userData?.sandboxModelId
  if (!ownerId || !collisionWorld) return 0
  model.updateWorldMatrix?.(true, true)
  collisionWorld.removeObstaclesByOwner?.(String(ownerId))
  collisionWorld.removeSupportSurfacesByOwner?.(String(ownerId))
  const obstacles = collectModelMovementObstacles(THREE, model, ownerId)
  const surfaces = collectModelSupportSurfaces(model, ownerId)
  let added = 0
  for (const obstacle of obstacles) {
    if (collisionWorld.addObstacle(obstacle, ownerId)) added += 1
  }
  for (const surface of surfaces) collisionWorld.addSupportSurface(surface)
  return added
}


/**
 * Rebuild a model instance's Rapier colliders from the currently executable
 * spatial declarations: state-aware Box blockers plus geometry-bound stair/ramp
 * static triangle meshes. This is not yet a general Mesh-to-collider compiler.
 * Box blockers currently use conservative world-space AABBs; oriented/compound
 * collider fidelity and general static-mesh cooking remain later milestones.
 */
export function refreshModelPhysicsRegistration(THREE, model, physicsRuntime) {
  const ownerId = model?.userData?.sandboxModelId
  if (!ownerId || !physicsRuntime) return 0
  const key = String(ownerId)
  physicsRuntime.removeOwner(key)
  const traversalMeshes = collectModelTraversalTrimeshes(THREE, model, key)
  const declaredMeshColliders = collectModelDeclaredMeshColliders(THREE, model, key)
  const trimeshPartIds = new Set([
    ...traversalMeshes.map(item => item.targetPartId),
    ...declaredMeshColliders.map(item => item.targetPartId),
  ])
  const boxes = collectModelMovementObstacles(THREE, model, key, { includeAllHeights: true })
    .filter(box => !trimeshPartIds.has(box.targetPartId))
  let added = 0
  try {
    [...traversalMeshes, ...declaredMeshColliders].forEach(item => {
      physicsRuntime.createStaticTrimesh({
        id: key + ':manifest-trimesh:' + (item.surfaceId || item.colliderId),
        ownerId: key,
        vertices: item.vertices,
        indices: item.indices,
        friction: 0.85,
      })
      added += 1
    })
    boxes.forEach((box, index) => {
      const halfExtents = {
        x: (box.maxX - box.minX) / 2,
        y: (box.maxY - box.minY) / 2,
        z: (box.maxZ - box.minZ) / 2,
      }
      if (![halfExtents.x, halfExtents.y, halfExtents.z].every(value => Number.isFinite(value) && value > 0.001)) return
      physicsRuntime.createStaticBox({
        id: key + ':manifest-box:' + box.colliderId + ':' + index,
        ownerId: key,
        translation: {
          x: (box.minX + box.maxX) / 2,
          y: (box.minY + box.maxY) / 2,
          z: (box.minZ + box.maxZ) / 2,
        },
        halfExtents,
        friction: 0.85,
      })
      added += 1
    })
  } catch (error) {
    physicsRuntime.removeOwner(key)
    throw error
  }
  return added
}
