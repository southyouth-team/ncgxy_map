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
  for (const key of Object.keys(clone)) {
    const value = clone[key]
    if (value?.isTexture && typeof value.clone === 'function') {
      clone[key] = value.clone()
    }
  }
  return clone
}
