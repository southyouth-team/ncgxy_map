/**
 * Clone a sandbox material together with its texture references.
 *
 * Three.js Material.clone() clones the material object but intentionally keeps
 * texture references shared. Sandbox instances own their cloned materials and
 * textures so disposing one instance cannot invalidate another instance.
 */
export function cloneSandboxMaterial(material) {
  if (!material?.clone) return material
  const clone = material.clone()
  const textures = new Map()
  for (const key of Object.keys(clone)) {
    const texture = clone[key]
    if (!texture?.isTexture || typeof texture.clone !== 'function') continue
    if (!textures.has(texture)) textures.set(texture, texture.clone())
    clone[key] = textures.get(texture)
  }
  return clone
}

/**
 * Dispose all direct texture properties and the material exactly once.
 */
export function disposeSandboxMaterial(material) {
  if (!material) return
  const textures = new Set()
  for (const key of Object.keys(material)) {
    const value = material[key]
    if (value?.isTexture) textures.add(value)
  }
  textures.forEach(texture => texture.dispose?.())
  material.dispose?.()
}
