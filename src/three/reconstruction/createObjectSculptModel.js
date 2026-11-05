/**
 * Bounded ObjectSculptSpec -> Three.js runtime adapter.
 *
 * This is the first integration seam for img2threejs-style component-tree specs.
 * It interprets declarative geometry only; it never evaluates model-generated JavaScript.
 */
const MAX_COMPONENTS = 300;
const MAX_GENERATORS = 30;
function stableGeneratedIdHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function expandObjectSculptSpec(spec) {
  const generators = Array.isArray(spec.generators) ? spec.generators : [];
  if (!generators.length) return { ...spec, componentTree: [...spec.componentTree] };
  const sourceNodes = spec.componentTree;
  const byId = new Map(sourceNodes.map(node => [node.id, node]));
  const generatorParameterIds = new Set();
  for (const generator of generators) {
    if (generator.type === 'repeat') generatorParameterIds.add(generator.countParameterId);
    if (generator.type === 'grid') {
      generatorParameterIds.add(generator.rowParameterId);
      generatorParameterIds.add(generator.columnParameterId);
    }
  }
  const isInTemplate = node => generators.some(generator => {
    let parent = node.id;
    while (parent) {
      if (parent === generator.templateRootId) return true;
      parent = byId.get(parent)?.parent;
    }
    return false;
  });
  const expanded = sourceNodes.filter(node => !isInTemplate(node)).map(node => JSON.parse(JSON.stringify(node)));
  for (const generator of generators) {
    const rootNode = byId.get(generator.templateRootId);
    const subtree = sourceNodes.filter(node => {
      let parent = node.id;
      while (parent) {
        if (parent === generator.templateRootId) return true;
        parent = byId.get(parent)?.parent;
      }
      return false;
    });
    if (!rootNode || !subtree.length) throw new TypeError('结构生成器模板节点不存在：' + generator.id);
    const parameterValue = id => Number((spec.parameterSchema || []).find(item => item.id === id)?.value);
    const materialize = (row, column, offsetX, offsetY, offsetZ) => {
      const isPrototype = row === 0 && column === 0;
      const suffix = generator.type === 'grid' ? row + '-' + column : String(row);
      const idMap = new Map(subtree.map(node => [node.id, isPrototype
        ? node.id
        : 'generated-' + stableGeneratedIdHash(generator.id) + '-' + suffix + '-' + stableGeneratedIdHash(node.id)]));
      for (const source of subtree) {
        const clone = JSON.parse(JSON.stringify(source));
        clone.id = idMap.get(source.id);
        if (source.id === rootNode.id) {
          clone.parent = rootNode.parent || undefined;
          clone.transform = clone.transform || {};
          const position = Array.isArray(clone.transform.position) ? [...clone.transform.position] : [0, 0, 0];
          position[0] = Number(position[0] || 0) + offsetX;
          position[1] = Number(position[1] || 0) + offsetY;
          position[2] = Number(position[2] || 0) + offsetZ;
          clone.transform.position = position;
        } else {
          clone.parent = idMap.get(source.parent);
        }
        if (!isPrototype) clone.generatorInstance = { generatorId: generator.id, row, column, sourceNodeId: source.id };
        expanded.push(clone);
      }
    };
    if (generator.type === 'repeat') {
      const count = Math.max(1, Math.min(generator.maxCount, Math.round(parameterValue(generator.countParameterId) || generator.defaultCount)));
      const baseCount = Number(generator.defaultCount);
      for (const follower of generator.followers || []) {
        const followerNode = expanded.find(node => node.id === follower.nodeId);
        if (!followerNode) throw new TypeError('结构生成器跟随节点不存在：' + follower.nodeId);
        followerNode.transform = followerNode.transform || {};
        const position = Array.isArray(followerNode.transform.position) ? [...followerNode.transform.position] : [0, 0, 0];
        const axisIndex = 'xyz'.indexOf(follower.axis);
        position[axisIndex] = Number(position[axisIndex] || 0) + generator.spacing * (count - baseCount) + Number(follower.offset || 0);
        followerNode.transform.position = position;
      }
      for (let index = 0; index < count; index += 1) {
        const offset = generator.spacing * index;
        materialize(index, 0, generator.axis === 'x' ? offset : 0, generator.axis === 'y' ? offset : 0, generator.axis === 'z' ? offset : 0);
      }
    } else if (generator.type === 'grid') {
      const rows = Math.max(1, Math.min(generator.maxRows, Math.round(parameterValue(generator.rowParameterId) || generator.defaultRows)));
      const columns = Math.max(1, Math.min(generator.maxColumns, Math.round(parameterValue(generator.columnParameterId) || generator.defaultColumns)));
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          materialize(row, column, generator.spacingX * column, 0, generator.spacingZ * row);
        }
      }
    } else {
      throw new TypeError('不支持的结构生成器类型：' + generator.type);
    }
  }
  // 统一约束引擎：只读取生成器规模与基准节点，不执行模型提供的代码。
  const generatorMetrics = new Map();
  const readGeneratorParameter = id => Number((spec.parameterSchema || []).find(item => item.id === id)?.value);
  for (const generator of generators) {
    if (generator.type === 'grid') {
      const rows = Math.max(1, Math.min(generator.maxRows, Math.round(readGeneratorParameter(generator.rowParameterId) || generator.defaultRows)));
      const columns = Math.max(1, Math.min(generator.maxColumns, Math.round(readGeneratorParameter(generator.columnParameterId) || generator.defaultColumns)));
      generatorMetrics.set(generator.id, { rows, columns, repeatCount: 1, spacingX: generator.spacingX, spacingZ: generator.spacingZ });
    } else if (generator.type === 'repeat') {
      const count = Math.max(1, Math.min(generator.maxCount, Math.round(readGeneratorParameter(generator.countParameterId) || generator.defaultCount)));
      generatorMetrics.set(generator.id, { rows: 1, columns: 1, repeatCount: count, spacing: generator.spacing, axis: generator.axis });
    }
  }
  const constraints = Array.isArray(spec.constraints) ? spec.constraints : [];
  const constrainedNodes = new Set();
  for (const constraint of constraints) {
    const metric = generatorMetrics.get(constraint.sourceGeneratorId);
    const target = expanded.find(node => node.id === constraint.targetNodeId);
    if (!metric || !target) throw new TypeError('结构约束引用了不存在的生成器或组件：' + constraint.id);
    const key = constraint.targetNodeId + ':' + constraint.type + ':' + (constraint.property || constraint.axis);
    if (constrainedNodes.has(key)) throw new TypeError('结构约束重复管理同一目标：' + constraint.id);
    constrainedNodes.add(key);
    if (constraint.type === 'adjacency') {
      const sourceNode = expanded.find(node => node.id === constraint.sourceNodeId);
      const targetNode = expanded.find(node => node.id === constraint.targetNodeId);
      sourceNode.relations = [...(sourceNode.relations || []), { id: constraint.id, type: 'adjacency', relation: constraint.relation, nodeId: targetNode.id }];
      targetNode.relations = [...(targetNode.relations || []), { id: constraint.id, type: 'adjacency', relation: constraint.relation, nodeId: sourceNode.id }];
      continue;
    }
    if (constraint.type === 'attach') {
      const sourceNode = expanded.find(node => node.id === constraint.sourceNodeId);
      const targetNode = expanded.find(node => node.id === constraint.targetNodeId);
      const axisIndex = 'xyz'.indexOf(constraint.axis);
      const dimensionKey = ['width','height','depth'][axisIndex];
      const sourcePosition = sourceNode.transform?.position || [0, 0, 0];
      const targetPosition = targetNode.transform?.position || [0, 0, 0];
      const sourceHalf = Number(sourceNode.dimensions?.[dimensionKey] || 1) * Math.abs(Number(sourceNode.transform?.scale?.[axisIndex] ?? 1)) / 2;
      const targetHalf = Number(targetNode.dimensions?.[dimensionKey] || 1) * Math.abs(Number(targetNode.transform?.scale?.[axisIndex] ?? 1)) / 2;
      targetNode.transform = targetNode.transform || {};
      const nextPosition = [...targetPosition];
      nextPosition[axisIndex] = Number(sourcePosition[axisIndex] || 0)
        + Number(constraint.sourceSide) * sourceHalf - Number(constraint.targetSide) * targetHalf + Number(constraint.offset || 0);
      targetNode.transform.position = nextPosition;
      sourceNode.relations = [...(sourceNode.relations || []), { id: constraint.id, type: 'attach', nodeId: targetNode.id, axis: constraint.axis }];
      targetNode.relations = [...(targetNode.relations || []), { id: constraint.id, type: 'attach', nodeId: sourceNode.id, axis: constraint.axis }];
      continue;
    }
    target.transform = target.transform || {};
    const position = Array.isArray(target.transform.position) ? [...target.transform.position] : [0, 0, 0];
    const axisIndex = 'xyz'.indexOf(constraint.axis);
    if (constraint.type === 'follow') {
      let distance = 0;
      if (metric.rows > 1 || metric.columns > 1) {
        distance = constraint.measure === 'rows'
          ? Math.max(0, metric.rows - 1) * metric.spacingZ
          : Math.max(0, metric.columns - 1) * metric.spacingX;
      } else if (metric.repeatCount > 1) {
        distance = Math.max(0, metric.repeatCount - 1) * metric.spacing;
      }
      position[axisIndex] = Number(position[axisIndex] || 0) + distance * Number(constraint.factor ?? 1) + Number(constraint.offset ?? 0);
      target.transform.position = position;
    } else if (constraint.type === 'span') {
      const dimension = constraint.property.slice('dimensions.'.length);
      target.dimensions = target.dimensions || {};
      let distance = 0;
      if (metric.rows > 1 || metric.columns > 1) {
        distance = constraint.measure === 'rows'
          ? Math.max(0, metric.rows - 1) * metric.spacingZ
          : Math.max(0, metric.columns - 1) * metric.spacingX;
      } else if (metric.repeatCount > 1) {
        distance = Math.max(0, metric.repeatCount - 1) * metric.spacing;
      }
      target.dimensions[dimension] = Number(target.dimensions[dimension]) + distance * Number(constraint.factor ?? 1) + Number(constraint.offset ?? 0);
    }
  }
  if (expanded.length > MAX_COMPONENTS) throw new RangeError('动态生成后的组件数量超过 ' + MAX_COMPONENTS);
  return { ...spec, componentTree: expanded, generators: [], constraints: [], parameterSchema: (spec.parameterSchema || []).map(parameter => generatorParameterIds.has(parameter.id) ? { ...parameter, generatorControl: true } : parameter) };
}

