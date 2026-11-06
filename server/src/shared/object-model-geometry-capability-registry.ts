export interface ObjectModelGeometryCapability<TNode = any, TDescriptor = any> {
  primitive: string;
  descriptor: string;
  validateDescriptor: (node: TNode, descriptor: TDescriptor) => void;
}

/** Runtime-neutral trusted validator registry; it never executes model-provided code. */
export function createObjectModelGeometryCapabilityRegistry<TNode = any, TDescriptor = any>(
  definitions: ObjectModelGeometryCapability<TNode, TDescriptor>[],
) {
  const capabilities = new Map<string, Readonly<ObjectModelGeometryCapability<TNode, TDescriptor>>>();
  for (const definition of definitions) {
    if (!definition || typeof definition.primitive !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/i.test(definition.primitive)
      || typeof definition.descriptor !== 'string' || typeof definition.validateDescriptor !== 'function') {
      throw new TypeError('Geometry capability requires a valid primitive, descriptor contract and validator');
    }
    const primitive = definition.primitive.toLowerCase();
    if (capabilities.has(primitive)) throw new TypeError('Duplicate geometry capability: ' + primitive);
    capabilities.set(primitive, Object.freeze({ ...definition, primitive }));
  }
  return Object.freeze({
    get(primitive: unknown) {
      return typeof primitive === 'string' ? capabilities.get(primitive.toLowerCase()) || null : null;
    },
    has(primitive: unknown) {
      return typeof primitive === 'string' && capabilities.has(primitive.toLowerCase());
    },
    validate(primitive: unknown, node: TNode, descriptor: TDescriptor) {
      const capability = typeof primitive === 'string' ? capabilities.get(primitive.toLowerCase()) : null;
      if (!capability) throw new TypeError('Geometry capability is not registered: ' + String(primitive));
      capability.validateDescriptor(node, descriptor);
    },
    list() {
      return [...capabilities.values()].map(({ primitive, descriptor }) => ({ primitive, descriptor }));
    },
  });
}
