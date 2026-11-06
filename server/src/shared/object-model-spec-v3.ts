/**
 * Canonical ObjectModelSpec 3.0 structural validator.
 *
 * This module is intentionally runtime-neutral: the browser renderer, AI
 * generation pipeline, and asset persistence layer share the same protocol
 * invariants. Geometry construction still performs executor-specific checks.
 */
const MAX_COMPONENTS = 300;
const MAX_OPERATIONS = 40;
const MAX_PARAMETERS = 100;
const MAX_INSTANCES = 100;
const MAX_DEPTH = 16;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message: string) {
  throw new TypeError(message);
}

function isRecord(value: any) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateExpression(expression: any, parameterById: Map<string, any>, depth = 0) {
  if (depth > MAX_DEPTH) fail('表达式嵌套层级超过 16 层');
  if (typeof expression === 'number') {
    if (!Number.isFinite(expression) || Math.abs(expression) > 10000) fail('表达式常量超出范围');
    return;
  }
  if (!isRecord(expression)) fail('表达式节点格式无效');
  switch (expression.op) {
    case 'constant':
      if (!Number.isFinite(Number(expression.value)) || Math.abs(Number(expression.value)) > 10000) fail('表达式常量无效');
      return;
    case 'index':
    case 'count':
      return;
    case 'parameter':
      if (typeof expression.id !== 'string' || parameterById.get(expression.id)?.type !== 'number') {
        fail('空间表达式只能引用已声明的数值参数：' + String(expression.id));
      }
      return;
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      validateExpression(expression.left, parameterById, depth + 1);
      validateExpression(expression.right, parameterById, depth + 1);
      return;
    case 'sin':
    case 'cos':
    case 'negate':
      validateExpression(expression.value, parameterById, depth + 1);
      return;
    default:
      fail('表达式运算不受支持：' + String(expression.op));
  }
}

function resolveTargetKind(node: any, materials: Record<string, any>, property: any) {
  if (typeof property !== 'string' || property.length > 160) return null;
  const parts = property.split('.');
  if (parts.some(part => !/^(?:[a-zA-Z][a-zA-Z0-9_]{0,39}|0|[1-9][0-9]{0,2})$/.test(part) || FORBIDDEN_PATH_PARTS.has(part))) return null;
  if (property === 'visibility.visible') return 'boolean';
  if (property === 'geometry.primitive') return typeof node.primitive === 'string' ? 'select' : null;
  if (parts[0] === 'material' && parts.length === 2 && typeof node.material === 'string') {
    const material = materials[node.material];
    if (!isRecord(material) || !Object.prototype.hasOwnProperty.call(material, parts[1])) return null;
    const value = material[parts[1]];
    if (value === null || typeof value === 'object') return null;
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return 'color';
    return typeof value === 'number' && Number.isFinite(value) ? 'number' : typeof value;
  }
  if (parts[0] === 'transform' && ['position', 'rotation', 'scale'].includes(parts[1]) && parts.length === 3 && ['x', 'y', 'z'].includes(parts[2])) return 'number';
  if (!['dimensions', 'geometryDescriptor'].includes(parts[0]) || parts.length < 2 || parts.length > 4) return null;
  let value = node[parts[0]];
  for (const part of parts.slice(1)) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || index > 127) return null;
      value = value[index];
    } else {
      if (!Object.prototype.hasOwnProperty.call(value, part)) return null;
      value = value[part];
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return 'color';
  if (typeof value === 'string') return 'select';
  return null;
}

