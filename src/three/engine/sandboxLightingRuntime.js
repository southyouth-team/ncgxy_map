/**
 * Applies instance world state to actual Three.js light sources.
 * State stays authoritative; this runtime only maps declared intensity values.
 */
export function applySandboxLightingState(root, state = {}) {
  if (!root?.traverse || !state || typeof state !== 'object') return 0
  let applied = 0
  root.traverse(object => {
    const binding = object.userData?.stateBinding
    if (!object.isLight || binding?.property !== 'intensity' || typeof binding.key !== 'string' || !binding.key) return
    if (!Object.prototype.hasOwnProperty.call(state, binding.key)) return

    const enabled = Boolean(state[binding.key])
    const intensity = Number(enabled ? binding.enabledValue ?? 1 : binding.disabledValue ?? 0)
    if (!Number.isFinite(intensity) || intensity < 0) return

    object.intensity = intensity
    applied += 1
  })
  return applied
}
