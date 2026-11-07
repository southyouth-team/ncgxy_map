/**
 * Finds the closest declared part-level interaction in a sandbox model.
 * Interaction declarations are data only; the page applies the supported action.
 */
export function findNearestSandboxInteraction(THREE, sandboxModels, player) {
  if (!THREE?.Vector3 || !(sandboxModels instanceof Map) || !player) return null
  let nearest = null

  for (const [id, model] of sandboxModels) {
    if (!model?.traverse) continue
    model.updateWorldMatrix(true, true)
    const targets = []
    model.traverse(object => {
      if (object.userData?.interactionConfig?.action) targets.push(object)
    })
    // Preserve the legacy model-root interaction when no part declares one.
    if (!targets.length) targets.push(model)

    for (const target of targets) {
      const config = target.userData?.interactionConfig || model.userData?.interactionConfig || {}
      const point = target.userData?.interactionPoint
      const worldPosition = point && typeof point === 'object'
        ? new THREE.Vector3(Number(point.x) || 0, Number(point.y) || 0, Number(point.z) || 0).applyMatrix4(target.matrixWorld)
        : target.getWorldPosition(new THREE.Vector3())
      const radius = Number(config.radius ?? target.userData?.interactionRadius ?? model.userData?.interactionRadius) || 3.5
      const distance = Math.hypot(Number(player.x) - worldPosition.x, Number(player.z) - worldPosition.z)
      if (distance > radius || (nearest && distance >= nearest.distance)) continue

      nearest = {
        id: String(id),
        name: target === model ? model.name : (target.userData?.displayName || target.name || model.name),
        modelName: model.name,
        targetPartId: target.userData?.componentId == null ? null : String(target.userData.componentId),
        config,
        distance,
      }
    }
  }

  return nearest
}
