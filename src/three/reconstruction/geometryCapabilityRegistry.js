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
