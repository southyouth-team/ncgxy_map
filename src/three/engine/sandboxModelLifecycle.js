import * as THREE from 'three'

/**
 * Clone a sandbox material together with its texture references.
 *
 * Three.js Material.clone() clones the material object but intentionally keeps
 * texture references shared. Sandbox instances own their cloned materials and
 * textures so disposing one instance cannot invalidate another instance.
 * ShaderMaterial.clone() additionally deep-clones uniforms, including uniform
 * textures, so those only need disposal coverage below.
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

function collectMaterialTextures(material, textures) {
  for (const key of Object.keys(material)) {
    const value = material[key]
    if (value?.isTexture) textures.add(value)
  }
  const uniforms = material.uniforms
  if (!uniforms || typeof uniforms !== 'object') return
  for (const key of Object.keys(uniforms)) {
    const value = uniforms[key]?.value
    if (value?.isTexture) {
      textures.add(value)
    } else if (Array.isArray(value)) {
      value.forEach(item => {
        if (item?.isTexture) textures.add(item)
      })
    }
  }
}

/**
 * Dispose direct and ShaderMaterial uniform textures, then the material once.
 */
export function disposeSandboxMaterial(material) {
  if (!material) return
  const textures = new Set()
  collectMaterialTextures(material, textures)
  textures.forEach(texture => texture.dispose?.())
  material.dispose?.()
}

/**
 * Clone an Object3D subtree with preview-owned geometry, material and texture
 * instances. Object3D.clone() alone only duplicates the scene graph and keeps
 * render resources shared, which would let preview animation or disposal touch
 * the live sandbox model.
 */
export function cloneSandboxObjectResources(root) {
  if (!root?.clone) return root
  const previewRoot = root.clone(true)
  const geometryClones = new Map()
  const materialClones = new Map()
  const cloneMaterial = material => {
    if (!material?.clone) return material
    if (!materialClones.has(material)) {
      materialClones.set(material, cloneSandboxMaterial(material))
    }
    return materialClones.get(material)
  }

  previewRoot.traverse(object => {
    if (object.geometry?.clone) {
      if (!geometryClones.has(object.geometry)) {
        geometryClones.set(object.geometry, object.geometry.clone())
      }
      object.geometry = geometryClones.get(object.geometry)
    }
    if (Array.isArray(object.material)) {
      object.material = object.material.map(cloneMaterial)
    } else if (object.material) {
      object.material = cloneMaterial(object.material)
    }
  })
  return previewRoot
}

/** Dispose resources owned by a preview subtree exactly once. */
export function disposeSandboxObjectResources(root) {
  if (!root?.traverse) return
  const geometries = new Set()
  const materials = new Set()
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry)
    if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material))
    else if (object.material) materials.add(object.material)
  })
  geometries.forEach(geometry => geometry.dispose?.())
  materials.forEach(material => disposeSandboxMaterial(material))
}

/**
 * Build an independently owned duplicate of a placed sandbox model.
 *
 * When a pre-animation serialized baseline exists (models driven by the
 * animation Runtime), parse that baseline instead of cloning the live graph:
 * the live graph may hold mid-animation poses and controller-added helper
 * nodes that must never become the duplicate's rest state or save baseline.
 * ObjectLoader instantiates fresh geometry/material/texture resources.
 *
 * Without a baseline (static models have no Runtime entry), fall back to the
 * live-graph clone with explicitly re-owned GPU resources.
 */
export function clonePlacedSandboxModel(source, serializedBaseline) {
  if (serializedBaseline) return new THREE.ObjectLoader().parse(serializedBaseline)
  if (!source?.clone) return source
  const copy = source.clone(true)
  copy.traverse(object => {
    if (object.geometry?.clone) object.geometry = object.geometry.clone()
    if (Array.isArray(object.material)) {
      object.material = object.material.map(cloneSandboxMaterial)
    } else if (object.material) {
      object.material = cloneSandboxMaterial(object.material)
    }
  })
  return copy
}
