/**
 * Normalize the versioned, data-only model capability contract while retaining
 * unknown capability sections for forward compatibility.
 */
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
