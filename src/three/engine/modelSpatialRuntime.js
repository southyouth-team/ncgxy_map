/**
 * Build grounded movement obstacles from a model's data-only spatial manifest.
 * Coordinates are expressed in the target part's local space and transformed
 * into world-space AABBs. CollisionWorld currently resolves movement on XZ.
 */
import { resolveCapabilityRecords } from '../sandbox/capabilityControl.js'

export function collectModelMovementObstacles(THREE, root, ownerId) {
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
    const blocksMovement = capability?.value?.blocksMovement ?? collider.blocksMovement !== false
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
    if (worldBounds.min.y > 1.7 || worldBounds.max.y < 0) continue
    obstacles.push({
      ownerId: String(ownerId),
      minX: worldBounds.min.x,
      maxX: worldBounds.max.x,
      minZ: worldBounds.min.z,
      maxZ: worldBounds.max.z,
    })
  }
  return obstacles
}
