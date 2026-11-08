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
    } else if (binding.property === 'intensity' && 'intensity' in object && !object.isLight) {
      object.intensity = enabled ? Number(binding.enabledValue ?? 1) : 0
      applied += 1
    } else if (binding.property === 'emissiveIntensity' && object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      let changed = false
      materials.forEach(material => {
        if ('emissiveIntensity' in material) {
          material.emissiveIntensity = enabled ? Number(binding.enabledValue ?? 1) : Number(binding.disabledValue ?? 0)
          changed = true
        }
      })
      if (changed) applied += 1
    } else if (binding.property === 'rotationY') {
      object.rotation.y = enabled ? Number(binding.enabledValue ?? 1) : Number(binding.disabledValue ?? 0)
      applied += 1
    }
  })
  return applied
}


/**
 * Applies AI-declared environment bindings to matching model parts.
 * Bindings are data only; the runtime maps a small set of safe render properties.
 * Per-model overrides take precedence over global environment values.
 */
export function applyEnvironmentBindings(root, globalValues = {}) {
  if (!root?.traverse || !root.userData) return 0
  const bindings = root.userData.proceduralModelEnvironmentBindings
  if (!Array.isArray(bindings) || !bindings.length) return 0
  const overrides = root.userData.environmentOverrides && typeof root.userData.environmentOverrides === 'object'
    ? root.userData.environmentOverrides
    : {}
  const targets = new Map()
  root.traverse(object => {
    const id = object.userData?.componentId
    if (id != null) targets.set(String(id), object)
  })
  let applied = 0
  for (const binding of bindings) {
    if (!binding || typeof binding.variable !== 'string' || typeof binding.targetPartId !== 'string') continue
    const target = targets.get(binding.targetPartId)
    if (!target) continue
    const hasLocal = Object.prototype.hasOwnProperty.call(overrides, binding.variable)
    const hasGlobal = Object.prototype.hasOwnProperty.call(globalValues, binding.variable)
    const value = hasLocal ? overrides[binding.variable]
      : hasGlobal ? globalValues[binding.variable]
        : binding.defaultValue
    if (value === undefined) continue
    if (binding.property === 'visible') {
      target.visible = Boolean(value)
      applied += 1
    } else if (binding.property === 'intensity' && 'intensity' in target) {
      target.intensity = Boolean(value)
        ? Number(binding.enabledValue ?? 1)
        : Number(binding.disabledValue ?? 0)
      applied += 1
    } else if (binding.property === 'emissiveIntensity' && target.material) {
      const materials = Array.isArray(target.material) ? target.material : [target.material]
      let changed = false
      materials.forEach(material => {
        if ('emissiveIntensity' in material) {
          material.emissiveIntensity = Boolean(value)
            ? Number(binding.enabledValue ?? 1)
            : Number(binding.disabledValue ?? 0)
          changed = true
        }
      })
      if (changed) applied += 1
    }
  }
  return applied
}
