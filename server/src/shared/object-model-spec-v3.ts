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


const GEOMETRY_POINT_MIN = -0.5;
const GEOMETRY_POINT_MAX = 0.5;
function geometryPoint(value: any, size: number, min = GEOMETRY_POINT_MIN, max = GEOMETRY_POINT_MAX) {
  return Array.isArray(value) && value.length === size
    && value.every(item => Number.isFinite(Number(item)) && Number(item) >= min && Number(item) <= max);
}
function geometryFail(node: any, field: string, reason: string): never {
  fail('组件几何描述符无效：' + node.id + '.geometryDescriptor.' + field + ' ' + reason);
}
function geometryCross(a: number[], b: number[], c: number[]) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function geometrySegmentsIntersect(a: number[], b: number[], c: number[], d: number[]) {
  const eps = 1e-6;
  const onSegment = (p: number[], q: number[], r: number[]) => Math.abs(geometryCross(p, q, r)) < eps
    && r[0] >= Math.min(p[0], q[0]) - eps && r[0] <= Math.max(p[0], q[0]) + eps
    && r[1] >= Math.min(p[1], q[1]) - eps && r[1] <= Math.max(p[1], q[1]) + eps;
  const abC = geometryCross(a, b, c), abD = geometryCross(a, b, d);
  const cdA = geometryCross(c, d, a), cdB = geometryCross(c, d, b);
  if (((abC > eps && abD < -eps) || (abC < -eps && abD > eps))
    && ((cdA > eps && cdB < -eps) || (cdA < -eps && cdB > eps))) return true;
  return (Math.abs(abC) < eps && onSegment(a, b, c))
    || (Math.abs(abD) < eps && onSegment(a, b, d))
    || (Math.abs(cdA) < eps && onSegment(c, d, a))
    || (Math.abs(cdB) < eps && onSegment(c, d, b));
}
function validateSimpleGeometryProfile(points: number[][], node: any, field: string) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index], next = points[(index + 1) % points.length];
    if (Math.hypot(current[0] - next[0], current[1] - next[1]) < 1e-4) geometryFail(node, field, '不能包含重复点或零长度边');
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (geometrySegmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) {
        geometryFail(node, field, '存在自相交边（轮廓不能自相交）');
      }
    }
  }
  if (Math.abs(twiceArea) < 1e-4) geometryFail(node, field, '轮廓面积不能为零');
  return Math.sign(twiceArea);
}
function validateGeometryPath(path: any[], node: any, field: string, enforceCurvature = false) {
  for (let index = 1; index < path.length; index += 1) {
    const distance = Math.hypot(...path[index].map((value: number, axis: number) => value - path[index - 1][axis]));
    if (distance < 1e-4) geometryFail(node, field, '存在重复或零长度路径段');
  }
  if (!enforceCurvature) return;
  for (let index = 1; index < path.length - 1; index += 1) {
    const incoming = path[index].map((value: number, axis: number) => value - path[index - 1][axis]);
    const outgoing = path[index + 1].map((value: number, axis: number) => value - path[index][axis]);
    const dot = incoming.reduce((sum: number, value: number, axis: number) => sum + value * outgoing[axis], 0);
    const cosine = dot / (Math.hypot(...incoming) * Math.hypot(...outgoing));
    if (Math.acos(Math.max(-1, Math.min(1, cosine))) > Math.PI * 150 / 180) {
      geometryFail(node, field, '存在超过 150° 的急转弯，可能导致扫掠截面翻转或自相交');
    }
  }
}
function validateGeometryDescriptor(node: any) {
  if ((node.kind || 'mesh') !== 'mesh') return;
  const primitive = String(node.primitive || '').toLowerCase();
  const descriptor = node.geometryDescriptor ?? {};
  if (!isRecord(descriptor)) geometryFail(node, '', '必须是对象');
  if (primitive === 'polygon') {
    const points = descriptor.points;
    if (!Array.isArray(points) || points.length < 3 || points.length > 32 || !points.every((point: any) => geometryPoint(point, 2))) {
      geometryFail(node, 'points', '必须包含 3-32 个 [-0.5,0.5] 范围内的二维坐标');
    }
    validateSimpleGeometryProfile(points.map((point: number[]) => point.map(Number)), node, 'points');
  } else if (primitive === 'tube' || primitive === 'sweep') {
    const path = descriptor.path;
    if (!Array.isArray(path) || path.length < 2 || path.length > 32 || !path.every((point: any) => geometryPoint(point, 3))) {
      geometryFail(node, 'path', '必须包含 2-32 个必须是 [-0.5,0.5] 范围内的三维坐标');
    }
    validateGeometryPath(path.map((point: number[]) => point.map(Number)), node, 'path', primitive === 'sweep');
    if (descriptor.radius !== undefined && descriptor.radius !== null
      && (!Number.isFinite(Number(descriptor.radius)) || Number(descriptor.radius) < 0.01 || Number(descriptor.radius) > 10)) {
      geometryFail(node, 'radius', '必须是 0.01-10 范围内的有限数值');
    }
    if (primitive === 'tube') {
      const tubularSegments = Number(descriptor.tubularSegments ?? 32);
      const radialSegments = Number(descriptor.radialSegments ?? 8);
      if (!Number.isInteger(tubularSegments) || tubularSegments < 3 || tubularSegments > 128
        || !Number.isInteger(radialSegments) || radialSegments < 3 || radialSegments > 24
        || (descriptor.closed !== undefined && typeof descriptor.closed !== 'boolean')) {
        geometryFail(node, 'segments', 'tubularSegments 必须为 3-128、radialSegments 必须为 3-24，closed 必须为布尔值');
      }
    } else {
      if (descriptor.closed === true) geometryFail(node, 'closed', '暂不支持闭合扫掠路径');
      if (!Array.isArray(descriptor.profile) || descriptor.profile.length < 3 || descriptor.profile.length > 24
        || !descriptor.profile.every((point: any) => geometryPoint(point, 2))) {
        geometryFail(node, 'profile', '必须是 [-0.5,0.5] 范围内的二维坐标，且包含 3-24 个合法截面点');
      }
      validateSimpleGeometryProfile(descriptor.profile.map((point: number[]) => point.map(Number)), node, 'profile');
      const steps = Number(descriptor.steps ?? 32);
      if (!Number.isInteger(steps) || steps < 3 || steps > 128) geometryFail(node, 'steps', '必须是 3-128 的整数');
    }
  } else if (primitive === 'lathe') {
    const profile = descriptor.profile;
    if (!Array.isArray(profile) || profile.length < 2 || profile.length > 32
      || !profile.every((point: any) => Array.isArray(point) && point.length === 2
        && Number.isFinite(Number(point[0])) && Number(point[0]) >= 0 && Number(point[0]) <= 0.5
        && Number.isFinite(Number(point[1])) && Number(point[1]) >= -0.5 && Number(point[1]) <= 0.5)) {
      geometryFail(node, 'profile', '必须是 [0,0.5] 半径与 [-0.5,0.5] 高度范围内的 2-32 个归一化点');
    }
    if (profile.some((point: number[], index: number) => index > 0
      && Math.hypot(Number(point[0]) - Number(profile[index - 1][0]), Number(point[1]) - Number(profile[index - 1][1])) < 1e-4)) {
      geometryFail(node, 'profile', '不能包含重复或零长度轮廓段');
    }
  } else if (primitive === 'loft') {
    const sections = descriptor.sections;
    if (!Array.isArray(sections) || sections.length < 2 || sections.length > 12) geometryFail(node, 'sections', '必须包含 2-12 个截面');
    let pointCount = 0, previousHeight = -Infinity, orientation = 0;
    sections.forEach((section: any, index: number) => {
      if (!isRecord(section) || !Number.isFinite(Number(section.height)) || Number(section.height) < -0.5 || Number(section.height) > 0.5
        || !Array.isArray(section.points) || section.points.length < 3 || section.points.length > 24
        || !section.points.every((point: any) => geometryPoint(point, 2))) {
        geometryFail(node, 'sections[' + index + ']', '截面结构或坐标无效');
      }
      if (index === 0) pointCount = section.points.length;
      if (section.points.length !== pointCount || Number(section.height) <= previousHeight + 1e-4) {
        geometryFail(node, 'sections', '所有截面必须具有相同数量的轮廓点，且 height 必须严格递增');
      }
      const currentOrientation = validateSimpleGeometryProfile(section.points.map((point: number[]) => point.map(Number)), node, 'sections[' + index + '].points');
      if (orientation && currentOrientation !== orientation) geometryFail(node, 'sections', '所有截面必须保持一致的轮廓绕序');
      orientation = currentOrientation;
      previousHeight = Number(section.height);
    });
  }
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
      validateGeometryDescriptor(node);
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

  const roots = spec.componentTree.filter((node: any) => node.parent === undefined || node.parent === null || node.parent === '');
  if (roots.length !== 1) fail('ObjectModelSpec 必须只有一个主体根节点');

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