const MAX_HIERARCHY_DEPTH = 16;
const MAX_DIMENSION = 100;
const MAX_SEGMENTS = 48;
const DEFAULT_MATERIAL = Object.freeze({ color: '#b8b8b8', roughness: 0.82, metalness: 0 });

function finiteVector(value, fallback, label) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => !Number.isFinite(Number(item)))) {
    throw new TypeError(label + ' 必须是三个有限数值');
  }
  return value.map(Number);
}

function boundedNumber(value, fallback, min, max, label) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(label + ' 超出允许范围');
  }
  return number;
}

function normalizeMaterial(THREE, source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) source = DEFAULT_MATERIAL;
  const color = typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color)
    ? source.color : DEFAULT_MATERIAL.color;
  const roughness = boundedNumber(source.roughness, DEFAULT_MATERIAL.roughness, 0, 1, '材质 roughness');
  const metalness = boundedNumber(source.metalness, DEFAULT_MATERIAL.metalness, 0, 1, '材质 metalness');
  const opacity = boundedNumber(source.opacity, 1, 0.05, 1, '材质 opacity');
  return new THREE.MeshStandardMaterial({
    color, roughness, metalness, opacity,
    transparent: opacity < 1,
  });
}

export function createPolygonOutlineGeometry(THREE,points,width,height,depth,segments=16){if(!Array.isArray(points)||points.length<3||points.length>32)throw new RangeError('polygon points 必须包含 3 到 32 个轮廓点');points.forEach((point,index)=>{if(!Array.isArray(point)||point.length!==2||point.some(value=>!Number.isFinite(Number(value))||Number(value)<-.5||Number(value)>.5))throw new TypeError('polygon points['+index+'] 必须位于 [-0.5,0.5]')});const area=points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+Number(point[0])*Number(next[1])-Number(next[0])*Number(point[1])},0)/2;if(Math.abs(area)<.0001)throw new RangeError('polygon 轮廓面积不能为零');const shape=new THREE.Shape();shape.moveTo(Number(points[0][0])*width,Number(points[0][1])*height);for(const point of points.slice(1))shape.lineTo(Number(point[0])*width,Number(point[1])*height);shape.closePath();const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:segments});geometry.translate(0,0,-depth/2);return geometry}
function createGeometry(THREE, node) {
  const dimensions = node.dimensions || {};
  const width = boundedNumber(dimensions.width, 1, 0.02, MAX_DIMENSION, node.id + '.width');
  const height = boundedNumber(dimensions.height, 1, 0.02, MAX_DIMENSION, node.id + '.height');
  const depth = boundedNumber(dimensions.depth, 1, 0.02, MAX_DIMENSION, node.id + '.depth');
  const descriptor = node.geometryDescriptor || {};
  const segments = Math.round(boundedNumber(descriptor.segments, 16, 3, MAX_SEGMENTS, node.id + '.segments'));

  switch (String(node.primitive || 'box').toLowerCase()) {
    case 'polygon': {
      const points = descriptor.points;
      if (!Array.isArray(points) || points.length < 3 || points.length > 32) throw new RangeError(node.id + '.points 必须包含 3 到 32 个轮廓点');
      const normalized = points.map((point, index) => {
        if (!Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5)) {
          throw new TypeError(node.id + '.points[' + index + '] 必须是 [-0.5,0.5] 范围内的二维坐标');
        }
        return [Number(point[0]) * width, Number(point[1]) * height];
      });
      const area = normalized.reduce((sum, point, index) => {
        const next = normalized[(index + 1) % normalized.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0) / 2;
      if (Math.abs(area) < 0.0001) throw new RangeError(node.id + '.points 轮廓面积不能为零');
      const shape = new THREE.Shape();
      shape.moveTo(normalized[0][0], normalized[0][1]);
      for (const point of normalized.slice(1)) shape.lineTo(point[0], point[1]);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
      geometry.translate(0, 0, -depth / 2);
      return geometry;
    }
    case 'wedge': {
      const shape = new THREE.Shape();
      shape.moveTo(-width / 2, -height / 2);
      shape.lineTo(width / 2, -height / 2);
      shape.lineTo(0, height / 2);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
      geometry.translate(0, 0, -depth / 2);
      return geometry;
    }
    case 'arch': {
      const shape = new THREE.Shape();
      const spring = height * 0.08;
      shape.moveTo(-width / 2, -height / 2);
      shape.lineTo(-width / 2, spring);
      shape.quadraticCurveTo(-width / 2, height / 2, 0, height / 2);
      shape.quadraticCurveTo(width / 2, height / 2, width / 2, spring);
      shape.lineTo(width / 2, -height / 2);
      shape.closePath();
      const inset = boundedNumber(descriptor.inset, Math.min(width, height) * 0.12, 0.02, Math.min(width, height) * 0.4, node.id + '.inset');
      const opening = new THREE.Path();
      opening.moveTo(-width / 2 + inset, -height / 2);
      opening.lineTo(-width / 2 + inset, spring);
      opening.quadraticCurveTo(-width / 2 + inset, height / 2 - inset, 0, height / 2 - inset);
      opening.quadraticCurveTo(width / 2 - inset, height / 2 - inset, width / 2 - inset, spring);
      opening.lineTo(width / 2 - inset, -height / 2);
      opening.closePath();
      shape.holes.push(opening);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: segments });
      geometry.translate(0, 0, -depth / 2);
      return geometry;
    }
    case 'box':
    case 'cuboid':
      return new THREE.BoxGeometry(width, height, depth);
    case 'cylinder':
      return new THREE.CylinderGeometry(width / 2, depth / 2, height, segments);
    case 'cone':
      return new THREE.ConeGeometry(Math.max(width, depth) / 2, height, segments);
    case 'sphere':
    case 'ellipsoid': {
      const geometry = new THREE.SphereGeometry(0.5, segments, Math.max(4, Math.floor(segments * 0.66)));
      geometry.scale(width, height, depth);
      return geometry;
    }
    case 'torus': {
      const radius = Math.max(width, depth) / 2;
      const tube = boundedNumber(descriptor.tube, Math.min(width, depth) * 0.12, 0.01, radius * 0.45, node.id + '.tube');
      return new THREE.TorusGeometry(radius - tube, tube, Math.min(16, segments), segments);
    }
    default:
      throw new TypeError('不支持的重建几何 primitive：' + node.primitive);
  }
}