export function validateObjectModelSpecV3(spec: any) {
  if (!isRecord(spec) || spec.schemaVersion !== '3.0') fail('ObjectModelSpec 3.0 无效：仅接受 3.0 JSON 对象');
  if (Object.prototype.hasOwnProperty.call(spec, 'generators') || Object.prototype.hasOwnProperty.call(spec, 'constraints')) {
    fail('ObjectModelSpec 3.0 不接受 generators/constraints');
  }
  if (!Array.isArray(spec.componentTree) || spec.componentTree.length < 1 || spec.componentTree.length > MAX_COMPONENTS) {
    fail('componentTree 数量必须在 1 到 300 之间');
  }
  const materials = isRecord(spec.materials) ? spec.materials : {};
  const nodes = new Map();
  for (const node of spec.componentTree) {
    if (!isRecord(node) || typeof node.id !== 'string' || !ID_PATTERN.test(node.id)) fail('组件 id 无效：' + String(node?.id));
    if (nodes.has(node.id)) fail('组件 id 重复：' + node.id);
    const kind = node.kind || 'mesh';
    if (!['group', 'mesh'].includes(kind)) fail('组件 kind 无效：' + node.id);
    if (kind === 'mesh') {
      if (typeof node.primitive !== 'string' || !node.primitive) fail('Mesh 组件缺少 primitive：' + node.id);
      if (!isRecord(node.dimensions)) fail('Mesh 组件缺少 dimensions：' + node.id);
      for (const key of ['width', 'height', 'depth']) {
        const value = Number(node.dimensions[key]);
        if (!Number.isFinite(value) || value < 0.02 || value > 100) fail('组件尺寸超出允许范围：' + node.id + '.' + key);
      }
    }
    const transformKeys: Array<[string, number[]]> = [['position', [0, 0, 0]], ['rotation', [0, 0, 0]], ['scale', [1, 1, 1]]];
    for (const [key, fallback] of transformKeys) {
      const vector = node.transform?.[key] ?? fallback;
      if (!Array.isArray(vector) || vector.length !== 3 || vector.some(value => !Number.isFinite(Number(value)))) fail('组件 transform.' + key + ' 必须是三个有限数值：' + node.id);
    }
    nodes.set(node.id, node);
  }
  const roots = spec.componentTree.filter((node: any) => node.parent === undefined || node.parent === null || node.parent === '');
  if (roots.length !== 1) fail('ObjectModelSpec 必须只有一个主体根节点');
  for (const node of spec.componentTree) {
    if (node.parent !== undefined && node.parent !== null && node.parent !== '' && !nodes.has(node.parent)) fail('组件父节点不存在：' + node.id);
    const visited = new Set([node.id]);
    let parent = node.parent;
    let depth = 1;
    while (parent !== undefined && parent !== null && parent !== '') {
      if (visited.has(parent)) fail('组件层级存在循环引用：' + node.id);
      visited.add(parent);
      if (++depth > MAX_DEPTH) fail('组件层级超过 16 层');
      parent = nodes.get(parent)?.parent;
    }
  }

  const parameters = spec.parameterSchema ?? [];
  if (!Array.isArray(parameters) || parameters.length > MAX_PARAMETERS) fail('parameterSchema 最多允许 100 个参数');
  const parameterById = new Map();
  for (const parameter of parameters) {
    if (!isRecord(parameter) || typeof parameter.id !== 'string' || !ID_PATTERN.test(parameter.id) || parameterById.has(parameter.id)) fail('参数 ID 无效或重复');
    if (!['number', 'color', 'boolean', 'select'].includes(parameter.type)) fail('参数类型不受支持：' + parameter.id);
    if (parameter.type === 'number') {
      if (![parameter.value, parameter.min, parameter.max].every(Number.isFinite) || parameter.min > parameter.max || parameter.value < parameter.min || parameter.value > parameter.max) fail('参数数值或范围无效：' + parameter.id);
    } else if (parameter.type === 'color') {
      if (typeof parameter.value !== 'string' || !/^#[0-9a-f]{6}$/i.test(parameter.value)) fail('颜色参数无效：' + parameter.id);
    } else if (parameter.type === 'boolean') {
      if (typeof parameter.value !== 'boolean') fail('布尔参数无效：' + parameter.id);
    } else if (!Array.isArray(parameter.options) || !parameter.options.some((option: any) => option?.value === parameter.value)) {
      fail('枚举参数无效：' + parameter.id);
    }
    if (!Array.isArray(parameter.targets) || parameter.targets.length > 100) fail('参数 targets 格式无效：' + parameter.id);
    parameterById.set(parameter.id, parameter);
  }

  const operations = spec.operations ?? [];
  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS) fail('operations 数量超过 40 项');
  const operationIds = new Set();
  const operationRoots = new Set();
  const claimedNodes = new Set();
  let expandedCount = spec.componentTree.length;
  const subtreeFor = (rootId: string) => spec.componentTree.filter((node: any) => {
    let current = node;
    while (current) {
      if (current.id === rootId) return true;
      current = current.parent ? nodes.get(current.parent) : null;
    }
    return false;
  });
  for (const operation of operations) {
    if (!isRecord(operation) || operation.type !== 'instance' || typeof operation.id !== 'string' || !ID_PATTERN.test(operation.id) || operationIds.has(operation.id)) fail('instance operation ID 或类型无效');
    operationIds.add(operation.id);
    const root = nodes.get(operation.sourceRootId);
    if (!root || (root.kind || 'mesh') !== 'group' || operationRoots.has(root.id)) fail('instance 源节点必须是唯一 Group：' + operation.id);
    operationRoots.add(root.id);
    const subtree = subtreeFor(root.id);
    if (!subtree.length) fail('instance 源子树为空：' + operation.id);
    for (const node of subtree) {
      if (claimedNodes.has(node.id)) fail('instance 源子树不能重叠：' + operation.id);
      claimedNodes.add(node.id);
    }
    const countParameter = parameterById.get(operation.count?.parameterId);
    if (!countParameter || countParameter.type !== 'number' || !Number.isInteger(countParameter.value) || !Number.isInteger(countParameter.min) || !Number.isInteger(countParameter.max)
      || countParameter.min < 1 || countParameter.max > MAX_INSTANCES || countParameter.value < countParameter.min || countParameter.value > countParameter.max) {
      fail('instance 必须绑定 1-100 范围内的整数数量参数：' + operation.id);
    }
    expandedCount += subtree.length * (countParameter.max - 1);
    if (expandedCount > MAX_COMPONENTS) fail('operations 最大展开组件数量超过 300：' + operation.id);
    const transform = operation.transform || {};
    const operationTransformKeys: Array<[string, number[]]> = [['position', [0, 0, 0]], ['rotation', [0, 0, 0]], ['scale', [1, 1, 1]]];
    for (const [key, fallback] of operationTransformKeys) {
      const vector = transform[key] ?? fallback;
      if (!Array.isArray(vector) || vector.length !== 3) fail('instance transform.' + key + ' 必须是三维表达式数组：' + operation.id);
      vector.forEach((value: any) => validateExpression(value, parameterById));
    }
  }

  const operationParameterIds = new Set();
  for (const operation of operations) {
    operationParameterIds.add(operation.count.parameterId);
    const collect = (expression: any) => {
      if (!isRecord(expression)) return;
      if (expression.op === 'parameter') operationParameterIds.add(expression.id);
      collect(expression.left);
      collect(expression.right);
      collect(expression.value);
    };
    for (const key of ['position', 'rotation', 'scale']) (operation.transform?.[key] || []).forEach(collect);
  }
  for (const parameter of parameters) {
    if (!parameter.targets.length && parameter.operationControl !== true && !operationParameterIds.has(parameter.id)) fail('参数没有有效目标：' + parameter.id);
    for (const target of parameter.targets) {
      const node = nodes.get(target?.nodeId);
      if (!node) fail('参数目标组件不存在：' + String(target?.nodeId));
      if ((node.kind || 'mesh') === 'group' && !String(target.property || '').startsWith('transform.') && target.property !== 'visibility.visible') fail('Group 节点仅支持变换和显隐参数：' + node.id);
      const kind = resolveTargetKind(node, materials, target.property);
      const visibilityThreshold = target.property === 'visibility.visible' && ['visible-from', 'visible-through'].includes(target.mode);
      if (!kind) fail('参数目标属性不受支持或不存在：' + parameter.id + '.' + target.property);
      if (parameter.type !== kind && !(parameter.type === 'number' && visibilityThreshold)) fail('参数类型与目标属性的数据类型不匹配：' + parameter.id + '.' + target.property);
      const mode = target.mode || 'set';
      if (!['set', 'multiply', 'add', 'visible-from', 'visible-through'].includes(mode)) fail('参数目标运算不受支持：' + parameter.id);
      if (target.property.startsWith('material.') && mode !== 'set') fail('材质参数仅支持 set：' + parameter.id);
      if (['visible-from', 'visible-through'].includes(mode) && (target.property !== 'visibility.visible' || !Number.isFinite(target.threshold) || target.threshold < 1 || target.threshold > 100)) fail('可见性阈值参数无效：' + parameter.id);
      if (target.property === 'visibility.visible' && !['set', 'visible-from', 'visible-through'].includes(mode)) fail('可见性参数运算无效：' + parameter.id);
      if (target.property === 'geometry.primitive' && mode !== 'set') fail('几何类型参数仅支持 set：' + parameter.id);
    }
  }
  return { nodes, parameterById, componentCount: nodes.size, expandedComponentCount: expandedCount };
}
