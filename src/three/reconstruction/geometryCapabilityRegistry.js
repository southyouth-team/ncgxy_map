/**
 * Compare protocol-declared geometry capabilities with trusted runtime executors.
 * This is an audit only: incomplete migration is reported, never silently treated
 * as executable support and never blocks application startup.
 */
export function auditGeometryCapabilityCoverage(protocolCapabilities = [], runtimeCapabilities = []) {
  const toMap = (items, label) => {
    if (!Array.isArray(items)) throw new TypeError(label + ' must be an array');
    const map = new Map();
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || typeof item.primitive !== 'string'
        || typeof item.descriptor !== 'string') {
        throw new TypeError(label + ' contains an invalid capability');
      }
      if (map.has(item.id)) throw new TypeError(label + ' contains a duplicate capability ID: ' + item.id);
      map.set(item.id, item);
    }
    return map;
  };
  const protocol = toMap(protocolCapabilities, 'Protocol capabilities');
  const runtime = toMap(runtimeCapabilities, 'Runtime capabilities');
  const missingExecutorIds = [];
  const unknownExecutorIds = [];
  const descriptorMismatches = [];
  const primitiveMismatches = [];
  for (const [id, capability] of protocol) {
    const executor = runtime.get(id);
    if (!executor) {
      missingExecutorIds.push(id);
      continue;
    }
    if (executor.descriptor !== capability.descriptor) descriptorMismatches.push(id);
    if (executor.primitive !== capability.primitive) primitiveMismatches.push(id);
  }
  for (const id of runtime.keys()) {
    if (!protocol.has(id)) unknownExecutorIds.push(id);
  }
  return Object.freeze({
    complete: missingExecutorIds.length === 0 && unknownExecutorIds.length === 0
      && descriptorMismatches.length === 0 && primitiveMismatches.length === 0,
    protocolCount: protocol.size,
    runtimeCount: runtime.size,
    missingExecutorIds: Object.freeze(missingExecutorIds.sort()),
    unknownExecutorIds: Object.freeze(unknownExecutorIds.sort()),
    descriptorMismatches: Object.freeze(descriptorMismatches.sort()),
    primitiveMismatches: Object.freeze(primitiveMismatches.sort()),
  });
}

/**
 * Trusted, runtime-local geometry capability registry.
 * Only application code can register validators and Three.js executors; model data
 * supplies a primitive identifier and descriptor, never executable code.
 */
export function createGeometryCapabilityRegistry(initialCapabilities = [], resolveProtocolContract = null) {
  const capabilities = new Map();

  const register = capability => {
    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
      throw new TypeError('Geometry capability registration must be an object');
    }
    if (typeof capability.primitive !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/i.test(capability.primitive)) {
      throw new TypeError('Geometry capability primitive is invalid');
    }
    if (typeof capability.validateDescriptor !== 'function' || typeof capability.createGeometry !== 'function') {
      throw new TypeError('Geometry capability requires a trusted validator and executor');
    }
    const primitive = capability.primitive.toLowerCase();
    const descriptor = capability.descriptor || 'custom';
    if (resolveProtocolContract) {
      const contract = resolveProtocolContract(primitive);
      if (!contract || contract.id !== primitive || contract.primitive !== primitive) {
        throw new TypeError('Geometry capability has no matching protocol contract: ' + primitive);
      }
      if (contract.descriptor !== descriptor) {
        throw new TypeError('Geometry capability descriptor contract mismatch: ' + primitive);
      }
    }
    if (capabilities.has(primitive)) throw new TypeError('Geometry capability already registered: ' + primitive);
    capabilities.set(primitive, Object.freeze({
      id: primitive,
      primitive,
      descriptor,
      validateDescriptor: capability.validateDescriptor,
      createGeometry: capability.createGeometry,
    }));
    return api;
  };

  const api = Object.freeze({
    register,
    has(primitive) {
      return typeof primitive === 'string' && capabilities.has(primitive.toLowerCase());
    },
    get(primitive) {
      return typeof primitive === 'string' ? capabilities.get(primitive.toLowerCase()) || null : null;
    },
    list() {
      return [...capabilities.values()].map(({ id, primitive, descriptor }) => ({ id, primitive, descriptor }));
    },
    create(primitive, context) {
      const capability = api.get(primitive);
      if (!capability) throw new TypeError('Geometry capability is not registered: ' + String(primitive));
      capability.validateDescriptor(context);
      const geometry = capability.createGeometry(context);
      if (!geometry || typeof geometry !== 'object') {
        throw new TypeError('Geometry capability executor returned an invalid geometry: ' + capability.primitive);
      }
      return geometry;
    },
  });

  for (const capability of initialCapabilities) register(capability);
  return api;
}
