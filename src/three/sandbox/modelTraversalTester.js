import { PhysicsRuntime } from '../physics/PhysicsRuntime.js'
import { normalizeCharacterTraversalProfile } from '../physics/CharacterTraversalProfile.js'
import {
  collectModelMovementObstacles,
  collectModelSupportSurfaces,
  collectModelTraversalTrimeshes,
} from '../engine/modelSpatialRuntime.js'

function toWorldPoint(THREE, part, point) {
  const values = [point?.x, point?.y, point?.z].map(Number)
  if (!values.every(Number.isFinite)) return null
  return new THREE.Vector3(values[0], values[1], values[2]).applyMatrix4(part.matrixWorld)
}

function buildMeshBuffers(THREE, meshes) {
  const vertices = []
  const indices = []
  const point = new THREE.Vector3()
  for (const mesh of meshes) {
    const position = mesh.geometry?.getAttribute?.('position')
    if (!mesh.isMesh || !position || position.itemSize < 3 || position.count < 3) continue
    const index = mesh.geometry.index
    const count = index ? index.count : position.count
    const start = Math.max(0, Number(mesh.geometry.drawRange?.start) || 0)
    const requestedCount = Number(mesh.geometry.drawRange?.count)
    const end = Math.min(count, Number.isFinite(requestedCount) ? start + requestedCount : count)
    const offset = vertices.length / 3
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
      vertices.push(point.x, point.y, point.z)
    }
    for (let i = start; i + 2 < end; i += 3) {
      const read = cursor => index ? index.getX(cursor) : cursor
      const a = read(i), b = read(i + 1), c = read(i + 2)
      if ([a, b, c].every(value => Number.isInteger(value) && value >= 0 && value < position.count)) {
        indices.push(offset + a, offset + b, offset + c)
      }
    }
  }
  if (vertices.length < 9 || indices.length < 3) return null
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

function isPoint(value) {
  return value && typeof value === 'object'
    && [value.x, value.y, value.z].every(item => Number.isFinite(Number(item)))
}

/**
 * Runs declared stair/ramp routes in an isolated Rapier world using the same
 * character profile as the live controller. Only the probe world is advanced;
 * the user's live sandbox simulation is never stepped or mutated.
 */
