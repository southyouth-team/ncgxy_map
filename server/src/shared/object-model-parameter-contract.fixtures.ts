/**
 * Shared ObjectModelSpec parameter contract cases.
 * Imported by backend Jest and frontend Vitest to exercise identical inputs.
 */
function baseSpec(parameterSchema: any[]) {
  return {
    schemaVersion: '3.0',
    materials: { steel: { color: '#777777', roughness: 0.5, metalness: 0.8 } },
    componentTree: [
      { id: 'root', kind: 'group' },
      { id: 'panel', parent: 'root', primitive: 'box', material: 'steel',
        dimensions: { width: 2, height: 1, depth: 0.1 } },
    ],
    parameterSchema,
  };
}

export function createObjectModelParameterContractCases(): any[] {
  return [
    {
      id: 'valid-number-default-mode',
      spec: baseSpec([{ id: 'panel-width', type: 'number', value: 2, min: 1, max: 4, step: 0.5, unit: 'm',
        targets: [{ nodeId: 'panel', property: 'dimensions.width' }] }]),
      normalizer: 'accept', validator: 'accept',
      normalizedTarget: { nodeId: 'panel', property: 'dimensions.width', mode: 'set' },
    },
    {
      id: 'legacy-material-alias',
      spec: baseSpec([{ id: 'panel-color', type: 'color', value: '#aabbcc',
        targets: [{ nodeId: 'panel', property: 'lattice_color' }] }]),
      normalizer: 'accept', validator: 'accept',
      normalizedTarget: { nodeId: 'panel', property: 'material.color', mode: 'set' },
    },
    {
      id: 'invalid-unit-type',
      spec: baseSpec([{ id: 'panel-width', type: 'number', value: 2, min: 1, max: 4, unit: 7,
        targets: [{ nodeId: 'panel', property: 'dimensions.width' }] }]),
      normalizer: 'reject', validator: 'reject',
    },
    {
      id: 'numeric-string',
      spec: baseSpec([{ id: 'panel-width', type: 'number', value: '2', min: 1, max: 4,
        targets: [{ nodeId: 'panel', property: 'dimensions.width' }] }]),
      normalizer: 'reject', validator: 'reject',
    },
    {
      id: 'unknown-target',
      spec: baseSpec([{ id: 'panel-width', type: 'number', value: 2, min: 1, max: 4,
        targets: [{ nodeId: 'panel', property: 'dimensions.unknown' }] }]),
      normalizer: 'reject', validator: 'reject',
    },
    {
      id: 'unregistered-geometry-option',
      spec: baseSpec([{ id: 'panel-primitive', type: 'select', value: 'box',
        options: [{ label: 'Box', value: 'box' }, { label: 'Custom', value: 'custom-primitive' }],
        targets: [{ nodeId: 'panel', property: 'geometry.primitive' }] }]),
      // Capability registration is intentionally a final-validator responsibility.
      normalizer: 'accept', validator: 'reject',
    },
  ];
}
