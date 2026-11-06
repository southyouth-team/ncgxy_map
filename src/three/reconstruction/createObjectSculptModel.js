import { compileObjectModelSpec } from './objectModelSpecV3.js';
/**
 * Bounded ObjectSculptSpec -> Three.js runtime adapter.
 *
 * This is the first integration seam for img2threejs-style component-tree specs.
 * It interprets declarative geometry only; it never evaluates model-generated JavaScript.
 */
const MAX_COMPONENTS = 300;
function resolveEditableParameterTarget(node, materials, property) {
  if (!node || typeof property !== 'string' || property.length > 160) return null;
  const parts = property.split('.');
  if (parts.some(part => !/^(?:[a-zA-Z][a-zA-Z0-9_]{0,39}|0|[1-9][0-9]{0,2})$/.test(part) || ['__proto__','prototype','constructor'].includes(part))) return null;
  if (property === 'visibility.visible') return { value: node.hidden !== true, kind: 'boolean' };
  if (property === 'geometry.primitive') return typeof node.primitive === 'string' ? { value: node.primitive, kind: 'select' } : null;
  const root = parts[0];
  if (root === 'material' && parts.length === 2 && typeof node.material === 'string') {
    const material = materials?.[node.material];
    if (!material || !Object.prototype.hasOwnProperty.call(material, parts[1])) return null;
    const value = material[parts[1]];
    if (value === null || typeof value === 'object') return null;
    return { value, kind: typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? 'color' : typeof value };
  }
  if (root === 'transform' && ['position','rotation','scale'].includes(parts[1]) && parts.length === 3 && ['x','y','z'].includes(parts[2])) {
    const index = 'xyz'.indexOf(parts[2]);
    const value = node.transform?.[parts[1]]?.[index] ?? (parts[1] === 'scale' ? 1 : 0);
    return Number.isFinite(Number(value)) ? { value: Number(value), kind: 'number' } : null;
  }
  if (!['dimensions','geometryDescriptor'].includes(root) || parts.length < 2 || parts.length > 4) return null;
  let value = node[root];
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
  if (value === null || typeof value === 'object') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return { value, kind: 'number' };
  if (typeof value === 'boolean') return { value, kind: 'boolean' };
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return { value, kind: 'color' };
  if (typeof value === 'string') return { value, kind: 'select' };
  return null;
}

function setEditableParameterTarget(node, materials, property, value) {
  const parts = property.split('.');
  if (parts[0] === 'material') {
    const material = materials[node.material];
    material[parts[1]] = value;
    return;
  }
  if (parts[0] === 'transform') {
    const index = 'xyz'.indexOf(parts[2]);
    node.transform = node.transform || {};
    node.transform[parts[1]] = node.transform[parts[1]] || (parts[1] === 'scale' ? [1,1,1] : [0,0,0]);
    node.transform[parts[1]][index] = value;
    return;
  }
  let target = node[parts[0]];
  for (const part of parts.slice(1, -1)) target = target[part];
  target[parts[parts.length - 1]] = value;
}

export function validateObjectSculptSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('ObjectSculptSpec 必须是 JSON 对象');
  if (spec.schemaVersion !== '3.0') throw new TypeError('仅支持 ObjectModelSpec 3.0');
  if (Object.prototype.hasOwnProperty.call(spec, 'generators') || Object.prototype.hasOwnProperty.call(spec, 'constraints')) throw new TypeError('ObjectModelSpec 3.0 不接受 generators/constraints');
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
    if (!Array.isArray(parameter.targets) || parameter.targets.length > 100 || (parameter.targets.length < 1 && parameter.operationControl !== true)) throw new TypeError('参数目标无效：' + parameter.id);
    for (const target of parameter.targets) {
      if (!nodes.has(target.nodeId)) throw new TypeError('参数目标组件不存在：' + target.nodeId);
      if (nodes.get(target.nodeId).kind === 'group' && !target.property.startsWith('transform.') && target.property !== 'visibility.visible') throw new TypeError('Group 节点仅支持变换和显隐参数：' + target.nodeId);
      const binding = resolveEditableParameterTarget(nodes.get(target.nodeId), spec.materials || {}, target.property);
      if (!binding) throw new TypeError('参数目标属性不受支持或不存在、不可编辑或不是标量：' + target.property);
      const visibilityThreshold = target.property === 'visibility.visible' && ['visible-from','visible-through'].includes(target.mode);
      if (parameter.type === 'number' && binding.kind !== 'number' && !visibilityThreshold
        || parameter.type === 'color' && binding.kind !== 'color'
        || parameter.type === 'boolean' && binding.kind !== 'boolean'
        || parameter.type === 'select' && binding.kind !== 'select') throw new TypeError('参数类型与目标属性的数据类型不匹配：' + target.property);
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
  // 3.0 is the canonical declarative protocol. Compile it into the bounded
  // component-tree execution form only at the runtime adapter boundary.
  const effectiveSpec = compileObjectModelSpec(spec);
  validateObjectSculptSpec(effectiveSpec);
  const renderSpec = effectiveSpec;
  const validation = validateObjectSculptSpec(renderSpec);
  const root = new THREE.Group();
  root.name = String(effectiveSpec.targetName || effectiveSpec.name || 'reconstructed-object').slice(0, 120);
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
    group.userData.componentSourceId = node.operationInstance?.sourceNodeId || node.id;
    group.userData.componentRole = String(node.role || 'component').slice(0, 80);
    group.userData.componentRelations = Array.isArray(node.relations) ? JSON.parse(JSON.stringify(node.relations)) : [];
    group.userData.componentHidden = node.hidden === true;
    group.userData.componentLocked = node.locked === true;
    group.visible = node.hidden !== true;
    if ((node.kind || 'mesh') === 'mesh' && !node.structuralCutter) {
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
      const binding = resolveEditableParameterTarget(node, spec.materials || {}, target.property);
      if (!binding) throw new TypeError('参数目标属性不存在或不可编辑：' + target.property);
      const current = binding.value;
      const resolved = mode === 'multiply' ? Number(current) * Number(parameterValue)
        : mode === 'add' ? Number(current) + Number(parameterValue) : parameterValue;
      if (target.property === 'visibility.visible') {
        const threshold = Number(target.threshold ?? 1);
        if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) throw new RangeError('可见性阈值无效：' + currentParameter.id);
        node.hidden = mode === 'visible-from' ? Number(parameterValue) < threshold
          : mode === 'visible-through' ? Number(parameterValue) > threshold
            : !Boolean(parameterValue);
      } else if (target.property === 'geometry.primitive') {
        if (!['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus','tube','lathe','sweep','loft'].includes(String(resolved))) throw new TypeError('参数指定了不支持的几何类型');
        node.primitive = resolved;
      } else if (target.property.startsWith('material.')) {
        const previousMaterial = spec.materials[node.material] || DEFAULT_MATERIAL;
        const uniqueKey = 'parameter-' + node.id;
        if (node.material !== uniqueKey) spec.materials[uniqueKey] = { ...previousMaterial };
        node.material = uniqueKey;
        setEditableParameterTarget(node, spec.materials, target.property, resolved);
      } else {
        setEditableParameterTarget(node, spec.materials || {}, target.property, resolved);
      }
    }
  }
  // createObjectSculptModel owns expansion and validation. Passing an already-expanded
  // spec here would discard the declarative constraints before their boundary checks run.
  const rebuilt = createObjectSculptModel(THREE, spec, { source: 'object-sculpt-parameter' });
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
