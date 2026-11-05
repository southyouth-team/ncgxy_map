/**
 * Bounded ObjectSculptSpec -> Three.js runtime adapter.
 *
 * This is the first integration seam for img2threejs-style component-tree specs.
 * It interprets declarative geometry only; it never evaluates model-generated JavaScript.
 */
const MAX_COMPONENTS = 300;
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
    if (!Array.isArray(parameter.targets) || parameter.targets.length > 100) throw new TypeError('参数目标无效：' + parameter.id);
    for (const target of parameter.targets) {
      if (!nodes.has(target.nodeId)) throw new TypeError('参数目标组件不存在：' + target.nodeId);
      if (!['dimensions.width','dimensions.height','dimensions.depth','transform.position.x','transform.position.y','transform.position.z','transform.scale.x','transform.scale.y','transform.scale.z','material.color','material.roughness','material.metalness','material.opacity'].includes(target.property)) {
        throw new TypeError('参数目标属性不受支持：' + target.property);
      }
      if (!['set','multiply','add'].includes(target.mode || 'set')) throw new TypeError('参数目标运算不受支持：' + target.mode);
      if (target.property.startsWith('material.') && ['multiply','add'].includes(target.mode)) throw new TypeError('材质参数仅支持 set');
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
  const validation = validateObjectSculptSpec(spec);
  const root = new THREE.Group();
  root.name = String(spec.targetName || spec.name || 'reconstructed-object').slice(0, 120);
  const groups = new Map();
  const materialSpecs = spec.materials && typeof spec.materials === 'object' ? spec.materials : {};
  const resolveMaterial = key => {
    const materialKey = typeof key === 'string' ? key : 'default';
    return normalizeMaterial(THREE, Object.prototype.hasOwnProperty.call(materialSpecs, materialKey) ? materialSpecs[materialKey] : DEFAULT_MATERIAL);
  };
  const ordered = [...spec.componentTree].sort((a, b) => {
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
    group.userData.componentRole = String(node.role || 'component').slice(0, 80);
    group.userData.componentHidden = node.hidden === true;
    group.userData.componentLocked = node.locked === true;
    group.visible = node.hidden !== true;
    const geometry = createGeometry(THREE, node);
    const mesh = new THREE.Mesh(geometry, resolveMaterial(node.material));
    mesh.name = node.id + ':mesh';
    mesh.userData.componentId = node.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
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
  const spec = JSON.parse(JSON.stringify(baseline));
  const findNode = id => spec.componentTree.find(node => node.id === id);
  for (const target of parameter.targets) {
    const node = findNode(target.nodeId);
    const mode = target.mode || 'set';
    const read = () => {
      const [section, field] = target.property.split('.');
      if (section === 'material') return spec.materials[node.material]?.[field];
      if (section === 'transform' && field.startsWith('position.') || section === 'transform' && field.startsWith('scale.')) {
        const [vector, axis] = field.split('.');
        return node.transform?.[vector]?.['xyz'.indexOf(axis)] ?? 0;
      }
      return node[section]?.[field];
    };
    const current = read();
    const resolved = mode === 'multiply' ? Number(current) * Number(value) : mode === 'add' ? Number(current) + Number(value) : value;
    if (target.property.startsWith('material.')) {
      const field = target.property.split('.')[1];
      if (field === 'color') spec.materials[node.material].color = resolved;
      else spec.materials[node.material][field] = Math.max(0, Math.min(field === 'opacity' ? 1 : 1, Number(resolved)));
    } else if (target.property.startsWith('transform.position.') || target.property.startsWith('transform.scale.')) {
      const [, vector, axis] = target.property.split('.');
      const index = 'xyz'.indexOf(axis);
      node.transform = node.transform || {};
      node.transform[vector] = node.transform[vector] || (vector === 'scale' ? [1,1,1] : [0,0,0]);
      node.transform[vector][index] = resolved;
    } else {
      const [section, field] = target.property.split('.');
      node[section][field] = Math.max(0.02, Math.min(100, Number(resolved)));
    }
  }
  const materialSpecs = spec.materials || {};
  for (const node of spec.componentTree) {
    const group = root.userData.componentGroups.get(node.id);
    if (!group) continue;
    group.position.set(...finiteVector(node.transform?.position, [0,0,0], node.id + '.position'));
    group.rotation.set(...finiteVector(node.transform?.rotation, [0,0,0], node.id + '.rotation'));
    group.scale.set(...finiteVector(node.transform?.scale, [1,1,1], node.id + '.scale'));
    group.visible = node.hidden !== true;
    const mesh = group.children.find(child => child.isMesh);
    if (!mesh) continue;
    mesh.geometry?.dispose?.();
    mesh.geometry = createGeometry(THREE, node);
    const material = materialSpecs[node.material] || DEFAULT_MATERIAL;
    mesh.material.color.set(material.color || DEFAULT_MATERIAL.color);
    mesh.material.roughness = Number(material.roughness ?? DEFAULT_MATERIAL.roughness);
    mesh.material.metalness = Number(material.metalness ?? DEFAULT_MATERIAL.metalness);
    mesh.material.opacity = Number(material.opacity ?? 1);
    mesh.material.transparent = mesh.material.opacity < 1;
    mesh.material.needsUpdate = true;
  }
  root.userData.objectSculptSpec = spec;
  return spec;
}
