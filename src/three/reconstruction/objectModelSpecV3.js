/**
 * ObjectModelSpec 3.0 declarative operation compiler.
 *
 * Operations describe data and bounded expression trees. They never execute
 * model-authored JavaScript. The compiler expands instance operations into the
 * component tree consumed by the Three.js geometry adapter.
 */
const MAX_COMPONENTS = 300;
const MAX_OPERATIONS = 40;
const MAX_INSTANCES_PER_OPERATION = 100;
const MAX_EXPRESSION_DEPTH = 16;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 10000) {
    throw new RangeError(label + ' must be a finite bounded number');
  }
  return number;
}

function evaluateExpression(expression, context, depth = 0) {
  if (depth > MAX_EXPRESSION_DEPTH) throw new RangeError('表达式嵌套层级超限');
  if (typeof expression === 'number') return finite(expression, 'expression');
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) {
    throw new TypeError('表达式节点格式无效');
  }
  switch (expression.op) {
    case 'constant': return finite(expression.value, 'constant');
    case 'parameter': {
      const value = context.parameters.get(expression.id);
      if (value === undefined) throw new TypeError('表达式引用了不存在的参数：' + expression.id);
      return finite(value, 'parameter ' + expression.id);
    }
    case 'index': return context.index;
    case 'count': return context.count;
    case 'add': return evaluateExpression(expression.left, context, depth + 1) + evaluateExpression(expression.right, context, depth + 1);
    case 'subtract': return evaluateExpression(expression.left, context, depth + 1) - evaluateExpression(expression.right, context, depth + 1);
    case 'multiply': return evaluateExpression(expression.left, context, depth + 1) * evaluateExpression(expression.right, context, depth + 1);
    case 'divide': {
      const divisor = evaluateExpression(expression.right, context, depth + 1);
      if (Math.abs(divisor) < 1e-9) throw new RangeError('表达式除数不能为零');
      return evaluateExpression(expression.left, context, depth + 1) / divisor;
    }
    case 'sin': return Math.sin(evaluateExpression(expression.value, context, depth + 1));
    case 'cos': return Math.cos(evaluateExpression(expression.value, context, depth + 1));
    case 'negate': return -evaluateExpression(expression.value, context, depth + 1);
    default: throw new TypeError('不支持的表达式运算：' + expression.op);
  }
}

function collectSubtree(nodes, rootId) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (!byId.has(rootId)) throw new TypeError('实例化源节点不存在：' + rootId);
  const subtree = nodes.filter(node => {
    let current = node;
    while (current) {
      if (current.id === rootId) return true;
      current = current.parent ? byId.get(current.parent) : null;
    }
    return false;
  });
  if (!subtree.length) throw new TypeError('实例化源子树为空：' + rootId);
  return subtree;
}

function stableId(operationId, index, sourceId) {
  let hash = 2166136261;
  const value = operationId + ':' + index + ':' + sourceId;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'op-' + (hash >>> 0).toString(36);
}

/**
 * Convert ObjectModelSpec 3.0 into the normalized component tree expected by
 * the geometry backend. The first instance keeps source IDs; generated
 * instances receive deterministic IDs so saves and rebuilds are reproducible.
 */
