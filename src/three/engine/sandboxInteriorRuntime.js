/**
 * Resolve an AI-declared interior entry marker into world coordinates.
 * Manifest positions are local to a stable component group and represent
 * the floor contact point; the player controller adds its eye-height offset.
 */
export function resolveSandboxInteriorEntryPoint(THREE, model, entryPointId) {
  if (!THREE?.Vector3 || !model?.traverse || typeof entryPointId !== 'string' || !entryPointId) return null
  const declarations = model.userData?.proceduralModelCapabilityManifest?.capabilities?.interior?.entryPoints
  if (!Array.isArray(declarations)) return null
  const declaration = declarations.find(item => item && String(item.id) === entryPointId)
  if (!declaration || typeof declaration.targetPartId !== 'string') return null

  let target = null
  model.traverse(object => {
    if (!target && String(object.userData?.componentId ?? '') === declaration.targetPartId) target = object
  })
  if (!target) return null

  const source = declaration.position || {}
  const values = ['x', 'y', 'z'].map(axis => source[axis] === undefined ? 0 : Number(source[axis]))
  if (!values.every(Number.isFinite)) return null
  model.updateWorldMatrix(true, true)
  const world = target.localToWorld(new THREE.Vector3(values[0], values[1], values[2]))
  if (![world.x, world.y, world.z].every(Number.isFinite)) return null
  return { id: entryPointId, targetPartId: declaration.targetPartId, position: { x: world.x, y: world.y, z: world.z } }
}
