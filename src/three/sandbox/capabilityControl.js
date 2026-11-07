/**
 * Data-only capability reasoning/control contract.
 * Unknown capability names and payload fields are intentionally preserved.
 * This module resolves declarations; it never executes capability payloads.
 */
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function scopeKey(scope = {}) {
  return [scope.targetType || 'model', scope.targetId || '*', scope.regionId || '*', scope.partId || '*']
    .map(value => String(value)).join(':')
}
function recordKey(record) { return String(record.capabilityId || '') + '@' + scopeKey(record.scope) }
export function normalizeCapabilityControlDocument(input) {
  const source = isRecord(input) ? input : {}
  const inference = isRecord(source.inference) ? source.inference : {}
  return {
    ...source,
    version: Number.isInteger(source.version) ? source.version : 1,
    inference: { ...inference, proposals: Array.isArray(inference.proposals) ? inference.proposals : [] },
    overrides: Array.isArray(source.overrides) ? source.overrides : [],
    diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics : [],
  }
}
/**
 * Priority: user override > model definition > automatic AI inference > Runtime fallback.
 * AI inference is applied by default; explicit user instructions/overrides remain authoritative.
 * This resolver only resolves data and never claims that a Runtime has compiled or applied it.
 */
export function resolveCapabilityRecords({ definitions = [], proposals = [], overrides = [], fallback = [] } = {}) {
  const resolved = new Map()
  const apply = (records, source, priority, mode = 'value') => {
    for (const record of Array.isArray(records) ? records : []) {
      if (!isRecord(record) || typeof record.capabilityId !== 'string' || !record.capabilityId) continue
      const key = recordKey(record)
      const current = resolved.get(key)
      if (current && current.priority > priority) continue
      const status = record.status
      const action = record.action
      if (status === 'rejected' || action === 'reject' || action === 'disable') {
        resolved.set(key, {
          capabilityId: record.capabilityId, scope: isRecord(record.scope) ? record.scope : {},
          enabled: false, value: undefined, source, status: 'suppressed', priority,
          reason: record.reason || (action === 'disable' ? 'disabled-by-user' : 'rejected'),
        })
        continue
      }
      if (action && action !== 'set' && action !== 'accept') continue
      resolved.set(key, {
        ...record, scope: isRecord(record.scope) ? record.scope : {},
        enabled: record.enabled !== false,
        value: record.value, source,
        status: mode === 'proposal' ? 'inferred' : 'resolved', priority,
      })
    }
  }
  apply(fallback, 'runtime-default', 0)
  apply(proposals, 'ai-inference', 10, 'proposal')
  apply(definitions, 'model-definition', 20)
  apply(overrides, 'user-override', 30)
  return [...resolved.values()].map(({ priority, ...record }) => record)
}


/**
 * Build the per-model capability control document from the AI-authored
 * manifest. Each top-level capability namespace is retained as an extensible
 * inference record; existing user overrides and diagnostics survive edits.
 */
export function createCapabilityControlDocument({ manifest, previousDocument, source = 'ai-model-manifest' } = {}) {
  const previous = normalizeCapabilityControlDocument(previousDocument)
  const capabilities = isRecord(manifest?.capabilities) ? manifest.capabilities : {}
  const proposals = Object.entries(capabilities).map(([name, value]) => ({
    capabilityId: 'model.' + name,
    scope: { targetType: 'model' },
    source,
    status: 'inferred',
    enabled: true,
    evidence: ['Declared in modelCapabilityManifest.capabilities.' + name],
    value,
  }))
  return {
    ...previous,
    version: 1,
    inference: {
      ...(previous.inference || {}),
      proposals,
      updatedAt: new Date().toISOString(),
    },
    overrides: previous.overrides,
    diagnostics: previous.diagnostics,
  }
}