export function compileObjectModelSpec(spec) {
  if (!spec || spec.schemaVersion !== '3.0') throw new TypeError('ObjectModelSpec 3.0 无效');
  if (!Array.isArray(spec.componentTree) || spec.componentTree.length < 1 || spec.componentTree.length > MAX_COMPONENTS) {
    throw new RangeError('componentTree 数量必须在 1 到 ' + MAX_COMPONENTS + ' 之间');
  }
  const operations = spec.operations || [];
  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS) throw new RangeError('operations 数量超限');
  const parameters = new Map((spec.parameterSchema || []).map(item => [item.id, item.value]));
  const sourceNodes = spec.componentTree;
  const operationRoots = new Set();
  const claimedSourceNodes = new Set();
  let estimatedCount = sourceNodes.length;
  const expanded = sourceNodes.map(node => JSON.parse(JSON.stringify(node)));
  for (const operation of operations) {
    if (!operation || operation.type !== 'instance' || typeof operation.id !== 'string' || !operation.id) {
      throw new TypeError('操作定义无效：仅接受声明式 instance 操作');
    }
    if (operationRoots.has(operation.sourceRootId)) throw new TypeError('多个操作不能重复占用同一源子树：' + operation.sourceRootId);
    operationRoots.add(operation.sourceRootId);
    const sourceRoot = sourceNodes.find(node => node.id === operation.sourceRootId);
    if (!sourceRoot || (sourceRoot.kind || 'mesh') !== 'group') throw new TypeError('instance 源节点必须是 Group：' + operation.id);
    const subtree = collectSubtree(sourceNodes, operation.sourceRootId);
    for (const node of subtree) {
      if (claimedSourceNodes.has(node.id)) throw new TypeError('instance 操作的源子树不能重叠：' + operation.id);
      claimedSourceNodes.add(node.id);
    }
    const countParameter = parameters.get(operation.count?.parameterId);
    const countDefinition = (spec.parameterSchema || []).find(item => item.id === operation.count?.parameterId);
    if (!countDefinition || countDefinition.type !== 'number' || !Number.isInteger(Number(countParameter))) {
      throw new TypeError('instance count 必须绑定整数数值参数：' + operation.id);
    }
    const min = Number(countDefinition.min), max = Number(countDefinition.max);
    const count = Number(countParameter);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > MAX_INSTANCES_PER_OPERATION || count < min || count > max) {
      throw new RangeError('instance 数量参数范围无效：' + operation.id);
    }
    estimatedCount += subtree.length * (max - 1);
    if (estimatedCount > MAX_COMPONENTS) throw new RangeError('展开后的组件数量超过 ' + MAX_COMPONENTS);
    const transform = operation.transform || {};
    const evaluateVector = (values, fallback, context, label) => {
      const source = Array.isArray(values) ? values : fallback;
      if (!Array.isArray(source) || source.length !== 3) throw new TypeError(label + ' 必须是三维表达式数组');
      return source.map((value, axis) => finite(evaluateExpression(value, context), label + '[' + axis + ']'));
    };
    for (let index = 0; index < count; index += 1) {
      const context = { index, count, parameters };
      const isPrototype = index === 0;
      const idMap = new Map(subtree.map(node => [node.id, isPrototype ? node.id : stableId(operation.id, index, node.id)]));
      const position = evaluateVector(transform.position, [0, 0, 0], context, 'transform.position');
      const rotation = evaluateVector(transform.rotation, [0, 0, 0], context, 'transform.rotation');
      const scale = evaluateVector(transform.scale, [1, 1, 1], context, 'transform.scale');
      if (scale.some(value => Math.abs(value) < 0.001 || Math.abs(value) > 20)) throw new RangeError('实例缩放超出允许范围：' + operation.id);
      for (const source of subtree) {
        const clone = JSON.parse(JSON.stringify(source));
        clone.id = idMap.get(source.id);
        if (source.id === operation.sourceRootId) {
          clone.parent = sourceRoot.parent || undefined;
          clone.transform = clone.transform || {};
          const basePosition = Array.isArray(clone.transform.position) ? clone.transform.position : [0, 0, 0];
          const baseRotation = Array.isArray(clone.transform.rotation) ? clone.transform.rotation : [0, 0, 0];
          const baseScale = Array.isArray(clone.transform.scale) ? clone.transform.scale : [1, 1, 1];
          clone.transform.position = position.map((value, axis) => Number(basePosition[axis] || 0) + value);
          clone.transform.rotation = rotation.map((value, axis) => Number(baseRotation[axis] || 0) + value);
          clone.transform.scale = scale.map((value, axis) => Number(baseScale[axis] ?? 1) * value);
        } else {
          clone.parent = idMap.get(source.parent);
        }
        if (!isPrototype) clone.operationInstance = { operationId: operation.id, index, sourceNodeId: source.id };
        expanded.push(clone);
      }
    }
  }
  const excluded = node => {
    let current = node;
    while (current) {
      if (operationRoots.has(current.id)) return true;
      current = current.parent ? sourceNodes.find(item => item.id === current.parent) : null;
    }
    return false;
  };
  const staticNodes = sourceNodes.filter(node => !excluded(node));
  const generatedNodes = expanded.filter(node => node.operationInstance);
  const prototypeNodes = sourceNodes.filter(node => {
    if (!operationRoots.size) return true;
    return !excluded(node);
  });
  // Keep the original prototype only as the first instance; append all generated
  // clones. Static nodes outside operation source subtrees remain untouched.
  const generatedIds = new Set(generatedNodes.map(node => node.id));
  const resultNodes = [
    ...staticNodes.map(node => JSON.parse(JSON.stringify(node))),
    ...sourceNodes.filter(node => operationRoots.has(node.id)).flatMap(root => collectSubtree(sourceNodes, root.id)),
    ...generatedNodes,
  ];
  // Remove duplicate source subtrees from the static prefix while preserving order.
  const seen = new Set();
  const componentTree = resultNodes.filter(node => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
  const operationParameterIds = new Set(operations.map(operation => operation.count?.parameterId));
  const collectExpressionParameters = expression => {
    if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return;
    if (expression.op === 'parameter' && typeof expression.id === 'string') operationParameterIds.add(expression.id);
    collectExpressionParameters(expression.left);
    collectExpressionParameters(expression.right);
    collectExpressionParameters(expression.value);
  };
  for (const operation of operations) {
    for (const vector of [operation.transform?.position, operation.transform?.rotation, operation.transform?.scale]) {
      if (Array.isArray(vector)) vector.forEach(collectExpressionParameters);
    }
  }
  const parameterSchema = (spec.parameterSchema || []).map(parameter => operationParameterIds.has(parameter.id)
    ? { ...parameter, generatorControl: true }
    : parameter);
  return {
    ...spec,
    schemaVersion: '2.0',
    componentTree,
    parameterSchema,
    generators: [],
    constraints: [],
    operations: undefined,
  };
}

export function isObjectModelSpecV3(value) {
  return Boolean(value && typeof value === 'object' && value.schemaVersion === '3.0');
}
