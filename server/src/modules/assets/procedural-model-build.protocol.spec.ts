import { resolveModelBuildOrder, type ModelBuildPlan } from './procedural-model-build.protocol';

describe('procedural model build protocol', () => {
  const createPlan = (components: ModelBuildPlan['components']): ModelBuildPlan => ({
    version: 1,
    modelId: 'model-1',
    name: 'Test model',
    coordinateSystem: { upAxis: 'Y', units: 'scene' },
    components,
  });

  it('keeps arbitrary component semantics and resolves explicit dependencies', () => {
    const plan = createPlan([
      { id: 'outer-shell', purpose: 'arbitrary user-defined component' },
      { id: 'detail-a', dependsOn: ['outer-shell'] },
      { id: 'foundation', purpose: 'not a predefined category' },
    ]);

    expect(resolveModelBuildOrder(plan).map(item => item.id))
      .toEqual(['outer-shell', 'foundation', 'detail-a']);
  });

  it('treats parent relationships as build dependencies', () => {
    const plan = createPlan([
      { id: 'child', parentId: 'root' },
      { id: 'root' },
    ]);

    expect(resolveModelBuildOrder(plan).map(item => item.id)).toEqual(['root', 'child']);
  });

  it('rejects duplicate or unresolved stable identifiers', () => {
    expect(() => resolveModelBuildOrder(createPlan([{ id: 'same' }, { id: 'same' }])))
      .toThrow('Duplicate model component id');
    expect(() => resolveModelBuildOrder(createPlan([{ id: 'part', dependsOn: ['missing'] }])))
      .toThrow('Unknown component dependency');
  });

  it('rejects direct self-dependencies', () => {
    expect(() => resolveModelBuildOrder(createPlan([{ id: 'self', dependsOn: ['self'] }])) )
      .toThrow('cannot depend on itself');
    expect(() => resolveModelBuildOrder(createPlan([{ id: 'self', parentId: 'self' }])) )
      .toThrow('cannot depend on itself');
  });

  it('reports dependency cycles without imposing component-category rules', () => {
    const plan = createPlan([
      { id: 'alpha', dependsOn: ['beta'] },
      { id: 'beta', dependsOn: ['alpha'] },
    ]);

    expect(() => resolveModelBuildOrder(plan)).toThrow('Model component dependency cycle');
  });
});
