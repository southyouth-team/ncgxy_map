import { describe, expect, it } from '@jest/globals';
import {
  applyObjectModelChangeSet,
  getObjectModelRevision,
} from './object-model-change-set';

describe('ObjectModelChangeSet 1.0', () => {
  const baseSpec = () => ({
    schemaVersion: '3.0',
    targetName: 'test-object',
    materials: { stone: { color: '#888888', roughness: 0.8, metalness: 0 } },
    componentTree: [
      { id: 'root', kind: 'group' },
      { id: 'body', parent: 'root', primitive: 'box', material: 'stone',
        dimensions: { width: 2, height: 2, depth: 2 } },
    ],
    parameterSchema: [],
    operations: [],
  });
  const changeSet = (spec: any, changes: any[]) => ({
    changeSetVersion: '1.0',
    baseRevision: getObjectModelRevision(spec),
    changes,
  });

  it('applies component additions and replacements as one atomic candidate', () => {
    const base = baseSpec();
    const result = applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'add-component', component: { id: 'window', parent: 'body', primitive: 'box',
        dimensions: { width: 0.5, height: 0.6, depth: 0.1 } } },
      { type: 'replace-component', nodeId: 'body', component: {
        id: 'body', parent: 'root', primitive: 'box', material: 'stone',
        dimensions: { width: 3, height: 2, depth: 2 },
      } },
    ]));
    expect(result.objectModelSpec.componentTree).toHaveLength(3);
    expect(result.objectModelSpec.componentTree.find((node: any) => node.id === 'body').dimensions.width).toBe(3);
    expect(result.affectedNodeIds).toEqual(['window', 'body']);
    expect(base.componentTree[1].dimensions.width).toBe(2);
  });

  it('removes a leaf and requires explicit cascade for a subtree', () => {
    const base = baseSpec();
    base.componentTree.push({ id: 'window', parent: 'body', primitive: 'box',
      dimensions: { width: 0.5, height: 0.6, depth: 0.1 } });
    expect(() => applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'remove-component', nodeId: 'body' },
    ]))).toThrow('必须显式声明 cascade=true');
    const result = applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'remove-component', nodeId: 'body', cascade: true },
    ]));
    expect(result.objectModelSpec.componentTree.map((node: any) => node.id)).toEqual(['root']);
    expect(result.affectedNodeIds).toEqual(['body', 'window']);
  });

  it('does not permit removal of the only root node', () => {
    const base = baseSpec();
    expect(() => applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'remove-component', nodeId: 'root', cascade: true },
    ]))).toThrow('不允许删除主体根节点');
  });

  it('upserts materials but refuses to remove a material still referenced by a component', () => {
    const base = baseSpec();
    const updated = applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'upsert-material', materialId: 'steel', material: { color: '#777777', roughness: 0.4 } },
    ]));
    expect(updated.objectModelSpec.materials.steel.color).toBe('#777777');
    expect(updated.affectedMaterialIds).toEqual(['steel']);
    expect(() => applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'remove-material', materialId: 'stone' },
    ]))).toThrow('材质仍被组件引用');
  });

  it('replaces parameter schema and operations only through explicit change types', () => {
    const base = baseSpec();
    const result = applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'replace-parameter-schema', parameterSchema: [] },
      { type: 'replace-operations', operations: [] },
    ]));
    expect(result.parameterSchemaChanged).toBe(true);
    expect(result.operationsChanged).toBe(true);
  });

  it('rejects stale base revisions before applying any change', () => {
    const base = baseSpec();
    const stale = { ...changeSet(base, [{ type: 'remove-component', nodeId: 'body' }]), baseRevision: '0'.repeat(64) };
    expect(() => applyObjectModelChangeSet(base, stale)).toThrow('基线版本已过期');
    expect(base.componentTree).toHaveLength(2);
  });

  it('rejects identity mutation and unknown operation types', () => {
    const base = baseSpec();
    expect(() => applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'replace-component', nodeId: 'body', component: { id: 'other', parent: 'root' } },
    ]))).toThrow('必须保留原组件 ID');
    expect(() => applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'execute-javascript', source: 'alert(1)' },
    ]))).toThrow('不支持的 ChangeSet 操作');
  });

  it('rejects a candidate that fails the canonical ObjectModelSpec validator', () => {
    const base = baseSpec();
    expect(() => applyObjectModelChangeSet(base, changeSet(base, [
      { type: 'replace-component', nodeId: 'body', component: {
        id: 'body', parent: 'root', primitive: 'box',
        dimensions: { width: 0, height: 2, depth: 2 },
      } },
    ]))).toThrow('ChangeSet 执行结果未通过 ObjectModelSpec 校验');
  });

  it('rejects prototype-polluting keys and does not mutate the baseline', () => {
    const base = baseSpec();
    const malicious = JSON.parse('{"changeSetVersion":"1.0","baseRevision":"' + getObjectModelRevision(base)
      + '","changes":[{"type":"upsert-material","materialId":"unsafe","material":{"__proto__":{"polluted":true}}}]}');
    expect(() => applyObjectModelChangeSet(base, malicious)).toThrow('不安全字段');
    expect(({} as any).polluted).toBeUndefined();
    expect(base.componentTree).toHaveLength(2);
  });

  it('produces the same revision when object key order differs', () => {
    const first = { schemaVersion: '3.0', materials: {}, componentTree: [{ id: 'root', kind: 'group' }] };
    const second = { componentTree: [{ kind: 'group', id: 'root' }], materials: {}, schemaVersion: '3.0' };
    expect(getObjectModelRevision(first)).toBe(getObjectModelRevision(second));
  });

  it('rejects ChangeSets that exceed the ordered change budget', () => {
    const base = baseSpec();
    const changes = Array.from({ length: 201 }, () => ({ type: 'replace-operations', operations: [] }));
    expect(() => applyObjectModelChangeSet(base, changeSet(base, changes))).toThrow('ObjectModelChangeSet 1.0 格式无效');
  });

  it('rejects unsupported top-level ChangeSet fields', () => {
    const base = baseSpec();
    expect(() => applyObjectModelChangeSet(base, {
      ...changeSet(base, [{ type: 'replace-operations', operations: [] }]),
      script: 'not-allowed',
    })).toThrow('包含不支持的字段');
  });
});