export async function testModelTraversalRoutes(THREE, RAPIER, model, options = {}) {
  if (!THREE?.Vector3 || !model?.traverse) throw new TypeError('Traversal probe requires a Three.js model')
  if (!RAPIER) throw new TypeError('Traversal probe requires an initialized Rapier module')
  model.updateWorldMatrix(true, true)

  const manifest = model.userData?.proceduralModelCapabilityManifest
  const spatial = manifest?.capabilities?.spatial || {}
  const traversal = spatial.traversability || {}
  const parts = new Map()
  model.traverse(object => {
    const id = object.userData?.componentId
    if (typeof id === 'string' && !parts.has(id)) parts.set(id, object)
  })

  const routes = [
    ...(Array.isArray(traversal.jumps) ? traversal.jumps.map(item => ({ ...item, routeType: 'jumps' })) : []),
    ...(Array.isArray(traversal.stairs) ? traversal.stairs.map(item => ({ ...item, routeType: 'stairs' })) : []),
    ...(Array.isArray(traversal.ramps) ? traversal.ramps.map(item => ({ ...item, routeType: 'ramps' })) : []),
  ]
  const unresolved = []
  const resolvedRoutes = []
  for (const route of routes) {
    const part = parts.get(route.targetPartId)
    if (!part) {
      unresolved.push({ id: route.id || null, type: route.routeType, status: 'failed', reason: 'target-part-missing' })
      continue
    }
    if (!isPoint(route.startPoint) || !isPoint(route.endPoint)) {
      unresolved.push({ id: route.id || null, type: route.routeType, status: 'not-tested', reason: 'startPoint/endPoint-required' })
      continue
    }
    const start = toWorldPoint(THREE, part, route.startPoint)
    const end = toWorldPoint(THREE, part, route.endPoint)
    const horizontalDistance = Math.hypot(end.x - start.x, end.z - start.z)
    if (horizontalDistance < 0.1) {
      unresolved.push({ id: route.id || null, type: route.routeType, status: 'not-tested', reason: 'horizontal-route-too-short' })
      continue
    }
    resolvedRoutes.push({ id: route.id || null, type: route.routeType, start, end })
  }

  if (!resolvedRoutes.length) {
    return {
      version: 1,
      status: unresolved.some(item => item.status === 'failed') ? 'invalid' : 'needs-route-endpoints',
      declaredRoutesPassed: false,
      certifiedWalkable: false,
      summary: { routeCount: routes.length, testedCount: 0, passedCount: 0, failedCount: unresolved.filter(item => item.status === 'failed').length },
      routes: unresolved,
    }
  }

  const fixedTimeStep = Number(options.fixedTimeStep) > 0 ? Number(options.fixedTimeStep) : 1 / 60
  const speed = Number(options.speed) > 0 ? Number(options.speed) : 2.5
  const maxDuration = Number(options.maxDuration) > 0 ? Number(options.maxDuration) : 18
  const tolerance = Number(options.tolerance) > 0 ? Number(options.tolerance) : 0.3
  const gravity = Number(options.gravity) > 0 ? Number(options.gravity) : 24
  // Traversal certification always uses the one global player profile.
  // Callers may tune probe timing, but cannot shrink or enlarge the test character.
  const profile = normalizeCharacterTraversalProfile()
  const runtime = await PhysicsRuntime.create({
    RAPIER,
    fixedTimeStep,
    maxSubSteps: 1,
    maxFrameDelta: fixedTimeStep,
  })

  const meshParts = new Set()
  let colliderIndex = 0
  try {
    const traversalMeshes = collectModelTraversalTrimeshes(THREE, model, 'traversal-probe')
    for (const item of traversalMeshes) {
      runtime.createStaticTrimesh({
        id: 'probe:traversal:' + item.surfaceId,
        ownerId: 'probe',
        vertices: item.vertices,
        indices: item.indices,
        friction: 0.9,
      })
      meshParts.add(item.targetPartId)
    }

    const supportSurfaces = collectModelSupportSurfaces(model, 'traversal-probe')
    const supportGroups = new Map()
    for (const surface of supportSurfaces) {
      if (meshParts.has(surface.targetPartId)) continue
      supportGroups.set(surface.targetPartId, surface.meshes)
    }
    for (const [partId, meshes] of supportGroups) {
      const buffers = buildMeshBuffers(THREE, meshes)
      if (!buffers) continue
      runtime.createStaticTrimesh({
        id: 'probe:support:' + partId,
        ownerId: 'probe',
        ...buffers,
        friction: 0.9,
      })
      meshParts.add(partId)
    }

    const obstacles = collectModelMovementObstacles(THREE, model, 'traversal-probe', { includeAllHeights: true })
    for (const obstacle of obstacles) {
      if (meshParts.has(obstacle.targetPartId)) continue
      const halfExtents = {
        x: (obstacle.maxX - obstacle.minX) / 2,
        y: (obstacle.maxY - obstacle.minY) / 2,
        z: (obstacle.maxZ - obstacle.minZ) / 2,
      }
      if (![halfExtents.x, halfExtents.y, halfExtents.z].every(value => value > 0.001)) continue
      runtime.createStaticBox({
        id: 'probe:box:' + colliderIndex++,
        ownerId: 'probe',
        translation: {
          x: (obstacle.minX + obstacle.maxX) / 2,
          y: (obstacle.minY + obstacle.maxY) / 2,
          z: (obstacle.minZ + obstacle.maxZ) / 2,
        },
        halfExtents,
        friction: 0.85,
      })
    }

    const tested = []
    const maxSteps = Math.ceil(maxDuration / fixedTimeStep)
    for (const route of resolvedRoutes) {
      const characterId = 'probe:character:' + (route.id || tested.length)
      runtime.createKinematicCharacter({
        id: characterId,
        translation: { x: route.start.x, y: route.start.y, z: route.start.z },
        traversalProfile: profile,
      })
      let result = { status: 'timeout', reason: 'route-timeout' }
      const maxSteps = Math.ceil(maxDuration / fixedTimeStep)
      const horizontalDistance = Math.hypot(route.end.x - route.start.x, route.end.z - route.start.z)

      if (route.type === 'jumps') {
        if (horizontalDistance > profile.jumpMaxDistance) {
          result = { status: 'failed', reason: 'jump-distance-exceeded' }
        } else {
          const launchVelocity = Math.sqrt(2 * gravity * profile.jumpHeight)
          const flightTime = 2 * launchVelocity / gravity
          const horizontalSpeed = horizontalDistance / Math.max(flightTime, fixedTimeStep)
          let verticalVelocity = launchVelocity
          let landed = false
          for (let step = 0; step < maxSteps; step += 1) {
            runtime.setKinematicCharacterVelocity(characterId, {
              x: horizontalDistance > tolerance ? ((route.end.x - route.start.x) / horizontalDistance) * horizontalSpeed : 0,
              y: verticalVelocity,
              z: horizontalDistance > tolerance ? ((route.end.z - route.start.z) / horizontalDistance) * horizontalSpeed : 0,
            })
            runtime.step(fixedTimeStep)
            verticalVelocity -= gravity * fixedTimeStep
            const state = runtime.getKinematicCharacterState(characterId)
            const remaining = Math.hypot(route.end.x - state.translation.x, route.end.z - state.translation.z)
            if (state.translation.y < route.end.y - 1.5) {
              result = { status: 'failed', reason: 'no-safe-landing' }
              break
            }
            if (state.grounded && step > 0 && verticalVelocity <= 0) {
              landed = true
              result = remaining <= tolerance && Math.abs(state.translation.y - route.end.y) <= Math.max(0.25, profile.maxStepHeight)
                ? { status: 'passed', reason: null }
                : { status: 'failed', reason: 'unsafe-landing' }
              break
            }
          }
          if (!landed && result.status === 'timeout') result = { status: 'failed', reason: 'no-safe-landing' }
        }
      } else {
        let verticalVelocity = 0
        let blockedFrames = 0
        let previousDistance = horizontalDistance
        let groundedFrames = 0
        for (let step = 0; step < maxSteps; step += 1) {
          const state = runtime.getKinematicCharacterState(characterId)
          const dx = route.end.x - state.translation.x
          const dz = route.end.z - state.translation.z
          const distance = Math.hypot(dx, dz)
          if (distance <= tolerance && Math.abs(state.translation.y - route.end.y) <= Math.max(0.45, profile.maxStepHeight) && state.grounded) {
            result = { status: 'passed', reason: null }
            break
          }
          if (state.grounded) {
            verticalVelocity = 0
            groundedFrames += 1
          } else {
            verticalVelocity = Math.max(-12, verticalVelocity - gravity * fixedTimeStep)
          }
          const moving = distance > tolerance
          runtime.setKinematicCharacterVelocity(characterId, {
            x: moving ? (dx / distance) * speed : 0,
            y: verticalVelocity,
            z: moving ? (dz / distance) * speed : 0,
          })
          runtime.step(fixedTimeStep)
          const next = runtime.getKinematicCharacterState(characterId)
          const nextDistance = Math.hypot(route.end.x - next.translation.x, route.end.z - next.translation.z)
          if (nextDistance < previousDistance - 0.002) blockedFrames = 0
          else if (nextDistance > tolerance) blockedFrames += 1
          if (next.translation.y < route.start.y - 1.5) {
            result = { status: 'failed', reason: 'fell-below-start-height' }
            break
          }
          if (blockedFrames >= 36) {
            result = { status: 'failed', reason: 'blocked-or-stuck' }
            break
          }
          previousDistance = nextDistance
        }
        if (result.status === 'timeout' && groundedFrames === 0) {
          result = { status: 'failed', reason: 'no-ground-contact' }
        }
      }

      tested.push({
        id: route.id,
        type: route.type,
        status: result.status,
        reason: result.reason,
        start: { x: route.start.x, y: route.start.y, z: route.start.z },
        end: { x: route.end.x, y: route.end.y, z: route.end.z },
        finalState: runtime.getKinematicCharacterState(characterId),
      })
      runtime.removeBody(characterId)
    }
    const passedCount = tested.filter(item => item.status === 'passed').length
    const failedCount = tested.filter(item => item.status === 'failed').length
    const declaredRoutesPassed = tested.length > 0 && passedCount === tested.length && unresolved.length === 0
    const untestedOtherCapabilities = (Array.isArray(traversal.passages) && traversal.passages.length > 0)
      || (Array.isArray(traversal.connections) && traversal.connections.length > 0)
    return {
      version: 1,
      status: declaredRoutesPassed ? 'passed' : (failedCount ? 'failed' : 'incomplete'),
      declaredRoutesPassed,
      certifiedWalkable: declaredRoutesPassed && !untestedOtherCapabilities,
      summary: { routeCount: routes.length, testedCount: tested.length, passedCount, failedCount },
      routes: [...tested, ...unresolved],
    }
  } finally {
    runtime.dispose()
  }
}
