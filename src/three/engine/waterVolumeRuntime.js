/**
 * Data-driven water volume sampling for sandbox models.
 *
 * Water volumes are spatial sensors, not solid colliders. Their bottom is
 * anchored to model-local bottomY and their surface is bottomY + depth.
 */
function isFiniteNumber(value) {
  return Number.isFinite(Number(value))
}

function resolveVolumeDepth(model, declaration) {
  const id = String(declaration.id || '')
  const capabilityId = 'spatial.waterVolume.' + id + '.depth'
  const manifest = model.userData?.proceduralModelCapabilityManifest || {}
  const parameters = Array.isArray(manifest.parameters) ? manifest.parameters : []
  const values = model.userData?.proceduralModelParameterValues || {}
  const parameter = parameters.find(item => Array.isArray(item?.bindings)
    && item.bindings.some(binding => binding?.capabilityId === capabilityId && binding.property === 'depth'))
  const raw = parameter && Object.prototype.hasOwnProperty.call(values, parameter.id)
    ? values[parameter.id]
    : parameter?.default ?? declaration.depth
  const depth = Number(raw)
  return Number.isFinite(depth) && depth > 0 ? depth : null
}

export function collectModelWaterVolumes(THREE, model, ownerId) {
  if (!THREE?.Matrix4 || !model?.traverse || !ownerId) return []
  const declarations = model.userData?.proceduralModelCapabilityManifest
    ?.capabilities?.spatial?.waterVolumes
  if (!Array.isArray(declarations) || !declarations.length) return []

  const parts = new Map()
  model.traverse(object => {
    const id = object.userData?.componentId
    if (typeof id === 'string' && id.trim() && !parts.has(id)) parts.set(id, object)
  })

  const result = []
  const seen = new Set()
  for (const declaration of declarations) {
    if (!declaration || declaration.enabled === false || declaration.shape !== 'box'
      || typeof declaration.id !== 'string' || !declaration.id.trim()
      || typeof declaration.targetPartId !== 'string' || seen.has(declaration.id)) continue
    const target = parts.get(declaration.targetPartId)
    if (!target) continue
    const center = declaration.center || {}
    const size = declaration.size || {}
    const values = [center.x ?? 0, center.z ?? 0, size.x, size.z, declaration.bottomY, size.x, size.z]
      .map(Number)
    const depth = resolveVolumeDepth(model, declaration)
    if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0
      || !isFiniteNumber(declaration.bottomY) || depth === null) continue
    seen.add(declaration.id)
    result.push({
      id: declaration.id,
      ownerId: String(ownerId),
      targetPartId: declaration.targetPartId,
      target,
      model,
      declaration,
      center: { x: values[0], z: values[1] },
      size: { x: values[2], z: values[3] },
      bottomY: values[4],
      depth,
      capabilityId: 'spatial.waterVolume.' + declaration.id + '.depth',
    })
  }
  return result
}

export function samplePlayerWaterState(THREE, volumes, playerPosition, eyeHeight = 1.7) {
  if (!THREE?.Vector3 || !Array.isArray(volumes) || !volumes.length
    || !playerPosition || ![playerPosition.x, playerPosition.y, playerPosition.z].every(isFiniteNumber)) return null
  const eye = Number(eyeHeight)
  if (!Number.isFinite(eye) || eye <= 0) return null
  const player = new THREE.Vector3(Number(playerPosition.x), Number(playerPosition.y), Number(playerPosition.z))
  const feetY = player.y - eye
  let best = null

  for (const volume of volumes) {
    const target = volume?.target
    const depth = resolveVolumeDepth(volume.model, volume.declaration) ?? volume.depth
    if (!target?.matrixWorld || !Number.isFinite(depth) || depth <= 0) continue
    target.updateWorldMatrix?.(true, false)
    const elements = target.matrixWorld.elements
    // MVP water surfaces are horizontal. Reject tilted volumes rather than
    // reporting a misleading vertical depth for a sloped/rotated basin.
    if (Math.abs(elements[4]) > 1e-4 || Math.abs(elements[6]) > 1e-4) continue
    const inverse = new THREE.Matrix4().copy(target.matrixWorld).invert()
    const localPlayer = player.clone().applyMatrix4(inverse)
    const halfX = volume.size.x / 2
    const halfZ = volume.size.z / 2
    if (Math.abs(localPlayer.x - volume.center.x) > halfX
      || Math.abs(localPlayer.z - volume.center.z) > halfZ) continue

    const bottom = new THREE.Vector3(volume.center.x, volume.bottomY, volume.center.z)
      .applyMatrix4(target.matrixWorld)
    const surface = new THREE.Vector3(volume.center.x, volume.bottomY + depth, volume.center.z)
      .applyMatrix4(target.matrixWorld)
    const worldDepth = surface.y - bottom.y
    if (!Number.isFinite(worldDepth) || worldDepth <= 0) continue
    // Water-column depth and character immersion are different quantities.
    // A deep pool may be deeper than the avatar is tall; immersion must never
    // exceed the feet-to-head character segment.
    const immersionDepth = Math.max(0, Math.min(worldDepth, eye, surface.y - feetY))
    if (immersionDepth <= 0) continue
    const candidate = {
      volumeId: volume.id,
      modelId: volume.ownerId,
      depth: worldDepth,
      bottomHeight: bottom.y,
      surfaceHeight: surface.y,
      immersionDepth,
      depthRatio: immersionDepth / worldDepth,
      characterImmersionRatio: Math.max(0, Math.min(1, immersionDepth / eye)),
    }
    if (!best || candidate.immersionDepth > best.immersionDepth) best = candidate
  }
  return best
}
