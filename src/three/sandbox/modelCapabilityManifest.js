/**
 * Normalize the versioned, data-only model capability contract while retaining
 * unknown capability sections for forward compatibility.
 */
const TRAVERSABILITY_COLLECTIONS = ['stairs', 'ramps', 'passages', 'connections']

/**
 * Normalize the extensible, data-only traversal declarations. This does not
 * infer geometry or claim that a declaration is already executable physics.
 */
export function normalizeSpatialTraversability(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    ...source,
    ...Object.fromEntries(TRAVERSABILITY_COLLECTIONS.map(key => [
      key,
      Array.isArray(source[key]) ? source[key] : [],
    ])),
  }
}

/**
 * Validate the minimum identity/relationship contract before geometry binding.
 * Unknown fields remain untouched for forward-compatible model capabilities.
 */
export function validateSpatialTraversability(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const issues = []
  for (const key of TRAVERSABILITY_COLLECTIONS) {
    if (source[key] != null && !Array.isArray(source[key])) {
      issues.push({ code: 'traversability.collection.invalid', path: key })
      continue
    }
    for (const [index, item] of (Array.isArray(source[key]) ? source[key] : []).entries()) {
      const path = `${key}[${index}]`
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push({ code: 'traversability.record.invalid', path })
        continue
      }
      if (typeof item.id !== 'string' || !item.id.trim()) {
        issues.push({ code: 'traversability.id.required', path: `${path}.id` })
      }
      if (key !== 'connections' && (typeof item.targetPartId !== 'string' || !item.targetPartId.trim())) {
        issues.push({ code: 'traversability.targetPartId.required', path: `${path}.targetPartId` })
      }
      if (key === 'connections' && (!item.from || !item.to)) {
        issues.push({ code: 'traversability.connection.endpoints.required', path })
      }
    }
  }
  return { valid: issues.length === 0, issues }
}

export function normalizeModelCapabilityManifest(input, legacyParameters = [], legacyEnvironmentBindings = []) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const sourceCapabilities = source.capabilities && typeof source.capabilities === 'object' && !Array.isArray(source.capabilities)
    ? source.capabilities : {}
  const parameters = Array.isArray(source.parameters)
    ? source.parameters
    : (Array.isArray(legacyParameters) ? legacyParameters : [])
  const capabilities = { ...sourceCapabilities }
  if (!Array.isArray(capabilities.environmentBindings) && Array.isArray(legacyEnvironmentBindings)) {
    capabilities.environmentBindings = legacyEnvironmentBindings
  }
  if (capabilities.spatial && typeof capabilities.spatial === 'object' && !Array.isArray(capabilities.spatial)) {
    const spatial = { ...capabilities.spatial }
    if (spatial.traversability && typeof spatial.traversability === 'object' && !Array.isArray(spatial.traversability)) {
      spatial.traversability = normalizeSpatialTraversability(spatial.traversability)
    }
    capabilities.spatial = spatial
  }
  return {
    ...source,
    version: Number.isInteger(source.version) ? source.version : 1,
    parameters,
    capabilities,
  }
}

/**
 * Distinguish an explicitly exported manifest from legacy metadata fallback.
 * The generated module is the runtime source of truth when it exports one.
 */
export function hasExplicitModelCapabilityManifest(input) {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input))
}


/**
 * Resolve part metadata from the source that actually produced the current
 * Object3D. An explicitly exported empty array is meaningful: it removes all
 * parts and must not be replaced by stale API/current-model metadata.
 */
export function resolveProceduralModelParts({
  moduleParts,
  modulePartsSource,
  responseParts,
  currentParts,
} = {}) {
  if (modulePartsSource === 'module') return Array.isArray(moduleParts) ? moduleParts : []
  if (Array.isArray(responseParts) && responseParts.length) return responseParts
  if (Array.isArray(moduleParts) && moduleParts.length) return moduleParts
  return Array.isArray(currentParts) ? currentParts : []
}