/**
 * Validate the transferable, renderer-independent subset of ObjectSculptSpec.
 * The upstream spec may contain richer fields; this adapter intentionally consumes only
 * a bounded subset and preserves the original spec outside the runtime object.
 */
export function validateObjectSculptSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('ObjectSculptSpec 必须是 JSON 对象');
  if (![1, 2, '2.0', '2.0.0'].includes(spec.schemaVersion)) throw new TypeError('ObjectSculptSpec schemaVersion 不受支持');
  if (!Array.isArray(spec.componentTree) || spec.componentTree.length < 1 || spec.componentTree.length > MAX_COMPONENTS) {
    throw new RangeError('componentTree 数量必须在 1 到 ' + MAX_COMPONENTS + ' 之间');
  }
  const ids = new Set();
  const nodes = new Map();
  for (const node of spec.componentTree) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new TypeError('组件节点必须是对象');
    if (typeof node.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(node.id)) throw new TypeError('组件 id 无效');
    if (ids.has(node.id)) throw new TypeError('组件 id 重复：' + node.id);
    ids.add(node.id);
    nodes.set(node.id, node);
    const kind = node.kind || 'mesh';
    if (!['group', 'mesh'].includes(kind)) throw new TypeError('组件 kind 无效：' + node.id);
    if (kind === 'mesh') {
      if (typeof node.primitive !== 'string' || !node.primitive) throw new TypeError('Mesh 组件缺少 primitive：' + node.id);
      if (!node.dimensions || typeof node.dimensions !== 'object') throw new TypeError('Mesh 组件缺少 dimensions：' + node.id);
    }
    finiteVector(node.transform?.position, [0, 0, 0], node.id + '.position');
    finiteVector(node.transform?.rotation, [0, 0, 0], node.id + '.rotation');
    finiteVector(node.transform?.scale, [1, 1, 1], node.id + '.scale');
  }
  for (const node of spec.componentTree) {
    if (node.parent !== undefined && node.parent !== null && !nodes.has(node.parent)) {
      throw new TypeError('组件父节点不存在：' + node.id + ' -> ' + node.parent);
    }
    const visited = new Set([node.id]);
    let parent = node.parent;
    let depth = 1;
    while (parent !== undefined && parent !== null) {
      if (visited.has(parent)) throw new TypeError('组件层级存在循环引用：' + node.id);
      visited.add(parent);
      depth += 1;
      if (depth > MAX_HIERARCHY_DEPTH) throw new RangeError('组件层级超过 ' + MAX_HIERARCHY_DEPTH + ' 层');
      parent = nodes.get(parent)?.parent;
    }
  }

  if (spec.generators !== undefined && (!Array.isArray(spec.generators) || spec.generators.length > MAX_GENERATORS)) {
    throw new RangeError('generators 最多允许 ' + MAX_GENERATORS + ' 项');
  }
  if (spec.constraints !== undefined && (!Array.isArray(spec.constraints) || spec.constraints.length > 60)) {
    throw new RangeError('constraints 最多允许 60 项');
  }
  const generatorIds = new Set();
  const generatorParameterIds = new Set();
  const generatorTemplateNodeIds = new Set();
  let estimatedExpandedCount = spec.componentTree.length;
  for (const generator of spec.generators || []) {
    if (!generator || typeof generator !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(generator.id || '') || generatorIds.has(generator.id)) {
      throw new TypeError('结构生成器 ID 无效或重复');
    }
    generatorIds.add(generator.id);
    if (!['repeat','grid'].includes(generator.type) || !nodes.has(generator.templateRootId)) throw new TypeError('结构生成器类型或模板节点无效：' + generator.id);
    const parameterIsValid = (id, max) => {
      const parameter = (spec.parameterSchema || []).find(item => item.id === id);
      return parameter && parameter.type === 'number' && Number.isInteger(parameter.min) && Number.isInteger(parameter.max)
        && Number.isInteger(parameter.value) && parameter.min >= 1 && parameter.max <= max && parameter.value >= parameter.min && parameter.value <= parameter.max;
    };
    if (generator.type === 'repeat') {
      if (!['x','y','z'].includes(generator.axis) || !Number.isFinite(generator.spacing) || Math.abs(generator.spacing) > 100
        || !Number.isInteger(generator.maxCount) || generator.maxCount < 1 || generator.maxCount > 100
        || !Number.isInteger(generator.defaultCount) || generator.defaultCount < 1 || generator.defaultCount > generator.maxCount
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(generator.countParameterId || '')
        || !parameterIsValid(generator.countParameterId, generator.maxCount)) throw new TypeError('结构生成器排列规则或数量参数无效：' + generator.id);
      generatorParameterIds.add(generator.countParameterId);
    } else {
      if (generator.rowParameterId === generator.columnParameterId) throw new TypeError('网格生成器行列参数不能相同：' + generator.id);
      if (![generator.spacingX, generator.spacingZ].every(value => Number.isFinite(value) && Math.abs(value) <= 100)
        || !Number.isInteger(generator.maxRows) || generator.maxRows < 1 || generator.maxRows > 100
        || !Number.isInteger(generator.maxColumns) || generator.maxColumns < 1 || generator.maxColumns > 100
        || !Number.isInteger(generator.defaultRows) || generator.defaultRows < 1 || generator.defaultRows > generator.maxRows
        || !Number.isInteger(generator.defaultColumns) || generator.defaultColumns < 1 || generator.defaultColumns > generator.maxColumns
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(generator.rowParameterId || '')
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(generator.columnParameterId || '')
        || !parameterIsValid(generator.rowParameterId, generator.maxRows)
        || !parameterIsValid(generator.columnParameterId, generator.maxColumns)) throw new TypeError('网格生成器排列规则或行列参数无效：' + generator.id);
      generatorParameterIds.add(generator.rowParameterId);
      generatorParameterIds.add(generator.columnParameterId);
    }
    const descendants = spec.componentTree.filter(node => {
      let parent = node.id;
      while (parent) {
        if (parent === generator.templateRootId) return true;
        parent = nodes.get(parent)?.parent;
      }
      return false;
    });
    if (!descendants.length) throw new RangeError('结构生成器模板子树为空：' + generator.id);
    for (const descendant of descendants) {
      if (generatorTemplateNodeIds.has(descendant.id)) throw new TypeError('暂不支持嵌套或重叠的结构生成器模板：' + generator.id);
      generatorTemplateNodeIds.add(descendant.id);
    }
    const maximumInstances = generator.type === 'repeat' ? generator.maxCount : generator.maxRows * generator.maxColumns;
    estimatedExpandedCount += descendants.length * (maximumInstances - 1);
    if (estimatedExpandedCount > MAX_COMPONENTS) throw new RangeError('结构生成器最大展开数量超过 ' + MAX_COMPONENTS);
    if (generator.type === 'repeat' && generator.followers !== undefined && (!Array.isArray(generator.followers) || generator.followers.length > 30)) throw new TypeError('结构生成器 followers 无效：' + generator.id);
    if (generator.type === 'grid' && (generator.maxRows * generator.maxColumns > MAX_COMPONENTS || generator.maxRows * generator.maxColumns * descendants.length > MAX_COMPONENTS)) throw new RangeError('网格生成器最大展开数量超出限制：' + generator.id);
    for (const follower of generator.type === 'repeat' ? generator.followers || [] : []) {
      const followerNode = nodes.get(follower.nodeId);
      let parent = follower.nodeId, insideTemplate = false;
      while (parent) { if (parent === generator.templateRootId) { insideTemplate = true; break; } parent = nodes.get(parent)?.parent; }
      if (!followerNode || insideTemplate || !['x','y','z'].includes(follower.axis) || !Number.isFinite(follower.offset ?? 0)) throw new TypeError('结构生成器跟随规则无效：' + generator.id);
    }
  }
  const constraintIds = new Set();
  const managedConstraintTargets = new Set();
  for (const constraint of spec.constraints || []) {
    if (!constraint || typeof constraint !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(constraint.id || '')
      || constraintIds.has(constraint.id)) throw new TypeError('结构约束 ID 无效或重复');
    constraintIds.add(constraint.id);
    if (!['follow','span','attach','adjacency'].includes(constraint.type)) throw new TypeError('结构约束类型无效：' + constraint.id);
    if (constraint.type === 'follow' || constraint.type === 'span') {
      if (!generatorIds.has(constraint.sourceGeneratorId) || !nodes.has(constraint.targetNodeId)
        || generatorTemplateNodeIds.has(constraint.targetNodeId) || !['x','y','z'].includes(constraint.axis)) {
        throw new TypeError('结构约束引用无效：' + constraint.id);
      }
      const sourceGenerator = (spec.generators || []).find(item => item.id === constraint.sourceGeneratorId);
      const expectedAxis = { 'dimensions.width': 'x', 'dimensions.height': 'y', 'dimensions.depth': 'z' }[constraint.property];
      if (!['rows','columns','repeat'].includes(constraint.measure || 'repeat')
        || (sourceGenerator?.type === 'grid' && !['rows','columns'].includes(constraint.measure))
        || (sourceGenerator?.type === 'repeat' && constraint.measure !== 'repeat')
        || (constraint.type === 'span' && (!['dimensions.width','dimensions.height','dimensions.depth'].includes(constraint.property)
          || expectedAxis !== constraint.axis || nodes.get(constraint.targetNodeId).kind === 'group'))
        || (constraint.type === 'follow' && constraint.property !== undefined)
        || !Number.isFinite(Number(constraint.factor ?? 1)) || Math.abs(Number(constraint.factor ?? 1)) > 10
        || !Number.isFinite(Number(constraint.offset ?? 0)) || Math.abs(Number(constraint.offset ?? 0)) > 100) {
        throw new TypeError('结构约束规则无效：' + constraint.id);
      }
    } else {
      const source = nodes.get(constraint.sourceNodeId), target = nodes.get(constraint.targetNodeId);
      if (!source || !target || source.id === target.id || generatorTemplateNodeIds.has(source.id) || generatorTemplateNodeIds.has(target.id)) {
        throw new TypeError('组件连接关系引用无效：' + constraint.id);
      }
      if (constraint.type === 'attach') {
        if ((source.kind || 'mesh') !== 'mesh' || (target.kind || 'mesh') !== 'mesh'
          || source.parent !== target.parent || !['x','y','z'].includes(constraint.axis)
          || ![-1,1].includes(Number(constraint.sourceSide)) || ![-1,1].includes(Number(constraint.targetSide))
          || !Number.isFinite(Number(constraint.offset ?? 0)) || Math.abs(Number(constraint.offset ?? 0)) > 100) {
          throw new TypeError('attach 必须连接同一父级下的 Mesh 面：' + constraint.id);
        }
      } else if (!['adjacent','connects'].includes(constraint.relation)) {
        throw new TypeError('adjacency relation 无效：' + constraint.id);
      }
    }
    const targetKey = constraint.targetNodeId + ':' + constraint.type + ':' + (constraint.property || constraint.axis || constraint.sourceNodeId);
    if (managedConstraintTargets.has(targetKey)) throw new TypeError('结构约束重复管理同一目标：' + constraint.id);
    managedConstraintTargets.add(targetKey);
  }
  const parameterIds = new Set();
  if (spec.parameterSchema !== undefined && (!Array.isArray(spec.parameterSchema) || spec.parameterSchema.length > 100)) {
    throw new RangeError('parameterSchema 最多允许 100 个参数');
  }
  for (const parameter of spec.parameterSchema || []) {
    if (!parameter || typeof parameter !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(parameter.id || '') || parameterIds.has(parameter.id)) {
      throw new TypeError('参数 ID 无效或重复');
    }
    parameterIds.add(parameter.id);
    if (!['number','color','boolean','select'].includes(parameter.type)) throw new TypeError('参数类型不受支持：' + parameter.type);
    if (parameter.type === 'number') {
      if (!Number.isFinite(parameter.value) || !Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) || parameter.min > parameter.max || parameter.value < parameter.min || parameter.value > parameter.max) {
        throw new RangeError('参数数值或范围无效：' + parameter.id);
      }
    } else if (parameter.type === 'color' && (typeof parameter.value !== 'string' || !/^#[0-9a-f]{6}$/i.test(parameter.value))) {
      throw new TypeError('颜色参数无效：' + parameter.id);
    } else if (parameter.type === 'boolean' && typeof parameter.value !== 'boolean') {
      throw new TypeError('布尔参数无效：' + parameter.id);
    } else if (parameter.type === 'select' && (!Array.isArray(parameter.options) || !parameter.options.some(option => option.value === parameter.value))) {
      throw new TypeError('枚举参数无效：' + parameter.id);
    }
    if (!Array.isArray(parameter.targets) || parameter.targets.length > 100 || (parameter.targets.length < 1 && !generatorParameterIds.has(parameter.id) && parameter.generatorControl !== true)) throw new TypeError('参数目标无效：' + parameter.id);
    for (const target of parameter.targets) {
      if (!nodes.has(target.nodeId)) throw new TypeError('参数目标组件不存在：' + target.nodeId);
      if (nodes.get(target.nodeId).kind === 'group' && !target.property.startsWith('transform.') && target.property !== 'visibility.visible') throw new TypeError('Group 节点仅支持变换和显隐参数：' + target.nodeId);
      if (!['dimensions.width','dimensions.height','dimensions.depth','transform.position.x','transform.position.y','transform.position.z','transform.scale.x','transform.scale.y','transform.scale.z','material.color','material.roughness','material.metalness','material.opacity','geometry.primitive','geometryDescriptor.inset','geometryDescriptor.tube','visibility.visible'].includes(target.property)) {
        throw new TypeError('参数目标属性不受支持：' + target.property);
      }
      if (!['set','multiply','add','visible-from','visible-through'].includes(target.mode || 'set')) throw new TypeError('参数目标运算不受支持：' + target.mode);
      if (target.property.startsWith('material.') && target.mode !== 'set') throw new TypeError('材质参数仅支持 set');
      if (['visible-from','visible-through'].includes(target.mode) && target.property !== 'visibility.visible') throw new TypeError('可见性阈值运算只能用于 visibility.visible');
      if (target.property === 'visibility.visible' && !['set','visible-from','visible-through'].includes(target.mode || 'set')) throw new TypeError('可见性参数运算无效');
      if (target.property === 'geometry.primitive' && !['set'].includes(target.mode || 'set')) throw new TypeError('几何类型参数仅支持 set');
    }
  }
  return { nodes, componentCount: nodes.size };
}

