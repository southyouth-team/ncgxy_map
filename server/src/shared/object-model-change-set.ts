import { createHash } from 'node:crypto';
import { validateObjectModelSpecV3 } from './object-model-spec-v3';

const CHANGE_SET_VERSION = '1.0';
const MAX_CHANGES = 200;
const MAX_CHANGE_SET_BYTES = 512 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50000;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type ObjectModelChange =
  | { type: 'add-component'; component: Record<string, any> }
  | { type: 'replace-component'; nodeId: string; component: Record<string, any> }
  | { type: 'remove-component'; nodeId: string; cascade?: boolean }
  | { type: 'upsert-material'; materialId: string; material: Record<string, any> }
  | { type: 'remove-material'; materialId: string }
  | { type: 'replace-parameter-schema'; parameterSchema: any[] }
  | { type: 'replace-operations'; operations: any[] };

export interface ObjectModelChangeSet {
  changeSetVersion: '1.0';
  baseRevision: string;
  changes: ObjectModelChange[];
}

export class ObjectModelChangeSetError extends TypeError {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ObjectModelChangeSetError';
  }
}

function fail(code: string, message: string): never {
  throw new ObjectModelChangeSetError(code, message);
}

function isRecord(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: any, path: string, state: { nodes: number }, depth = 0): void {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) fail('payload_too_large', 'ChangeSet JSON 节点数量超过限制');
  if (depth > MAX_JSON_DEPTH) fail('invalid_payload', path + ' 嵌套层级超过限制');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > MAX_CHANGE_SET_BYTES) fail('payload_too_large', path + ' 字符串过长');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_payload', path + ' 必须是有限数值');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, path + '[' + index + ']', state, depth + 1));
    return;
  }
  if (!isRecord(value)) fail('invalid_payload', path + ' 必须是 JSON 对象');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) fail('invalid_payload', path + ' 包含不安全字段');
    assertJsonValue(value[key], path + '.' + key, state, depth + 1);
  }
}

function cloneJson<T>(value: T, path: string): T {
  assertJsonValue(value, path, { nodes: 0 });
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('invalid_payload', path + ' 不是可序列化的 JSON 数据');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CHANGE_SET_BYTES) {
    fail('payload_too_large', path + ' 超过 512 KB');
  }
  return JSON.parse(serialized) as T;
}

