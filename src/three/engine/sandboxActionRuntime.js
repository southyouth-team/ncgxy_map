/**
 * Executes the small, data-only interaction action set supported by the sandbox.
 * No arbitrary property paths, callbacks, scripts or dynamic code are accepted.
 */
function finiteVector(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const vector = {}
  for (const axis of ['x', 'y', 'z']) {
    if (input[axis] === undefined) continue
    const value = Number(input[axis])
    if (!Number.isFinite(value)) return null
    vector[axis] = value
  }
  return Object.keys(vector).length ? vector : null
}

function findPartById(root, componentId) {
  if (componentId == null || !root?.traverse) return null
  let match = null
  root.traverse(object => {
    if (!match && String(object.userData?.componentId ?? '') === String(componentId)) match = object
  })
  return match
}

export function executeSandboxInteractionAction({ model, sourcePartId = null, config = {} } = {}) {
  if (!model?.traverse || !config || typeof config !== 'object') return { ok: false, reason: 'invalid-interaction' }
  const action = config.action === 'toggle-state' ? 'toggle' : config.action
  if (action === 'toggle' || action === 'set') {
    const stateKey = typeof config.stateKey === 'string' ? config.stateKey.trim() : ''
    if (!stateKey || stateKey.length > 120) return { ok: false, reason: 'invalid-state-key' }
    const current = model.userData?.worldState && typeof model.userData.worldState === 'object' ? model.userData.worldState : {}
    const value = action === 'toggle' ? !Boolean(current[stateKey]) : config.value
    if (action === 'set' && value === undefined) return { ok: false, reason: 'missing-state-value' }
    if (action === 'set' && value !== null && !['boolean', 'string', 'number'].includes(typeof value)) {
      return { ok: false, reason: 'invalid-state-value' }
    }
    if (action === 'set' && typeof value === 'number' && !Number.isFinite(value)) {
      return { ok: false, reason: 'invalid-state-value' }
    }
    return { ok: true, action, stateKey, statePatch: { [stateKey]: value } }
  }
  if (action === 'rotate' || action === 'translate') {
    const targetPartId = config.targetPartId ?? sourcePartId
    const target = targetPartId == null ? model : findPartById(model, targetPartId)
    if (!target) return { ok: false, reason: 'target-part-not-found' }
    const vector = finiteVector(action === 'rotate' ? config.rotation : config.offset)
    if (!vector) return { ok: false, reason: 'invalid-transform-vector' }
    const transform = action === 'rotate' ? target.rotation : target.position
    for (const axis of ['x', 'y', 'z']) if (vector[axis] !== undefined) transform[axis] += vector[axis]
    return { ok: true, action, targetPartId: target.userData?.componentId ?? null, transform: vector }
  }
  return { ok: false, reason: 'unsupported-action', action: typeof action === 'string' ? action : null }
}