/**
 * Build a real THREE.Group from a validated component tree.
 * Material keys resolve through spec.materials; missing keys use a neutral fallback.
 */
export function createObjectSculptModel(THREE, spec, options = {}) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.MeshStandardMaterial) {
    throw new TypeError('Three.js runtime is required');
  }
  validateObjectSculptSpec(spec);
  const renderSpec = expandObjectSculptSpec(spec);
  const validation = validateObjectSculptSpec(renderSpec);
  const root = new THREE.Group();
  root.name = String(spec.targetName || spec.name || 'reconstructed-object').slice(0, 120);
  const groups = new Map();
  const materialSpecs = renderSpec.materials && typeof renderSpec.materials === 'object' ? renderSpec.materials : {};
  const resolveMaterial = key => {
    const materialKey = typeof key === 'string' ? key : 'default';
    return normalizeMaterial(THREE, Object.prototype.hasOwnProperty.call(materialSpecs, materialKey) ? materialSpecs[materialKey] : DEFAULT_MATERIAL);
  };
  const ordered = [...renderSpec.componentTree].sort((a, b) => {
    const depth = node => {
      let value = 0, parent = node.parent;
      while (parent) { value += 1; parent = validation.nodes.get(parent)?.parent; }
      return value;
    };
    return depth(a) - depth(b);
  });
  for (const node of ordered) {
    const group = new THREE.Group();
    group.name = String(node.name || node.id).slice(0, 120);
    group.userData.componentId = node.id;
    group.userData.componentSourceId = node.generatorInstance?.sourceNodeId || node.id;
    group.userData.componentRole = String(node.role || 'component').slice(0, 80);
    group.userData.componentRelations = Array.isArray(node.relations) ? JSON.parse(JSON.stringify(node.relations)) : [];
    group.userData.componentHidden = node.hidden === true;
    group.userData.componentLocked = node.locked === true;
    group.visible = node.hidden !== true;
    if ((node.kind || 'mesh') === 'mesh') {
      const geometry = createGeometry(THREE, node);
      const mesh = new THREE.Mesh(geometry, resolveMaterial(node.material));
      mesh.name = node.id + ':mesh';
      mesh.userData.componentId = node.id;
      mesh.userData.componentSourceId = node.generatorInstance?.sourceNodeId || node.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.userData.componentKind = node.kind || 'mesh';
    const [px, py, pz] = finiteVector(node.transform?.position, [0, 0, 0], node.id + '.position');
    const [rx, ry, rz] = finiteVector(node.transform?.rotation, [0, 0, 0], node.id + '.rotation');
    const [sx, sy, sz] = finiteVector(node.transform?.scale, [1, 1, 1], node.id + '.scale');
    if ([sx, sy, sz].some(value => Math.abs(value) < 0.001 || Math.abs(value) > 20)) {
      throw new RangeError(node.id + '.scale 超出允许范围');
    }
    group.position.set(px, py, pz);
    group.rotation.set(rx, ry, rz);
    group.scale.set(sx, sy, sz);
    const parent = node.parent ? groups.get(node.parent) : root;
    if (!parent) throw new TypeError('组件父节点尚未构建：' + node.id);
    parent.add(group);
    groups.set(node.id, group);
  }
  root.userData.componentGroups = groups;
  root.userData.objectSculptSpec = JSON.parse(JSON.stringify(spec));
  root.userData.parameterBaseSpec = JSON.parse(JSON.stringify(spec));
  root.userData.objectSculpt = {
    schemaVersion: spec.schemaVersion,
    targetName: root.name,
    componentCount: validation.componentCount,
    source: options.source || 'object-sculpt-spec',
  };
  return root;
}