function stableSerialize(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableSerialize(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** Stable SHA-256 revision over canonical JSON; object key order does not affect it. */
export function getObjectModelRevision(spec: unknown): string {
  const snapshot = cloneJson(spec, 'ObjectModelSpec');
  return createHash('sha256').update(stableSerialize(snapshot)).digest('hex');
}

function assertOnlyKeys(value: Record<string, any>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('invalid_change', label + ' 包含不支持的字段：' + key);
  }
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('invalid_change', label + ' 无效');
  return value;
}

function findComponentIndex(tree: any[], nodeId: string): number {
  const index = tree.findIndex(node => node.id === nodeId);
  if (index < 0) fail('target_not_found', '组件不存在：' + nodeId);
  return index;
}

function collectDescendantIds(tree: any[], rootId: string): Set<string> {
  const descendants = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of tree) {
      if (node.parent && descendants.has(node.parent) && !descendants.has(node.id)) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  return descendants;
}

function applyChange(spec: Record<string, any>, rawChange: any, affectedNodeIds: Set<string>, affectedMaterialIds: Set<string>) {
  if (!isRecord(rawChange) || typeof rawChange.type !== 'string') {
    fail('invalid_change', 'ChangeSet 每项必须包含 type');
  }

  switch (rawChange.type) {
    case 'add-component': {
      assertOnlyKeys(rawChange, ['type', 'component'], 'add-component');
      if (!isRecord(rawChange.component) || typeof rawChange.component.id !== 'string') {
        fail('invalid_change', 'add-component 必须提供完整 component 对象');
      }
      const nodeId = requireId(rawChange.component.id, 'component.id');
      if (spec.componentTree.some(node => node.id === nodeId)) fail('identity_conflict', '组件 ID 已存在：' + nodeId);
      if (!rawChange.component.parent || !spec.componentTree.some(node => node.id === rawChange.component.parent)) {
        fail('target_not_found', '新增组件必须引用当前存在的 parent：' + nodeId);
      }
      spec.componentTree.push(cloneJson(rawChange.component, 'component'));
      affectedNodeIds.add(nodeId);
      return;
    }
    case 'replace-component': {
      assertOnlyKeys(rawChange, ['type', 'nodeId', 'component'], 'replace-component');
      const nodeId = requireId(rawChange.nodeId, 'nodeId');
      if (!isRecord(rawChange.component) || rawChange.component.id !== nodeId) {
        fail('identity_change_forbidden', 'replace-component 必须保留原组件 ID：' + nodeId);
      }
      const index = findComponentIndex(spec.componentTree, nodeId);
      spec.componentTree[index] = cloneJson(rawChange.component, 'component');
      affectedNodeIds.add(nodeId);
      return;
    }
    case 'remove-component': {
      assertOnlyKeys(rawChange, ['type', 'nodeId', 'cascade'], 'remove-component');
      const nodeId = requireId(rawChange.nodeId, 'nodeId');
      const index = findComponentIndex(spec.componentTree, nodeId);
      if (spec.componentTree[index].parent === undefined || spec.componentTree[index].parent === null || spec.componentTree[index].parent === '') {
        fail('root_removal_forbidden', 'ChangeSet 不允许删除主体根节点：' + nodeId);
      }
      if (rawChange.cascade !== undefined && typeof rawChange.cascade !== 'boolean') {
        fail('invalid_change', 'remove-component.cascade 必须是布尔值');
      }
      const descendants = collectDescendantIds(spec.componentTree, nodeId);
      if (descendants.size > 1 && rawChange.cascade !== true) {
        fail('dependency_conflict', '组件仍包含子节点，必须显式声明 cascade=true：' + nodeId);
      }
      spec.componentTree = spec.componentTree.filter(node => !descendants.has(node.id));
      descendants.forEach(id => affectedNodeIds.add(id));
      return;
    }
    case 'upsert-material': {
      assertOnlyKeys(rawChange, ['type', 'materialId', 'material'], 'upsert-material');
      const materialId = requireId(rawChange.materialId, 'materialId');
      if (!isRecord(rawChange.material)) fail('invalid_change', 'upsert-material.material 必须是 JSON 对象');
      spec.materials = spec.materials || {};
      spec.materials[materialId] = cloneJson(rawChange.material, 'material');
      affectedMaterialIds.add(materialId);
      return;
    }
    case 'remove-material': {
      assertOnlyKeys(rawChange, ['type', 'materialId'], 'remove-material');
      const materialId = requireId(rawChange.materialId, 'materialId');
      if (!Object.prototype.hasOwnProperty.call(spec.materials || {}, materialId)) {
        fail('target_not_found', '材质不存在：' + materialId);
      }
      if (spec.componentTree.some(node => node.material === materialId)) {
        fail('dependency_conflict', '材质仍被组件引用，不能删除：' + materialId);
      }
      delete spec.materials[materialId];
      affectedMaterialIds.add(materialId);
      return;
    }
    case 'replace-parameter-schema': {
      assertOnlyKeys(rawChange, ['type', 'parameterSchema'], 'replace-parameter-schema');
      if (!Array.isArray(rawChange.parameterSchema) || rawChange.parameterSchema.length > 100) {
        fail('invalid_change', 'parameterSchema 必须是最多 100 项的数组');
      }
      spec.parameterSchema = cloneJson(rawChange.parameterSchema, 'parameterSchema');
      return;
    }
    case 'replace-operations': {
      assertOnlyKeys(rawChange, ['type', 'operations'], 'replace-operations');
      if (!Array.isArray(rawChange.operations) || rawChange.operations.length > 40) {
        fail('invalid_change', 'operations 必须是最多 40 项的数组');
      }
      spec.operations = cloneJson(rawChange.operations, 'operations');
      return;
    }
    default:
      fail('unsupported_operation', '不支持的 ChangeSet 操作：' + rawChange.type);
  }
}

/**
 * Apply a declarative ChangeSet atomically.
 * The caller must persist only the returned candidate after this function succeeds.
 */
export function applyObjectModelChangeSet(baseSpecInput: unknown, changeSetInput: unknown) {
  const baseSpec = cloneJson(baseSpecInput, 'baseSpec');
  try {
    validateObjectModelSpecV3(baseSpec);
  } catch (error) {
    fail('invalid_baseline', error instanceof Error ? error.message : '基线 ObjectModelSpec 无效');
  }

  const changeSet = cloneJson(changeSetInput, 'changeSet') as any;
  if (!isRecord(changeSet) || changeSet.changeSetVersion !== CHANGE_SET_VERSION
    || typeof changeSet.baseRevision !== 'string' || !/^[a-f0-9]{64}$/.test(changeSet.baseRevision)
    || !Array.isArray(changeSet.changes) || changeSet.changes.length < 1 || changeSet.changes.length > MAX_CHANGES) {
    fail('invalid_change_set', 'ObjectModelChangeSet 1.0 格式无效');
  }
  assertOnlyKeys(changeSet, ['changeSetVersion', 'baseRevision', 'changes'], 'ObjectModelChangeSet');

  const actualRevision = getObjectModelRevision(baseSpec);
  if (actualRevision !== changeSet.baseRevision) {
    fail('stale_base_revision', 'ChangeSet 基线版本已过期，请基于最新 ObjectModelSpec 重新生成变更');
  }

  const candidate = cloneJson(baseSpec, 'candidate');
  const affectedNodeIds = new Set<string>();
  const affectedMaterialIds = new Set<string>();
  let parameterSchemaChanged = false;
  let operationsChanged = false;

  for (const change of changeSet.changes) {
    if (change?.type === 'replace-parameter-schema') parameterSchemaChanged = true;
    if (change?.type === 'replace-operations') operationsChanged = true;
    applyChange(candidate, change, affectedNodeIds, affectedMaterialIds);
  }

  try {
    validateObjectModelSpecV3(candidate);
  } catch (error) {
    fail('invalid_result', error instanceof Error ? error.message : 'ChangeSet 执行结果未通过 ObjectModelSpec 校验');
  }

  return {
    objectModelSpec: candidate,
    revision: getObjectModelRevision(candidate),
    baseRevision: actualRevision,
    appliedChangeCount: changeSet.changes.length,
    affectedNodeIds: [...affectedNodeIds],
    affectedMaterialIds: [...affectedMaterialIds],
    parameterSchemaChanged,
    operationsChanged,
  };
}
