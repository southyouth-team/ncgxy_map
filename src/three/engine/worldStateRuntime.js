/**
 * Applies serializable world-state bindings to Three.js runtime properties.
 * World state remains authoritative; rendered properties can be rebuilt after loading.
 */
export function applyWorldStateBindings(root, state = {}) {
  if (!root?.traverse || !state || typeof state !== 'object') return 0
  let applied = 0
  root.traverse(object => {
    const binding = object.userData?.stateBinding
    if (!binding?.key || !Object.prototype.hasOwnProperty.call(state, binding.key)) return
    const enabled = Boolean(state[binding.key])
    if (binding.property === 'visible') {
      object.visible = enabled
      applied += 1
    } else if (binding.property === 'intensity' && 'intensity' in object) {
      object.intensity = enabled ? Number(binding.enabledValue ?? 1) : 0
      applied += 1
    } else if (binding.property === 'emissiveIntensity' && object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      let changed = false
      materials.forEach(material => {
        if ('emissiveIntensity' in material) {
          material.emissiveIntensity = enabled ? Number(binding.enabledValue ?? 1) : 0
          changed = true
        }
      })
      if (changed) applied += 1
    }
  })
  return applied
}