/**
 * Apply one AI-declared parameter through a bounded property binding list.
 * Every edit starts from the immutable baseline spec to avoid cumulative drift.
 */
export function applyObjectSculptParameter(THREE, root, parameterId, nextValue) {
  if (!root?.userData?.parameterBaseSpec || !root.userData?.componentGroups) throw new TypeError('目标不是可编辑的 ObjectSculpt 资产');
  const baseline = root.userData.parameterBaseSpec;
  const parameter = (baseline.parameterSchema || []).find(item => item.id === parameterId);
  if (!parameter) throw new TypeError('未声明可编辑参数：' + parameterId);
  let value = nextValue;
  if (parameter.type === 'number') {
    value = Number(value);
    if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) throw new RangeError('参数值超出范围：' + parameterId);
  } else if (parameter.type === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('颜色参数格式无效：' + parameterId);
  } else if (parameter.type === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError('布尔参数格式无效：' + parameterId);
  } else if (parameter.type === 'select' && !parameter.options.some(option => option.value === value)) {
    throw new TypeError('枚举参数值无效：' + parameterId);
  }
  const activeSchema = root.userData.objectSculptSpec?.parameterSchema || baseline.parameterSchema || [];
  const activeValues = new Map(activeSchema.map(item => [item.id, item.value]));
  activeValues.set(parameterId, value);
  const spec = JSON.parse(JSON.stringify(baseline));
  const findNode = id => spec.componentTree.find(node => node.id === id);
  for (const currentParameter of spec.parameterSchema || []) {
    const parameterValue = activeValues.has(currentParameter.id) ? activeValues.get(currentParameter.id) : currentParameter.value;
    currentParameter.value = parameterValue;
    for (const target of currentParameter.targets) {
      const node = findNode(target.nodeId);
      if (!node) continue;
      const mode = target.mode || 'set';
      let current;
      if (target.property.startsWith('material.')) {
        const field = target.property.split('.')[1];
        current = spec.materials[node.material]?.[field];
      } else if (target.property.startsWith('transform.position.') || target.property.startsWith('transform.scale.')) {
        const [, vector, axis] = target.property.split('.');
        current = node.transform?.[vector]?.['xyz'.indexOf(axis)] ?? (vector === 'scale' ? 1 : 0);
      } else {
        const [section, field] = target.property.split('.');
        current = node[section]?.[field];
      }
      const resolved = mode === 'multiply' ? Number(current) * Number(parameterValue)
        : mode === 'add' ? Number(current) + Number(parameterValue) : parameterValue;
      if (target.property === 'visibility.visible') {
        const threshold = Number(target.threshold ?? 1);
        if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) throw new RangeError('可见性阈值无效：' + currentParameter.id);
        node.hidden = mode === 'visible-from' ? Number(parameterValue) < threshold
          : mode === 'visible-through' ? Number(parameterValue) > threshold
            : !Boolean(parameterValue);
      } else if (target.property === 'geometry.primitive') {
        if (!['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus'].includes(String(resolved))) throw new TypeError('参数指定了不支持的几何类型');
        node.primitive = resolved;
      } else if (target.property === 'geometryDescriptor.inset' || target.property === 'geometryDescriptor.tube') {
        node.geometryDescriptor = node.geometryDescriptor || {};
        node.geometryDescriptor[target.property.split('.')[1]] = Number(resolved);
      } else if (target.property.startsWith('material.')) {
        const previousMaterial = spec.materials[node.material] || DEFAULT_MATERIAL;
        const uniqueKey = 'parameter-' + node.id;
        if (node.material !== uniqueKey) spec.materials[uniqueKey] = { ...previousMaterial };
        node.material = uniqueKey;
        const field = target.property.split('.')[1];
        if (field === 'color') spec.materials[uniqueKey].color = resolved;
        else spec.materials[uniqueKey][field] = Math.max(field === 'opacity' ? 0.05 : 0, Math.min(1, Number(resolved)));
      } else if (target.property.startsWith('transform.position.') || target.property.startsWith('transform.scale.')) {
        const [, vector, axis] = target.property.split('.');
        const index = 'xyz'.indexOf(axis);
        node.transform = node.transform || {};
        node.transform[vector] = node.transform[vector] || (vector === 'scale' ? [1,1,1] : [0,0,0]);
        node.transform[vector][index] = Number(resolved);
      } else {
        const [section, field] = target.property.split('.');
        node[section][field] = Math.max(0.02, Math.min(100, Number(resolved)));
      }
    }
  }
  const renderSpec = expandObjectSculptSpec(spec);
  const rebuilt = createObjectSculptModel(THREE, renderSpec, { source: 'object-sculpt-parameter' });
  for (const child of [...root.children]) {
    root.remove(child);
    child.traverse?.(item => {
      item.geometry?.dispose?.();
      if (Array.isArray(item.material)) item.material.forEach(material => material.dispose?.());
      else item.material?.dispose?.();
    });
  }
  for (const child of [...rebuilt.children]) root.add(child);
  root.userData = {
    ...root.userData,
    ...rebuilt.userData,
    objectSculptSpec: spec,
    parameterBaseSpec: baseline,
  };
  return spec;
}
