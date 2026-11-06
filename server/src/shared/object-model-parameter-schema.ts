import {
  isObjectModelParameterTargetTypeCompatible,
  resolveObjectModelParameterTarget,
} from './object-model-property-resolver';

const PARAMETER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const MATERIAL_PARAMETER_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  lattice_color: 'material.color',
  lattice_roughness: 'material.roughness',
  lattice_metalness: 'material.metalness',
  lattice_opacity: 'material.opacity',
});

function fail(message: string): never {
  throw new TypeError(message);
}

export function normalizeObjectModelMaterialParameterAliases(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return input.map((parameter: any) => ({
    ...parameter,
    targets: Array.isArray(parameter?.targets)
      ? parameter.targets.map((target: any) => ({
        ...target,
        property: Object.prototype.hasOwnProperty.call(MATERIAL_PARAMETER_ALIASES, target?.property)
          ? MATERIAL_PARAMETER_ALIASES[target.property]
          : target?.property,
      }))
      : parameter?.targets,
  }));
}

export function normalizeObjectModelParameterSchema(
  input: unknown,
  componentTree: any[],
  materials: Record<string, any> = {},
  operationParameterIds: ReadonlySet<string> = new Set<string>(),
) {
  const normalizedInput = normalizeObjectModelMaterialParameterAliases(input);
  if (normalizedInput == null) return [];
  if (!Array.isArray(normalizedInput) || normalizedInput.length > 100) fail('parameterSchema 必须是最多 100 项的数组');

  const nodeById = new Map(componentTree.map(node => [node?.id, node]));
  const ids = new Set<string>();
  return normalizedInput.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('参数定义格式无效');
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!PARAMETER_ID_PATTERN.test(id) || ids.has(id)) fail('参数 ID 无效或重复：' + id);
    ids.add(id);

    const type = raw.type;
    if (!['number', 'color', 'boolean', 'select'].includes(type)) fail('参数类型不受支持：' + id);
    const parameter: Record<string, any> = { id, label: String(raw.label || id).slice(0, 100), type, value: raw.value };

    if (type === 'number') {
      const min = raw.min, max = raw.max, value = raw.value;
      if (![min, max, value].every(Number.isFinite) || min > max || value < min || value > max) fail('数值参数范围无效：' + id);
      parameter.min = min;
      parameter.max = max;
      parameter.value = value;
      if (raw.step !== undefined) {
        const step = raw.step;
        if (!Number.isFinite(step) || step <= 0 || step > max - min + 0.000001) fail('数值参数步长无效：' + id);
        parameter.step = step;
      }
      if (typeof raw.unit === 'string') parameter.unit = raw.unit.slice(0, 20);
    } else if (type === 'color') {
      if (typeof raw.value !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.value)) fail('颜色参数无效：' + id);
    } else if (type === 'boolean') {
      if (typeof raw.value !== 'boolean') fail('布尔参数无效：' + id);
    } else {
      if (!Array.isArray(raw.options) || raw.options.length < 1 || raw.options.length > 30
        || !raw.options.some((item: any) => item?.value === raw.value)) fail('枚举参数选项无效：' + id);
      parameter.options = raw.options.map((item: any) => {
        if (!item || typeof item.value !== 'string' || item.value.length > 80) fail('枚举参数选项无效：' + id);
        return { label: String(item.label || item.value).slice(0, 100), value: item.value };
      });
    }

    if (!Array.isArray(raw.targets) || raw.targets.length > 100
      || (raw.targets.length < 1 && !operationParameterIds.has(id))) fail('参数目标不能为空或超出数量限制：' + id);

    parameter.targets = raw.targets.map((target: any) => {
      if (!target || typeof target !== 'object' || Array.isArray(target)
        || typeof target.nodeId !== 'string' || typeof target.property !== 'string') fail('参数目标无效：' + id);
      const node = nodeById.get(target.nodeId);
      const resolved = resolveObjectModelParameterTarget(node, materials, target.property);
      if (!node || !resolved) fail('参数目标无效：' + id);
      if ((node.kind || 'mesh') === 'group'
        && !target.property.startsWith('transform.')
        && target.property !== 'visibility.visible') fail('Group 节点仅支持变换和显隐参数：' + id);

      const mode = target.mode || 'set';
      if (!isObjectModelParameterTargetTypeCompatible(type, resolved, mode, target.property)) fail('参数类型与目标属性的数据类型不匹配：' + id);
      if (!['set', 'multiply', 'add', 'visible-from', 'visible-through'].includes(mode)
        || (target.property.startsWith('material.') && mode !== 'set')) fail('参数目标运算无效：' + id);
      if (['visible-from', 'visible-through'].includes(mode) && target.property !== 'visibility.visible') fail('可见性阈值运算只能用于 visibility.visible：' + id);
      if (target.property === 'visibility.visible' && !['set', 'visible-from', 'visible-through'].includes(mode)) fail('可见性参数运算无效：' + id);
      if (target.property === 'geometry.primitive' && type !== 'select') fail('几何类型参数必须是 select：' + id);
      if (target.property === 'geometry.primitive' && mode !== 'set') fail('几何类型参数仅支持 set：' + id);

      const normalizedTarget: Record<string, any> = { nodeId: target.nodeId, property: target.property, mode };
      if (target.property === 'visibility.visible' && ['visible-from', 'visible-through'].includes(mode)) {
        const threshold = target.threshold;
        if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) fail('可见性阈值无效：' + id);
        normalizedTarget.threshold = threshold;
      }
      return normalizedTarget;
    });
    return parameter;
  });
}
