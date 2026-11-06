import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const TEMPLATES = ['街区楼 A', '街区楼 B', '庭院楼', '坡顶楼', '教学楼', '宿舍楼', '办公楼', '实验楼', '图书馆', '体育馆'];
const ROOFS = ['flat', 'pitched', 'span', 'glass'];
const WALLS = ['wallCream', 'wallPeach', 'wallMint', 'wall'];
function resolveEditableParameterTarget(node: any, materials: Record<string, any>, property: unknown) {
  if (!node || typeof property !== 'string' || property.length > 160) return null;
  const parts = property.split('.');
  if (parts.some(part => !/^(?:[a-zA-Z][a-zA-Z0-9_]{0,39}|0|[1-9][0-9]{0,2})$/.test(part) || ['__proto__','prototype','constructor'].includes(part))) return null;
  if (property === 'visibility.visible') return { value: node.hidden !== true, kind: 'boolean' };
  if (property === 'geometry.primitive') return typeof node.primitive === 'string' ? { value: node.primitive, kind: 'select' } : null;
  const root = parts[0];
  if (!['dimensions','transform','geometryDescriptor','material'].includes(root)) return null;
  if (root === 'material') {
    if (parts.length !== 2 || typeof node.material !== 'string') return null;
    const material = materials[node.material];
    if (!material || !Object.prototype.hasOwnProperty.call(material, parts[1])) return null;
    const value = material[parts[1]];
    if (value === null || typeof value === 'object') return null;
    return { value, kind: typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? 'color' : typeof value };
  }
  if (root === 'transform' && ['position','rotation','scale'].includes(parts[1])) {
    if (parts.length !== 3 || !['x','y','z'].includes(parts[2])) return null;
    const index = 'xyz'.indexOf(parts[2]);
    const vector = node.transform?.[parts[1]];
    const value = Array.isArray(vector) ? vector[index] : (parts[1] === 'scale' ? 1 : 0);
    return Number.isFinite(Number(value)) ? { value: Number(value), kind: 'number' } : null;
  }
  if (parts.length < 2 || parts.length > 4) return null;
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



function assertStableSweepPath(path: number[][], label: string, ErrorType: new (message?: string) => Error) {
  const maxTurnRadians = Math.PI * (150 / 180);
  for (let index = 1; index < path.length - 1; index += 1) {
    const incoming = [path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1], path[index][2] - path[index - 1][2]];
    const outgoing = [path[index + 1][0] - path[index][0], path[index + 1][1] - path[index][1], path[index + 1][2] - path[index][2]];
    const incomingLength = Math.hypot(...incoming);
    const outgoingLength = Math.hypot(...outgoing);
    const dot = incoming.reduce((sum, value, axis) => sum + value * outgoing[axis], 0);
    const turnRadians = Math.acos(Math.max(-1, Math.min(1, dot / (incomingLength * outgoingLength))));
    if (turnRadians > maxTurnRadians) throw new ErrorType(label + ' 存在超过 150° 的急转弯，可能导致扫掠截面翻转或自相交');
  }
}

function assertSimpleAssetProfile(points: number[][], label: string, ErrorType: new (message?: string) => Error) {
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a: number[], b: number[], p: number[]) => Math.abs(cross(a, b, p)) < 0.000001
    && p[0] >= Math.min(a[0], b[0]) - 0.000001 && p[0] <= Math.max(a[0], b[0]) + 0.000001
    && p[1] >= Math.min(a[1], b[1]) - 0.000001 && p[1] <= Math.max(a[1], b[1]) + 0.000001;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    if (Math.hypot(points[i][0] - next[0], points[i][1] - next[1]) < 0.0001) throw new ErrorType(label + ' 存在重复或零长度边');
    area += points[i][0] * next[1] - next[0] * points[i][1];
  }
  if (Math.abs(area) < 0.0001) throw new ErrorType(label + ' 轮廓面积不能为零');
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i || j === (i + 1) % points.length || i === (j + 1) % points.length) continue;
      const d = points[j], e = points[(j + 1) % points.length];
      const abC = cross(a, b, d), abD = cross(a, b, e), cdA = cross(d, e, a), cdB = cross(d, e, b);
      const proper = ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
        && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
      const touching = (Math.abs(abC) < 0.000001 && onSegment(a, b, d))
        || (Math.abs(abD) < 0.000001 && onSegment(a, b, e))
        || (Math.abs(cdA) < 0.000001 && onSegment(d, e, a))
        || (Math.abs(cdB) < 0.000001 && onSegment(d, e, b));
      if (proper || touching) throw new ErrorType(label + ' 存在自相交边');
    }
  }
}

function stableSerialize(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableSerialize(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function normalizeObjectGenerators(input: unknown, componentTree: any[]) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 30) throw new ServiceUnavailableException('generators 必须是最多 30 项的数组');
  const ids = new Set<string>();
  const nodeIds = new Set(componentTree.map(node => node.id));
  const byId = new Map(componentTree.map(node => [node.id, node]));
  let estimatedExpandedCount = componentTree.length;
  const claimedTemplateNodeIds = new Set<string>();
  const normalized = input.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ServiceUnavailableException('结构生成器定义无效');
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) || ids.has(id)) throw new ServiceUnavailableException('结构生成器 ID 无效或重复：' + id);
    ids.add(id);
    if (!['repeat','grid'].includes(raw.type) || !nodeIds.has(raw.templateRootId)) throw new ServiceUnavailableException('结构生成器类型或模板节点无效：' + id);
    if ((byId.get(raw.templateRootId)?.kind || 'mesh') !== 'group') throw new ServiceUnavailableException('结构生成器模板根节点必须是 Group：' + id);
    const descendants = componentTree.filter(node => {
      let parent = node.id;
      while (parent) {
        if (parent === raw.templateRootId) return true;
        parent = byId.get(parent)?.parent;
      }
      return false;
    });
    if (!descendants.length) throw new ServiceUnavailableException('结构生成器模板子树为空：' + id);
    for (const node of descendants) {
      if (claimedTemplateNodeIds.has(node.id)) throw new ServiceUnavailableException('暂不支持嵌套或重叠的结构生成器模板：' + id);
      claimedTemplateNodeIds.add(node.id);
    }
    const countParameterId = (value: unknown) => {
      const parameterId = typeof value === 'string' ? value : '';
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(parameterId)) throw new ServiceUnavailableException('结构生成器数量参数 ID 无效：' + id);
      return parameterId;
    };
    if (raw.type === 'repeat') {
      if (!['x','y','z'].includes(raw.axis)) throw new ServiceUnavailableException('结构生成器排列轴无效：' + id);
      const spacing = Number(raw.spacing), maxCount = Number(raw.maxCount), defaultCount = Number(raw.defaultCount);
      if (!Number.isFinite(spacing) || Math.abs(spacing) > 100 || !Number.isInteger(maxCount) || maxCount < 1 || maxCount > 100
        || !Number.isInteger(defaultCount) || defaultCount < 1 || defaultCount > maxCount) throw new ServiceUnavailableException('结构生成器间距或数量无效：' + id);
      if (raw.followers !== undefined && (!Array.isArray(raw.followers) || raw.followers.length > 30)) throw new ServiceUnavailableException('结构生成器 followers 无效：' + id);
      const followers = (raw.followers || []).map((follower: any) => {
        if (!nodeIds.has(follower?.nodeId) || !['x','y','z'].includes(follower.axis)
          || !Number.isFinite(Number(follower.offset ?? 0)) || descendants.some(node => node.id === follower.nodeId)) {
          throw new ServiceUnavailableException('结构生成器跟随规则无效：' + id);
        }
        return { nodeId: follower.nodeId, axis: follower.axis, offset: Number(follower.offset ?? 0) };
      });
      const maximumInstances = maxCount;
      estimatedExpandedCount += descendants.length * (maximumInstances - 1);
      if (estimatedExpandedCount > 300) throw new ServiceUnavailableException('结构生成器最大展开数量超过 300：' + id);
      return { id, type: 'repeat', templateRootId: raw.templateRootId, countParameterId: countParameterId(raw.countParameterId), axis: raw.axis, spacing, defaultCount, maxCount, followers };
    }
    const rowParameterId = countParameterId(raw.rowParameterId);
    const columnParameterId = countParameterId(raw.columnParameterId);
    if (rowParameterId === columnParameterId) throw new ServiceUnavailableException('网格生成器行列参数不能相同：' + id);
    const spacingX = Number(raw.spacingX), spacingZ = Number(raw.spacingZ);
    const spacingXParameterId = raw.spacingXParameterId == null ? undefined : countParameterId(raw.spacingXParameterId);
    const spacingZParameterId = raw.spacingZParameterId == null ? undefined : countParameterId(raw.spacingZParameterId);
    const spacingXScale = Number(raw.spacingXScale), spacingZScale = Number(raw.spacingZScale);
    const defaultRows = Number(raw.defaultRows), defaultColumns = Number(raw.defaultColumns);
    const maxRows = Number(raw.maxRows), maxColumns = Number(raw.maxColumns);
    if (raw.centered !== undefined && typeof raw.centered !== 'boolean') throw new ServiceUnavailableException('网格生成器 centered 必须是布尔值：' + id);
    if ((spacingXParameterId && (!Number.isFinite(spacingXScale) || Math.abs(spacingXScale) > 10)) || (spacingZParameterId && (!Number.isFinite(spacingZScale) || Math.abs(spacingZScale) > 10))) throw new ServiceUnavailableException('网格生成器动态间距比例无效：' + id);
    if (![spacingX,spacingZ].every(value => Number.isFinite(value) && Math.abs(value) <= 100)
      || !Number.isInteger(defaultRows) || !Number.isInteger(defaultColumns) || !Number.isInteger(maxRows) || !Number.isInteger(maxColumns)
      || defaultRows < 1 || defaultColumns < 1 || maxRows < defaultRows || maxColumns < defaultColumns
      || maxRows > 100 || maxColumns > 100 || maxRows * maxColumns * descendants.length > 300) {
      throw new ServiceUnavailableException('网格生成器行列、间距或最大展开数量无效：' + id);
    }
    estimatedExpandedCount += descendants.length * (maxRows * maxColumns - 1);
    if (estimatedExpandedCount > 300) throw new ServiceUnavailableException('网格生成器最大展开数量超过 300：' + id);
    return { id, type: 'grid', templateRootId: raw.templateRootId, rowParameterId, columnParameterId, spacingX, spacingZ, spacingXParameterId, spacingXScale, spacingZParameterId, spacingZScale, centered: raw.centered === true, defaultRows, defaultColumns, maxRows, maxColumns };
  });
  return normalized;
}
function normalizeObjectConstraints(input: unknown, generators: any[], componentTree: any[]) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 60) throw new ServiceUnavailableException('constraints 必须是最多 60 项的数组');
  const generatorIds = new Set(generators.map(item => item.id));
  const nodeIds = new Set(componentTree.map(item => item.id));
  const templateIds = new Set<string>();
  const byId = new Map(componentTree.map(item => [item.id, item]));
  for (const generator of generators) {
    for (const node of componentTree) {
      let parent = node.id;
      while (parent) {
        if (parent === generator.templateRootId) { templateIds.add(node.id); break; }
        parent = byId.get(parent)?.parent;
      }
    }
  }
  const ids = new Set<string>();
  const targets = new Set<string>();
  const cutoutRegions = new Map<string, Array<{ centerX: number; centerY: number; width: number; height: number }>>();
  const normalized = input.map((raw: any) => {
    const id = typeof raw?.id === 'string' ? raw.id : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) || ids.has(id)
      || !['follow','span','attach','adjacency','cutout'].includes(raw.type)) throw new ServiceUnavailableException('结构约束 ID 或类型无效：' + id);
    ids.add(id);
    if (raw.type === 'cutout') {
      const target = byId.get(raw.targetNodeId), cutter = byId.get(raw.cutterNodeId);
      if (!target || !cutter || target.id === cutter.id || templateIds.has(target.id) || templateIds.has(cutter.id)
        || (target.kind || 'mesh') !== 'mesh' || (cutter.kind || 'mesh') !== 'mesh'
        || !['box','cuboid'].includes(String(target.primitive).toLowerCase())
        || !['box','cuboid'].includes(String(cutter.primitive).toLowerCase())
        || target.parent !== cutter.parent || raw.operation !== 'subtract' || raw.axis !== 'z'
        || (target.transform?.rotation || [0,0,0]).some((value: unknown) => Math.abs(Number(value)) > 0.0001)
        || (cutter.transform?.rotation || [0,0,0]).some((value: unknown) => Math.abs(Number(value)) > 0.0001)
        || (target.transform?.scale || [1,1,1]).some((value: unknown) => Math.abs(Number(value) - 1) > 0.0001)
        || (cutter.transform?.scale || [1,1,1]).some((value: unknown) => Math.abs(Number(value) - 1) > 0.0001)
        || Number(cutter.dimensions?.depth) < Number(target.dimensions?.depth) + 0.02) {
        throw new ServiceUnavailableException('cutout 目前仅支持同级、未旋转盒体沿 Z 轴贯穿的矩形减法：' + id);
      }
      const centerX = Number(cutter.transform?.position?.[0] || 0) - Number(target.transform?.position?.[0] || 0);
      const centerY = Number(cutter.transform?.position?.[1] || 0) - Number(target.transform?.position?.[1] || 0);
      if (!Number.isFinite(centerX) || !Number.isFinite(centerY)
        || Math.abs(centerX) + Number(cutter.dimensions.width) / 2 > Number(target.dimensions.width) / 2
        || Math.abs(centerY) + Number(cutter.dimensions.height) / 2 > Number(target.dimensions.height) / 2) {
        throw new ServiceUnavailableException('cutout 开口必须完整位于目标 Mesh 边界内：' + id);
      }
      const regions = cutoutRegions.get(target.id) || [];
      const width = Number(cutter.dimensions.width), height = Number(cutter.dimensions.height);
      for (const region of regions) {
        const overlapsX = Math.abs(centerX - region.centerX) <= (width + region.width) / 2 + 0.0001;
        const overlapsY = Math.abs(centerY - region.centerY) <= (height + region.height) / 2 + 0.0001;
        if (overlapsX && overlapsY) throw new ServiceUnavailableException('cutout 开口不能重叠或边界接触：' + id);
      }
      regions.push({ centerX, centerY, width, height });
      cutoutRegions.set(target.id, regions);
      return { id, type: 'cutout', targetNodeId: target.id, cutterNodeId: cutter.id, axis: 'z', operation: 'subtract' };
    }
    if (raw.type === 'attach' || raw.type === 'adjacency') {
      const source = byId.get(raw.sourceNodeId), target = byId.get(raw.targetNodeId);
      if (!source || !target || source.id === target.id || templateIds.has(source.id) || templateIds.has(target.id)) {
        throw new ServiceUnavailableException('组件连接关系引用无效：' + id);
      }
      if (raw.type === 'attach') {
        if ((source.kind || 'mesh') !== 'mesh' || (target.kind || 'mesh') !== 'mesh' || source.parent !== target.parent
          || !['x','y','z'].includes(raw.axis) || ![-1,1].includes(Number(raw.sourceSide)) || ![-1,1].includes(Number(raw.targetSide))
          || !Number.isFinite(Number(raw.offset ?? 0)) || Math.abs(Number(raw.offset ?? 0)) > 100) {
          throw new ServiceUnavailableException('attach 必须连接同一父级下的 Mesh 面：' + id);
        }
        const targetKey = target.id + ':attach:' + raw.axis;
        if (targets.has(targetKey)) throw new ServiceUnavailableException('attach 目标轴重复绑定：' + id);
        targets.add(targetKey);
        return { id, type: 'attach', sourceNodeId: source.id, targetNodeId: target.id, axis: raw.axis,
          sourceSide: Number(raw.sourceSide), targetSide: Number(raw.targetSide), offset: Number(raw.offset ?? 0) };
      }
      if (!['adjacent','connects'].includes(raw.relation)) throw new ServiceUnavailableException('adjacency relation 无效：' + id);
      return { id, type: 'adjacency', sourceNodeId: source.id, targetNodeId: target.id, relation: raw.relation };
    }
    if (!generatorIds.has(raw.sourceGeneratorId) || !nodeIds.has(raw.targetNodeId) || templateIds.has(raw.targetNodeId)
      || !['x','y','z'].includes(raw.axis)) throw new ServiceUnavailableException('结构约束引用无效：' + id);
    const measure = raw.measure || (generators.find(item => item.id === raw.sourceGeneratorId)?.type === 'grid' ? 'columns' : 'repeat');
    const sourceGenerator = generators.find(item => item.id === raw.sourceGeneratorId);
    const expectedAxis = ({ 'dimensions.width': 'x', 'dimensions.height': 'y', 'dimensions.depth': 'z' } as Record<string, string>)[raw.property];
    if (!['rows','columns','repeat'].includes(measure)
      || (sourceGenerator?.type === 'grid' && !['rows','columns'].includes(measure))
      || (sourceGenerator?.type === 'repeat' && measure !== 'repeat')) throw new ServiceUnavailableException('结构约束 measure 与生成器类型不匹配：' + id);
    if (raw.type === 'span' && (!['dimensions.width','dimensions.height','dimensions.depth'].includes(raw.property)
      || expectedAxis !== raw.axis || byId.get(raw.targetNodeId)?.kind === 'group')) throw new ServiceUnavailableException('span 约束只能调整匹配轴向的 Mesh 尺寸：' + id);
    if (raw.type === 'follow' && raw.property !== undefined) throw new ServiceUnavailableException('follow 约束不能声明 property：' + id);
    const factor = Number(raw.factor ?? 1), offset = Number(raw.offset ?? 0);
    if (!Number.isFinite(factor) || Math.abs(factor) > 10 || !Number.isFinite(offset) || Math.abs(offset) > 100) {
      throw new ServiceUnavailableException('结构约束计算系数超出范围：' + id);
    }
    const targetKey = raw.targetNodeId + ':' + raw.type + ':' + (raw.property || raw.axis);
    if (targets.has(targetKey)) throw new ServiceUnavailableException('结构约束重复管理同一目标：' + id);
    targets.add(targetKey);
    return { id, type: raw.type, sourceGeneratorId: raw.sourceGeneratorId, targetNodeId: raw.targetNodeId, axis: raw.axis, measure, factor, offset,
      ...(raw.type === 'span' ? { property: raw.property } : {}) };
  });
  const graph = new Map<string, Set<string>>();
  for (const constraint of normalized) if (constraint.type === 'attach') {
    const sources = graph.get(constraint.targetNodeId) || new Set<string>();
    sources.add(constraint.sourceNodeId);
    graph.set(constraint.targetNodeId, sources);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) throw new ServiceUnavailableException('attach 关系存在循环依赖：' + nodeId);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const sourceId of graph.get(nodeId) || []) visit(sourceId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of graph.keys()) visit(nodeId);
  return normalized;
}
function normalizeObjectParameterSchema(input: unknown, componentTree: any[], materials: Record<string, any>, generatorParameterIds = new Set<string>()) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 100) throw new ServiceUnavailableException('parameterSchema 必须是最多 100 项的数组');
  const ids = new Set<string>();
  const nodeIds = new Set(componentTree.map(node => node.id));
  return input.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ServiceUnavailableException('参数定义格式无效');
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) || ids.has(id)) throw new ServiceUnavailableException('参数 ID 无效或重复：' + id);
    ids.add(id);
    const type = raw.type;
    if (!['number','color','boolean','select'].includes(type)) throw new ServiceUnavailableException('参数类型不受支持：' + id);
    const parameter: Record<string, any> = { id, label: String(raw.label || id).slice(0, 100), type, value: raw.value };
    if (type === 'number') {
      const min = Number(raw.min), max = Number(raw.max), value = Number(raw.value);
      if (![min,max,value].every(Number.isFinite) || min > max || value < min || value > max || min < -1000 || max > 1000) throw new ServiceUnavailableException('数值参数范围无效：' + id);
      parameter.min = min; parameter.max = max; parameter.value = value;
      if (raw.step !== undefined) {
        const step = Number(raw.step);
        if (!Number.isFinite(step) || step <= 0 || step > max - min + 0.000001) throw new ServiceUnavailableException('数值参数步长无效：' + id);
        parameter.step = step;
      }
      if (typeof raw.unit === 'string') parameter.unit = raw.unit.slice(0, 20);
    } else if (type === 'color') {
      if (typeof raw.value !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.value)) throw new ServiceUnavailableException('颜色参数无效：' + id);
    } else if (type === 'boolean') {
      if (typeof raw.value !== 'boolean') throw new ServiceUnavailableException('布尔参数无效：' + id);
    } else {
      if (!Array.isArray(raw.options) || raw.options.length < 1 || raw.options.length > 30 || !raw.options.some((item: any) => item?.value === raw.value)) throw new ServiceUnavailableException('枚举参数选项无效：' + id);
      parameter.options = raw.options.map((item: any) => {
        if (!item || typeof item.value !== 'string' || item.value.length > 80) throw new ServiceUnavailableException('枚举参数选项无效：' + id);
        return { label: String(item.label || item.value).slice(0, 100), value: item.value };
      });
    }
    if (!Array.isArray(raw.targets) || raw.targets.length > 100 || (raw.targets.length < 1 && !generatorParameterIds.has(id))) throw new ServiceUnavailableException('参数目标不能为空或超出数量限制：' + id);
    parameter.targets = raw.targets.map((target: any) => {
      const node = componentTree.find(item => item.id === target?.nodeId);
      const binding = resolveEditableParameterTarget(node, materials, target?.property);
      if (!nodeIds.has(target?.nodeId) || !binding) throw new ServiceUnavailableException('参数目标无效：' + id);
      if (node.kind === 'group' && !String(target.property).startsWith('transform.') && target.property !== 'visibility.visible') throw new ServiceUnavailableException('Group 节点仅支持变换和显隐参数：' + id);
      const mode = target.mode || 'set';
      const visibilityThreshold = target.property === 'visibility.visible' && ['visible-from','visible-through'].includes(mode);
      if (type === 'number' && binding.kind !== 'number' && !visibilityThreshold
        || type === 'color' && binding.kind !== 'color'
        || type === 'boolean' && binding.kind !== 'boolean'
        || type === 'select' && binding.kind !== 'select') throw new ServiceUnavailableException('参数类型与目标属性的数据类型不匹配：' + id);
      if (!['set','multiply','add','visible-from','visible-through'].includes(mode) || (target.property.startsWith('material.') && mode !== 'set')) throw new ServiceUnavailableException('参数目标运算无效：' + id);
      if (['visible-from','visible-through'].includes(mode) && target.property !== 'visibility.visible') throw new ServiceUnavailableException('可见性阈值运算只能用于 visibility.visible：' + id);
      if (target.property === 'visibility.visible' && mode === 'set' && type !== 'boolean' && type !== 'number') throw new ServiceUnavailableException('可见性参数类型无效：' + id);
      if (target.property === 'geometry.primitive' && type !== 'select') throw new ServiceUnavailableException('几何类型参数必须是 select：' + id);
      if (target.property.startsWith('material.') && !materials[node.material]) throw new ServiceUnavailableException('参数引用的材质不存在：' + id);
      const normalizedTarget: Record<string, any> = { nodeId: target.nodeId, property: target.property, mode };
      if (target.property === 'visibility.visible' && ['visible-from','visible-through'].includes(mode)) {
        const threshold = Number(target.threshold);
        if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) throw new ServiceUnavailableException('可见性阈值无效：' + id);
        normalizedTarget.threshold = threshold;
      }
      return normalizedTarget;
    });
    return parameter;
  });
}


@Injectable()
export class BuildingDesignService {
  private readonly logger = new Logger(BuildingDesignService.name);

  private tokenSecret() {
    const secret = this.config.get<string>('ASSET_TOKEN_SECRET') || this.config.get<string>('VISION_API_KEY');
    if (!secret) throw new ServiceUnavailableException('缺少 ASSET_TOKEN_SECRET 或 VISION_API_KEY，无法安全签发建筑模板凭证');
    return secret;
  }

  private signToken(kind: 'reference' | 'design', digest: string) {
    const payload = Buffer.from(JSON.stringify({ kind, digest, expiresAt: Date.now() + 15 * 60 * 1000, nonce: randomUUID() })).toString('base64url');
    const signature = createHmac('sha256', this.tokenSecret()).update(payload).digest('base64url');
    return payload + '.' + signature;
  }

  private verifyToken(tokenInput: unknown, kind: 'reference' | 'design', digest: string) {
    if (typeof tokenInput !== 'string') return false;
    const [payload, suppliedSignature, extra] = tokenInput.split('.');
    if (!payload || !suppliedSignature || extra) return false;
    const expected = createHmac('sha256', this.tokenSecret()).update(payload).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(suppliedSignature, 'base64url'); } catch { return false; }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return data.kind === kind && data.digest === digest && Number(data.expiresAt) > Date.now();
    } catch { return false; }
  }

  /** 结构参数签名与参数摘要绑定；多 API 实例可用相同密钥独立验证。 */
  consumeDesignToken(tokenInput: unknown, designInput: unknown) {
    if (!designInput || typeof designInput !== 'object') return false;
    const digest = createHash('sha256').update(JSON.stringify(designInput)).digest('hex');
    try { return this.verifyToken(tokenInput, 'design', digest); } catch { return false; }
  }

  constructor(private readonly config: ConfigService) {}

  /** 用户确认预览图后签发绑定图片摘要的 15 分钟短时凭证。 */
  approveReference(imageDataUrlInput: unknown) {
    const image = this.parseReferenceImage(imageDataUrlInput);
    const digest = createHash('sha256').update(image).digest('hex');
    const approvalToken = this.signToken('reference', digest);
    return { approvalToken, expiresInSeconds: 900, imageSha256: digest };
  }

  private parseReferenceImage(imageDataUrlInput: unknown) {
    if (typeof imageDataUrlInput !== 'string') throw new BadRequestException('请提供场景资产参考图');
    const match = imageDataUrlInput.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new BadRequestException('场景资产参考图必须是 Base64 PNG、JPG 或 WebP');
    const image = Buffer.from(match[2], 'base64');
    if (image.length < 16 || image.length > MAX_REFERENCE_BYTES) throw new BadRequestException('参考图为空或超过 10 MB');
    const validSignature = image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff)
      || (image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP');
    if (!validSignature) throw new BadRequestException('参考图文件签名无效');
    return image;
  }

  /**
   * 结构化物体重建：从用户已确认的参考图提取 ObjectSculptSpec 组件树。
   * 只接受 JSON 描述，不生成或执行 JavaScript/TypeScript。
   */
  async reconstructObjectReference(
    categoryInput: unknown,
    objectTypeInput: unknown,
    visualStyleInput: unknown,
    imageDataUrlInput: unknown,
    approvalTokenInput: unknown,
    promptInput?: unknown,
  ) {
    const categoryHint = typeof categoryInput === 'string' ? categoryInput.trim().slice(0, 80) : '';
    const objectType = typeof objectTypeInput === 'string' ? objectTypeInput.trim().slice(0, 80) : '';
    const visualStyle = typeof visualStyleInput === 'string' ? visualStyleInput.trim().slice(0, 80) : 'stylized';
    if (!visualStyle) throw new BadRequestException('视觉风格不能为空');
    const image = this.parseReferenceImage(imageDataUrlInput);
    if (typeof approvalTokenInput !== 'string' || !approvalTokenInput) throw new BadRequestException('请先确认参考图片，再执行结构化重建');
    const referenceImageSha256 = createHash('sha256').update(image).digest('hex');
    let approved = false;
    try { approved = this.verifyToken(approvalTokenInput, 'reference', referenceImageSha256); } catch { approved = false; }
    if (!approved) throw new BadRequestException('图片确认凭证无效、已过期或与当前预览图片不一致，请重新确认图片预览');

    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey || !model) throw new ServiceUnavailableException('结构化重建未配置视觉模型，请检查 VISION_API_KEY、VISION_MODEL 和 VISION_API_BASE_URL');
    const userPrompt = typeof promptInput === 'string' ? promptInput.trim().slice(0, 4000) : '';
    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
          model,
          temperature: 0.15,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                '你是通用 3D 资产理解与重建引擎。根据参考图推断它是什么、由哪些结构组成，以及各结构之间的空间关系。不要依赖固定物体类别清单，也不要把用户提供的名称当作事实。',
                '只返回 ObjectSculptSpec JSON，不要输出 JavaScript、TypeScript、Markdown 或解释。',
                '根对象字段：schemaVersion 固定为字符串 2.0，targetName，category（你判断的开放式分类标签），objectType（你判断的具体物体名称），visualStyle，materials，componentTree，parameterSchema，confidence，evidence，limitations。',
                'materials 是对象，材质项包含 color(#RRGGBB)、roughness(0-1)、metalness(0-1)、opacity(0.05-1)。',
                'componentTree 是有意义的结构节点数组。节点字段：id（稳定唯一英文 ID）、kind（group 或 mesh，默认 mesh）、name、role、parent（唯一根节点省略，其余节点填写直接父节点 ID）、transform（position/rotation/scale）。group 是纯逻辑分组，不带 primitive/dimensions/material，可包含子节点；mesh 必须声明 primitive（box/cuboid/polygon/wedge/arch/cylinder/cone/sphere/ellipsoid/torus/tube/lathe/sweep/loft）、dimensions（width/height/depth）、material、geometryDescriptor（可选）。',
                '根据对象本身的真实组成自主决定组件数量和层级；不要求固定层数或固定部件数量。简单对象可以只有一个 Mesh；复杂对象必须拆分为可独立编辑的部件。',
                '整个资产必须只有一个根节点，其他节点通过 parent 形成连通树。子节点 position 是相对直接 parent 的局部坐标。parent 只定义层级，不会自动吸附几何体，必须根据尺寸和连接关系计算位置。',
                'parameterSchema 用于声明真正有意义的可编辑参数，而不是穷举通用参数。每项格式：id、label、type(number/color/boolean/select)、value；number 另含 min/max/step/unit；select 另含 options([{label,value}])；targets 为数组，每项含 nodeId、property、mode。property 只允许 dimensions.width/height/depth、transform.position.x/y/z、transform.scale.x/y/z、material.color/roughness/metalness/opacity、geometry.primitive、geometryDescriptor.inset/tube/radius、visibility.visible。mode 允许 set/multiply/add；visibility.visible 还允许 visible-from/visible-through 并提供 threshold；材质只允许 set。',
                '只声明对当前资产有实际意义的参数。例如重复楼层、树冠层、车轮、窗户、叶片等结构的尺寸/颜色/比例；一个参数可绑定多个节点实现联动。不要凭空声明没有可控目标的参数。',
                '当参考图中存在规则重复单元时，必须评估是否输出 generators，将重复结构参数化，而不是只输出静态复制节点。支持 repeat：{id,type:"repeat",templateRootId,countParameterId,axis:"x"|"y"|"z",spacing,defaultCount,maxCount,followers:[{nodeId,axis,offset}]}；支持 grid：{id,type:"grid",templateRootId,rowParameterId,columnParameterId,spacingX,spacingZ,centered?,defaultRows,defaultColumns,maxRows,maxColumns}。数量参数必须放入 parameterSchema，type=number，min/value/max 为整数，min>=1，max<=100，targets=[]；repeat/grid 的模板必须是完整 Group 子树，禁止嵌套或重叠模板。只有结构确实重复时才使用生成器，避免为不规则对象强行套用。',
                '输出前检查：每个 generator 引用的模板节点存在；数量参数 ID 与 parameterSchema 一致；每个参数目标引用真实节点；重复单元的尺寸、间距与整体外形比例符合参考图。',
                '参数目标必须引用真实存在的 nodeId。数值参数给出合理 min/max/current value；颜色参数使用 #RRGGBB；枚举参数提供有限 options。不要输出表达式、函数、脚本或任意属性路径。',
                '材质颜色必须匹配参考图，不得全部白色/灰色。loft 放样体必须声明 geometryDescriptor.sections，包含 2 到 12 个截面，每个截面含严格递增的 height（[-0.5,0.5]）和相同数量的 points（3 到 24 个 [x,z] 二维归一化轮廓点，范围 [-0.5,0.5]）；系统在相邻截面之间连接连续网格并封闭首尾端面。用于异形立柱、渐变容器、复杂家具外壳、地形构件等；各截面轮廓点必须按相同方向、相同拓扑顺序排列。sweep 扫掠体必须声明 geometryDescriptor.path（2 到 32 个三维归一化点 [x,y,z]）和 geometryDescriptor.profile（3 到 24 个二维归一化轮廓点 [x,y]），坐标范围均为 [-0.5,0.5]；路径定义截面沿空间延伸的轨迹，profile 定义垂直于路径的截面形状；可声明 steps（3 到 128）。用于弯曲方管、异形扶手、弯曲风管、装饰构件等，优先使用一个连续 sweep Mesh，不要拆成大量独立小段；路径相邻段方向变化不得超过 150°，避免急剧回折造成截面翻转或自相交；sweep 当前只支持开放路径，不得设置 closed=true，闭合圆管请使用 tube。lathe 旋转体必须声明 geometryDescriptor.profile，格式为 2 到 32 个 [radius,height] 点，radius 范围 [0,0.5]、height 范围 [-0.5,0.5]，按截面轮廓顺序排列；用于杯子、瓶子、碗、花盆、柱头等绕 Y 轴旋转对称的形体。tube 几何必须声明 geometryDescriptor.path，格式为 2 到 32 个三维点，每个点是相对 dimensions 的归一化坐标 [x,y,z]，每个分量范围 [-0.5,0.5]；可声明 radius（0.01 到 10）、tubularSegments（3 到 128）、radialSegments（3 到 24）、closed（布尔值）。使用 tube 表达管道、弯曲线缆、扶手、枝干等沿路径延伸的圆截面物体，不要用一串互不连接的圆柱替代连续路径。几何部件应合理接合，避免无理由漂浮。只推断图中可见结构，遮挡/背面不确定性写入 limitations。',
                '分类提示：' + (categoryHint || '未指定，请自行判断') + '；对象名称提示：' + (objectType || '未指定，请自行判断') + '；视觉风格提示：' + visualStyle + '；补充要求：' + (userPrompt || '忠实还原参考图的主要轮廓、结构和色彩。'),
              ].join('\\n'),
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: '请重建图片中的完整独立资产，优先保证轮廓、组件数量、相对位置、屋顶/顶部结构、开口和主要颜色分区。输出满足约束的 ObjectSculptSpec。' },
                { type: 'image_url', image_url: { url: imageDataUrlInput, detail: 'high' } },
              ],
            },
          ],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('结构化重建视觉模型连接失败：' + message);
      throw new ServiceUnavailableException('无法连接结构化重建视觉模型，请检查后端网络连接');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      this.logger.warn('结构化重建 API HTTP ' + response.status + '：' + detail);
      throw new ServiceUnavailableException('结构化重建失败（HTTP ' + response.status + '）');
    }
    const payload = await response.json() as any;
    const raw = payload?.choices?.[0]?.message?.content;
    let parsed: any;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : null; } catch {
      throw new ServiceUnavailableException('视觉模型未返回有效 ObjectSculptSpec JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.componentTree)) {
      throw new ServiceUnavailableException('视觉模型返回的 ObjectSculptSpec 格式无效');
    }
    if (parsed.componentTree.length < 1 || parsed.componentTree.length > 100) throw new ServiceUnavailableException('ObjectSculptSpec 组件数量必须在 1 到 100 之间');
    const materialsInput = parsed.materials && typeof parsed.materials === 'object' && !Array.isArray(parsed.materials) ? parsed.materials : {};
    const materials: Record<string, any> = {};
    for (const [key, value] of Object.entries(materialsInput).slice(0, 40)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      const color = typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#b8b8b8';
      const clamp = (v: unknown, fallback: number, min: number, max: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
      };
      materials[key] = {
        color,
        roughness: clamp(item.roughness, 0.82, 0, 1),
        metalness: clamp(item.metalness, 0, 0, 1),
        opacity: clamp(item.opacity, 1, 0.05, 1),
      };
    }
    if (!Object.keys(materials).length) materials.default = { color: '#b8b8b8', roughness: 0.82, metalness: 0, opacity: 1 };
    const ids = new Set<string>();
    const componentTree = parsed.componentTree.map((input: any, index: number) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ServiceUnavailableException('组件节点格式无效：' + index);
      const id = typeof input.id === 'string' ? input.id : '';
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) || ids.has(id)) throw new ServiceUnavailableException('组件 ID 无效或重复：' + id);
      ids.add(id);
      const kind = input.kind === 'group' ? 'group' : 'mesh';
      const primitive = String(input.primitive || '').toLowerCase();
      if (kind === 'mesh' && !['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus','tube','lathe','sweep','loft'].includes(primitive)) throw new ServiceUnavailableException('组件几何类型不受支持：' + primitive);
      const number = (value: unknown, fallback: number, min: number, max: number) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
      };
      const vector = (value: unknown, fallback: number[]) => Array.isArray(value) && value.length === 3
        ? value.map((v: unknown, i: number) => number(v, fallback[i], -100, 100))
        : fallback;
      const dimensions = input.dimensions && typeof input.dimensions === 'object' ? input.dimensions : {};
      const transform = input.transform && typeof input.transform === 'object' ? input.transform : {};
      const scale = vector(transform.scale, [1, 1, 1]).map((value: number) => Math.abs(value) < 0.001 ? 1 : Math.max(-20, Math.min(20, value)));
      const material = typeof input.material === 'string' && materials[input.material] ? input.material : Object.keys(materials)[0];
      const geometryDescriptor: Record<string, any> = {};
      if (kind === 'mesh' && input.geometryDescriptor && typeof input.geometryDescriptor === 'object') {
        if (input.geometryDescriptor.segments !== undefined) geometryDescriptor.segments = Math.round(number(input.geometryDescriptor.segments, 16, 3, 48));
        if (input.geometryDescriptor.tube !== undefined) geometryDescriptor.tube = number(input.geometryDescriptor.tube, 0.1, 0.01, 10);
        if (input.geometryDescriptor.inset !== undefined) geometryDescriptor.inset = number(input.geometryDescriptor.inset, 0.2, 0.02, 20);
        if (input.geometryDescriptor.radius !== undefined) geometryDescriptor.radius = number(input.geometryDescriptor.radius, 0.08, 0.01, 10);
        if (input.geometryDescriptor.tubularSegments !== undefined) geometryDescriptor.tubularSegments = Math.round(number(input.geometryDescriptor.tubularSegments, 32, 3, 128));
        if (input.geometryDescriptor.radialSegments !== undefined) geometryDescriptor.radialSegments = Math.round(number(input.geometryDescriptor.radialSegments, 8, 3, 24));
        if (input.geometryDescriptor.closed !== undefined) {
          if (typeof input.geometryDescriptor.closed !== 'boolean') throw new ServiceUnavailableException('tube closed 必须是布尔值');
          geometryDescriptor.closed = input.geometryDescriptor.closed;
        }
        if (kind === 'mesh' && primitive === 'tube') {
          const path = input.geometryDescriptor.path;
          if (!Array.isArray(path) || path.length < 2 || path.length > 32
            || path.some((point: any) => !Array.isArray(point) || point.length !== 3
              || point.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < -0.5 || value > 0.5))) {
            throw new ServiceUnavailableException('tube 路径必须包含 2 到 32 个 [-0.5,0.5] 范围内的三维坐标点');
          }
          geometryDescriptor.path = path.map((point: number[]) => [...point]);
        }
        if (kind === 'mesh' && primitive === 'lathe') {
          const profile = input.geometryDescriptor.profile;
          if (!Array.isArray(profile) || profile.length < 2 || profile.length > 32
            || profile.some((point: any) => !Array.isArray(point) || point.length !== 2
              || typeof point[0] !== 'number' || !Number.isFinite(point[0]) || point[0] < 0 || point[0] > 0.5
              || typeof point[1] !== 'number' || !Number.isFinite(point[1]) || point[1] < -0.5 || point[1] > 0.5)
            || profile.every((point: number[], index: number) => index === 0
              || (Math.abs(point[0] - profile[index - 1][0]) < 0.0001 && Math.abs(point[1] - profile[index - 1][1]) < 0.0001))) {
            throw new ServiceUnavailableException('lathe profile 必须包含 2 到 32 个有效的 [半径,高度] 归一化截面点');
          }
          geometryDescriptor.profile = profile.map((point: number[]) => [...point]);
        }
        if (kind === 'mesh' && primitive === 'sweep') {
          if (input.geometryDescriptor.closed === true) throw new ServiceUnavailableException('sweep 暂不支持闭合路径；请使用 tube，或改为开放路径');
          const path = input.geometryDescriptor.path;
          const profile = input.geometryDescriptor.profile;
          if (!Array.isArray(path) || path.length < 2 || path.length > 32
            || path.some((point: any) => !Array.isArray(point) || point.length !== 3
              || point.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < -0.5 || value > 0.5))) {
            throw new ServiceUnavailableException('sweep path 必须包含 2 到 32 个 [-0.5,0.5] 范围内的三维点');
          }
          if (path.some((point: number[], index: number) => index > 0
            && Math.hypot(point[0] - path[index - 1][0], point[1] - path[index - 1][1], point[2] - path[index - 1][2]) < 0.0001)) {
            throw new ServiceUnavailableException('sweep path 不能包含重复或零长度路径段');
          }
          assertStableSweepPath(path, 'sweep path', ServiceUnavailableException);
          if (!Array.isArray(profile) || profile.length < 3 || profile.length > 24
            || profile.some((point: any) => !Array.isArray(point) || point.length !== 2
              || point.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < -0.5 || value > 0.5))) {
            throw new ServiceUnavailableException('sweep profile 必须包含 3 到 24 个 [-0.5,0.5] 范围内的二维轮廓点');
          }
          assertSimpleAssetProfile(profile, 'sweep profile', ServiceUnavailableException);
          geometryDescriptor.path = path.map((point: number[]) => [...point]);
          geometryDescriptor.profile = profile.map((point: number[]) => [...point]);
          if (input.geometryDescriptor.steps !== undefined) geometryDescriptor.steps = Math.round(number(input.geometryDescriptor.steps, 32, 3, 128));
        }
        if (kind === 'mesh' && primitive === 'loft') {
          const sections = input.geometryDescriptor.sections;
          if (!Array.isArray(sections) || sections.length < 2 || sections.length > 12) {
            throw new ServiceUnavailableException('loft sections 必须包含 2 到 12 个截面');
          }
          const pointCount = Array.isArray(sections[0]?.points) ? sections[0].points.length : 0;
          if (pointCount < 3 || pointCount > 24) throw new ServiceUnavailableException('loft 每个截面必须包含 3 到 24 个轮廓点');
          let previousHeight = -Infinity;
          let contourOrientation = 0;
          geometryDescriptor.sections = sections.map((section: any, sectionIndex: number) => {
            if (!section || typeof section !== 'object' || typeof section.height !== 'number'
              || !Number.isFinite(section.height) || section.height < -0.5 || section.height > 0.5
              || !Array.isArray(section.points) || section.points.length !== pointCount
              || section.points.some((point: any) => !Array.isArray(point) || point.length !== 2
                || point.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < -0.5 || value > 0.5))
              || section.height <= previousHeight + 0.0001) {
              throw new ServiceUnavailableException('loft sections 必须按高度严格递增，并保持相同数量的有效二维轮廓点（截面 ' + sectionIndex + '）');
            }
            assertSimpleAssetProfile(section.points, 'loft section ' + sectionIndex, ServiceUnavailableException);
            const signedArea = section.points.reduce((sum: number, point: number[], pointIndex: number) => {
              const next = section.points[(pointIndex + 1) % section.points.length];
              return sum + point[0] * next[1] - next[0] * point[1];
            }, 0);
            const orientation = Math.sign(signedArea);
            if (contourOrientation && orientation !== contourOrientation) {
              throw new ServiceUnavailableException('loft sections 必须保持一致的轮廓绕序');
            }
            contourOrientation = orientation;
            previousHeight = section.height;
            return { height: section.height, points: section.points.map((point: number[]) => [...point]) };
          });
        }
        if (kind === 'mesh' && primitive === 'polygon') {
          const points = input.geometryDescriptor.points;
          if (!Array.isArray(points) || points.length < 3 || points.length > 32 || points.some((point: any) => !Array.isArray(point) || point.length !== 2 || point.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v) || v < -0.5 || v > 0.5))) {
            throw new ServiceUnavailableException('polygon 轮廓必须包含 3 到 32 个 [-0.5,0.5] 范围内的二维坐标点');
          }
          const area = points.reduce((sum: number, point: number[], index: number) => {
            const next = points[(index + 1) % points.length];
            return sum + point[0] * next[1] - next[0] * point[1];
          }, 0) / 2;
          if (Math.abs(area) < 0.0001) throw new ServiceUnavailableException('polygon 轮廓面积不能为零');
          geometryDescriptor.points = points.map((point: number[]) => [...point]);
        }
      }
      return {
        id,
        kind,
        name: String(input.name || id).slice(0, 120),
        role: String(input.role || 'component').slice(0, 80),
        hidden: input.hidden === true,
        locked: input.locked === true,
        ...(typeof input.parent === 'string' && input.parent ? { parent: input.parent } : {}),
        ...(kind === 'mesh' ? { primitive, dimensions: {
          width: number(dimensions.width, 1, 0.02, 100),
          height: number(dimensions.height, 1, 0.02, 100),
          depth: number(dimensions.depth, 1, 0.02, 100),
        }, material } : {}),
        transform: {
          position: vector(transform.position, [0, 0, 0]),
          rotation: vector(transform.rotation, [0, 0, 0]),
          scale,
        },
        ...(kind === 'mesh' && Object.keys(geometryDescriptor).length ? { geometryDescriptor } : {}),
      };
    });
    const byId = new Map<string, any>(componentTree.map((node: any) => [node.id, node] as [string, any]));
    const rootNodes = componentTree.filter((node: any) => !node.parent);
    if (rootNodes.length !== 1) {
      throw new ServiceUnavailableException('ObjectSculptSpec 必须只有一个主体根节点；检测到 ' + rootNodes.length + ' 个根节点，组件可能没有组成完整建筑');
    }
    for (const node of componentTree) {
      if (node.parent && !byId.has(node.parent)) throw new ServiceUnavailableException('组件父节点不存在：' + node.id);
      const visited = new Set([node.id]);
      let parent = node.parent;
      let depth = 1;
      while (parent) {
        if (visited.has(parent)) throw new ServiceUnavailableException('组件树存在循环引用：' + node.id);
        visited.add(parent);
        depth += 1;
        if (depth > 16) throw new ServiceUnavailableException('组件树层级超过 16 层');
        parent = byId.get(parent)?.parent;
      }
    }
    const generators = normalizeObjectGenerators(parsed.generators, componentTree);
    const generatorParameterIds = new Set(generators.flatMap((generator: any) => generator.type === 'grid' ? [generator.rowParameterId, generator.columnParameterId] : [generator.countParameterId]));
    const parameterSchema = normalizeObjectParameterSchema(parsed.parameterSchema, componentTree, materials, generatorParameterIds);
    for (const generator of generators) {
      const parameterIds = generator.type === 'grid' ? [generator.rowParameterId, generator.columnParameterId] : [generator.countParameterId];
      const defaults = generator.type === 'grid' ? [generator.defaultRows, generator.defaultColumns] : [generator.defaultCount];
      const maximums = generator.type === 'grid' ? [generator.maxRows, generator.maxColumns] : [generator.maxCount];
      for (let index = 0; index < parameterIds.length; index += 1) {
        const parameter = parameterSchema.find((item: any) => item.id === parameterIds[index]);
        const defaultValue = Number(defaults[index]);
        const maximum = Number(maximums[index]);
        if (!parameter || parameter.type !== 'number'
          || !Number.isInteger(parameter.min) || !Number.isInteger(parameter.max) || !Number.isInteger(parameter.value)
          || !Number.isInteger(defaultValue) || !Number.isInteger(maximum)
          || parameter.min < 1 || parameter.max > maximum
          || defaultValue < parameter.min || defaultValue > parameter.max || parameter.value !== defaultValue) {
          throw new ServiceUnavailableException('结构生成器必须绑定默认值一致的有效整数数量参数：' + generator.id);
        }
      }
    }
    const constraints = normalizeObjectConstraints(parsed.constraints, generators, componentTree);
    const objectSculptSpec = {
      schemaVersion: '2.0',
      targetName: String(parsed.targetName || objectType || 'AI 生成资产').slice(0, 120),
      category: String(parsed.category || categoryHint || 'other').slice(0, 80),
      objectType: String(parsed.objectType || objectType || parsed.targetName || '3D 资产').slice(0, 120),
      visualStyle: String(parsed.visualStyle || visualStyle).slice(0, 80),
      materials,
      componentTree,
      parameterSchema,
      generators,
      constraints,
    };
    const design = {
      schemaVersion: 1,
      source: 'ai-vision-object-sculpt',
      category: objectSculptSpec.category,
      objectType: objectSculptSpec.objectType,
      visualStyle,
      referenceImageSha256,
      objectSculptSpec,
      confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0.35,
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter((x: unknown) => typeof x === 'string').slice(0, 8).map((x: string) => x.slice(0, 180)) : [],
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations.filter((x: unknown) => typeof x === 'string').slice(0, 8).map((x: string) => x.slice(0, 180)) : [],
      reviewed: false,
    };
    const designDigest = createHash('sha256').update(JSON.stringify(design)).digest('hex');
    const designToken = this.signToken('design', designDigest);
    return { provider: baseUrl, model, category: objectSculptSpec.category, objectType: objectSculptSpec.objectType, visualStyle, design, designToken, designTokenExpiresInSeconds: 900 };
  }


  /**
   * 审核编辑后的 ObjectSculptSpec。原始 AI 凭证必须有效且未过期；
   * 服务端重新规范化整个组件树并签发绑定最终设计的新凭证。
   */
  reviewObjectDesign(originalDesignInput: unknown, originalTokenInput: unknown, objectSculptSpecInput: unknown) {
    const original = originalDesignInput as Record<string, any> | undefined;
    if (!original || typeof original !== 'object' || Array.isArray(original)
      || original.source !== 'ai-vision-object-sculpt'
      || original.reviewed === true || !this.consumeDesignToken(originalTokenInput, original)) {
      throw new BadRequestException('原始资产设计凭证无效、已审核或已过期，请重新识别');
    }
    const input = objectSculptSpecInput as Record<string, any> | undefined;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || input.schemaVersion !== '2.0' || !Array.isArray(input.componentTree)
      || input.componentTree.length < 1 || input.componentTree.length > 100) {
      throw new BadRequestException('ObjectSculptSpec 格式无效或组件数量超出范围');
    }
    const materialInput = input.materials;
    if (!materialInput || typeof materialInput !== 'object' || Array.isArray(materialInput)
      || Object.keys(materialInput).length < 1 || Object.keys(materialInput).length > 40) {
      throw new BadRequestException('材质表必须包含 1 到 40 项');
    }
    const materials: Record<string, any> = {};
    for (const [key, value] of Object.entries(materialInput)) {
      const item = value as Record<string, any>;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(key) || ['constructor','prototype','toString','valueOf'].includes(key) || !item || typeof item !== 'object' || Array.isArray(item)
        || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) {
        throw new BadRequestException('材质 ID 或颜色格式无效：' + key);
      }
      const bounded = (v: unknown, min: number, max: number, field: string) => {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new BadRequestException('材质 ' + key + '.' + field + ' 超出允许范围');
        return v;
      };
      materials[key] = {
        color: item.color,
        roughness: bounded(item.roughness, 0, 1, 'roughness'),
        metalness: bounded(item.metalness, 0, 1, 'metalness'),
        opacity: bounded(item.opacity, 0.05, 1, 'opacity'),
      };
    }
    const ids = new Set<string>();
    const primitives = ['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus','tube','lathe','sweep','loft'];
    const vector = (value: unknown, fallback: number[], field: string, min: number, max: number) => {
      if (value === undefined || value === null) return [...fallback];
      if (!Array.isArray(value) || value.length !== 3 || value.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)) {
        throw new BadRequestException(field + ' 必须是范围内的三个有限数值');
      }
      return [...value];
    };
    const componentTree = input.componentTree.map((node: any, index: number) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) throw new BadRequestException('组件节点格式无效：' + index);
      const id = typeof node.id === 'string' ? node.id : '';
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) || ids.has(id)) throw new BadRequestException('组件 ID 无效或重复：' + id);
      ids.add(id);
      const kind = node.kind === 'group' ? 'group' : 'mesh';
      const primitive = String(node.primitive || '').toLowerCase();
      if (kind === 'mesh' && !primitives.includes(primitive)) throw new BadRequestException('组件几何类型不受支持：' + primitive);
      const dimensions = node.dimensions || {};
      if (kind === 'mesh' && (!dimensions || typeof dimensions !== 'object')) throw new BadRequestException('组件尺寸缺失：' + id);
      const dimension = (key: string) => {
        const value = dimensions[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.02 || value > 100) throw new BadRequestException(id + '.' + key + ' 超出允许范围');
        return value;
      };
      const width = kind === 'mesh' ? dimension('width') : undefined;
      const height = kind === 'mesh' ? dimension('height') : undefined;
      const depth = kind === 'mesh' ? dimension('depth') : undefined;
      const transform = node.transform && typeof node.transform === 'object' ? node.transform : {};
      const scale = vector(transform.scale, [1,1,1], id + '.scale', -20, 20);
      if (scale.some(value => Math.abs(value) < 0.001)) throw new BadRequestException(id + '.scale 不能为零');
      if (kind === 'mesh' && (typeof node.material !== 'string' || !Object.prototype.hasOwnProperty.call(materials, node.material))) throw new BadRequestException(id + '.material 不存在');
      const geometryDescriptor: Record<string, any> = {};
      const descriptor = node.geometryDescriptor && typeof node.geometryDescriptor === 'object' ? node.geometryDescriptor : {};
      if (kind === 'mesh' && descriptor.segments !== undefined) {
        if (typeof descriptor.segments !== 'number' || !Number.isInteger(descriptor.segments) || descriptor.segments < 3 || descriptor.segments > 48) throw new BadRequestException(id + '.segments 超出范围');
        geometryDescriptor.segments = descriptor.segments;
      }
      if (kind === 'mesh' && descriptor.tube !== undefined) {
        if (typeof descriptor.tube !== 'number' || !Number.isFinite(descriptor.tube) || descriptor.tube < 0.01 || descriptor.tube > Math.max(width ?? 1, depth ?? 1) * 0.225) throw new BadRequestException(id + '.tube 超出范围');
        geometryDescriptor.tube = descriptor.tube;
      }
      if (kind === 'mesh' && descriptor.inset !== undefined) {
        if (typeof descriptor.inset !== 'number' || !Number.isFinite(descriptor.inset) || descriptor.inset < 0.02 || descriptor.inset > Math.min(width ?? 1, height ?? 1) * 0.4) throw new BadRequestException(id + '.inset 超出范围');
        geometryDescriptor.inset = descriptor.inset;
      }
      if (primitive === 'polygon') {
        const points = descriptor.points;
        if (!Array.isArray(points) || points.length < 3 || points.length > 32
          || points.some((point: any) => !Array.isArray(point) || point.length !== 2
            || point.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v) || v < -0.5 || v > 0.5))) {
          throw new BadRequestException(id + '.polygon 轮廓必须包含 3 到 32 个 [-0.5,0.5] 二维点');
        }
        const area = points.reduce((sum: number, point: number[], pointIndex: number) => {
          const next = points[(pointIndex + 1) % points.length];
          return sum + point[0] * next[1] - next[0] * point[1];
        }, 0) / 2;
        if (Math.abs(area) < 0.0001) throw new BadRequestException(id + '.polygon 轮廓面积不能为零');
        geometryDescriptor.points = points.map((point: number[]) => [...point]);
      }
      if (kind === 'mesh' && descriptor.closed !== undefined) {
        if (typeof descriptor.closed !== 'boolean') throw new BadRequestException(id + '.closed 必须是布尔值');
        geometryDescriptor.closed = descriptor.closed;
      }
      if (kind === 'mesh' && descriptor.radius !== undefined) {
        if (typeof descriptor.radius !== 'number' || !Number.isFinite(descriptor.radius) || descriptor.radius < 0.01 || descriptor.radius > 10) {
          throw new BadRequestException(id + '.radius 超出范围');
        }
        geometryDescriptor.radius = descriptor.radius;
      }
      if (kind === 'mesh' && descriptor.tubularSegments !== undefined) {
        if (typeof descriptor.tubularSegments !== 'number' || !Number.isInteger(descriptor.tubularSegments) || descriptor.tubularSegments < 3 || descriptor.tubularSegments > 128) {
          throw new BadRequestException(id + '.tubularSegments 超出范围');
        }
        geometryDescriptor.tubularSegments = descriptor.tubularSegments;
      }
      if (kind === 'mesh' && descriptor.radialSegments !== undefined) {
        if (typeof descriptor.radialSegments !== 'number' || !Number.isInteger(descriptor.radialSegments) || descriptor.radialSegments < 3 || descriptor.radialSegments > 24) {
          throw new BadRequestException(id + '.radialSegments 超出范围');
        }
        geometryDescriptor.radialSegments = descriptor.radialSegments;
      }
      if (kind === 'mesh' && primitive === 'tube') {
        const path = descriptor.path;
        if (!Array.isArray(path) || path.length < 2 || path.length > 32
          || path.some((point: any) => !Array.isArray(point) || point.length !== 3
            || point.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < -0.5 || value > 0.5))) {
          throw new BadRequestException(id + '.tube 路径必须包含 2 到 32 个 [-0.5,0.5] 范围内的三维坐标点');
        }
        geometryDescriptor.path = path.map((point: number[]) => [...point]);
      }
      if (kind === 'mesh' && primitive === 'lathe') {
        const profile = descriptor.profile;
        if (!Array.isArray(profile) || profile.length < 2 || profile.length > 32
          || profile.some((point: any) => !Array.isArray(point) || point.length !== 2
            || typeof point[0] !== 'number' || !Number.isFinite(point[0]) || point[0] < 0 || point[0] > 0.5
            || typeof point[1] !== 'number' || !Number.isFinite(point[1]) || point[1] < -0.5 || point[1] > 0.5)
          || profile.every((point: number[], index: number) => index === 0
            || (Math.abs(point[0] - profile[index - 1][0]) < 0.0001 && Math.abs(point[1] - profile[index - 1][1]) < 0.0001))) {
          throw new BadRequestException(id + '.lathe profile 必须包含 2 到 32 个有效的 [半径,高度] 归一化截面点');
        }
        geometryDescriptor.profile = profile.map((point: number[]) => [...point]);
      }
      if (kind === 'mesh' && primitive === 'sweep') {
        if (descriptor.closed === true) throw new BadRequestException(id + '.sweep 暂不支持闭合路径');
        const path = descriptor.path;
        const profile = descriptor.profile;
        if (!Array.isArray(path) || path.length < 2 || path.length > 32
          || path.some((point: any) => !Array.isArray(point) || point.length !== 3
            || point.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < -0.5 || value > 0.5))) {
          throw new BadRequestException(id + '.sweep path 必须包含 2 到 32 个 [-0.5,0.5] 范围内的三维点');
        }
        if (path.some((point: number[], index: number) => index > 0
          && Math.hypot(point[0] - path[index - 1][0], point[1] - path[index - 1][1], point[2] - path[index - 1][2]) < 0.0001)) {
          throw new BadRequestException(id + '.sweep path 不能包含重复或零长度路径段');
        }
        assertStableSweepPath(path, id + '.sweep path', BadRequestException);
        if (!Array.isArray(profile) || profile.length < 3 || profile.length > 24
          || profile.some((point: any) => !Array.isArray(point) || point.length !== 2
            || point.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < -0.5 || value > 0.5))) {
          throw new BadRequestException(id + '.sweep profile 必须包含 3 到 24 个有效二维轮廓点');
        }
        assertSimpleAssetProfile(profile, id + '.sweep profile', BadRequestException);
        geometryDescriptor.path = path.map((point: number[]) => [...point]);
        geometryDescriptor.profile = profile.map((point: number[]) => [...point]);
        if (descriptor.steps !== undefined) {
          if (typeof descriptor.steps !== 'number' || !Number.isInteger(descriptor.steps) || descriptor.steps < 3 || descriptor.steps > 128) {
            throw new BadRequestException(id + '.sweep steps 超出范围');
          }
          geometryDescriptor.steps = descriptor.steps;
        }
      }
      if (kind === 'mesh' && primitive === 'loft') {
        const sections = descriptor.sections;
        if (!Array.isArray(sections) || sections.length < 2 || sections.length > 12) {
          throw new BadRequestException(id + '.loft sections 必须包含 2 到 12 个截面');
        }
        const pointCount = Array.isArray(sections[0]?.points) ? sections[0].points.length : 0;
        if (pointCount < 3 || pointCount > 24) throw new BadRequestException(id + '.loft 每个截面必须包含 3 到 24 个轮廓点');
        let previousHeight = -Infinity;
        let contourOrientation = 0;
        geometryDescriptor.sections = sections.map((section: any, sectionIndex: number) => {
          if (!section || typeof section !== 'object' || typeof section.height !== 'number'
            || !Number.isFinite(section.height) || section.height < -0.5 || section.height > 0.5
            || !Array.isArray(section.points) || section.points.length !== pointCount
            || section.points.some((point: any) => !Array.isArray(point) || point.length !== 2
              || point.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value) || value < -0.5 || value > 0.5))
            || section.height <= previousHeight + 0.0001) {
            throw new BadRequestException(id + '.loft 截面高度必须严格递增且轮廓点数量一致（截面 ' + sectionIndex + '）');
          }
          assertSimpleAssetProfile(section.points, id + '.loft section ' + sectionIndex, BadRequestException);
          const signedArea = section.points.reduce((sum: number, point: number[], pointIndex: number) => {
            const next = section.points[(pointIndex + 1) % section.points.length];
            return sum + point[0] * next[1] - next[0] * point[1];
          }, 0);
          const orientation = Math.sign(signedArea);
          if (contourOrientation && orientation !== contourOrientation) {
            throw new BadRequestException(id + '.loft 各截面必须保持一致的轮廓绕序');
          }
          contourOrientation = orientation;
          previousHeight = section.height;
          return { height: section.height, points: section.points.map((point: number[]) => [...point]) };
        });
      }
      return {
        id, kind, name: String(node.name || id).slice(0,120), role: String(node.role || 'component').slice(0,80),
        hidden: node.hidden === true, locked: node.locked === true,
        ...(typeof node.parent === 'string' && node.parent ? { parent: node.parent } : {}),
        ...(kind === 'mesh' ? { primitive, dimensions: { width, height, depth }, material: node.material } : {}),
        transform: {
          position: vector(transform.position, [0,0,0], id + '.position', -100, 100),
          rotation: vector(transform.rotation, [0,0,0], id + '.rotation', -100, 100),
          scale,
        },
        ...(kind === 'mesh' && Object.keys(geometryDescriptor).length ? { geometryDescriptor } : {}),
      };
    });
    const byId = new Map<string, any>(componentTree.map((node: any) => [node.id, node] as [string, any]));
    for (const node of componentTree) {
      if (node.parent && !byId.has(node.parent)) throw new BadRequestException('组件父节点不存在：' + node.id);
      const visited = new Set([node.id]);
      let parent = node.parent;
      let depth = 1;
      while (parent) {
        if (visited.has(parent)) throw new BadRequestException('组件树存在循环引用：' + node.id);
        visited.add(parent);
        if (++depth > 16) throw new BadRequestException('组件树层级超过 16 层');
        parent = byId.get(parent)?.parent;
      }
    }
    const rootNodes = componentTree.filter((node: any) => !node.parent);
    if (rootNodes.length !== 1) throw new BadRequestException('资产组件必须连接到唯一主体根节点，不能拆成多个独立物体');
    const generators = normalizeObjectGenerators(input.generators ?? original.objectSculptSpec?.generators, componentTree);
    const constraints = normalizeObjectConstraints(input.constraints ?? original.objectSculptSpec?.constraints, generators, componentTree);
    const generatorParameterIds = new Set(generators.flatMap((generator: any) => generator.type === 'grid' ? [generator.rowParameterId, generator.columnParameterId] : [generator.countParameterId]));
    const parameterSchema = normalizeObjectParameterSchema(input.parameterSchema ?? original.objectSculptSpec?.parameterSchema, componentTree, materials, generatorParameterIds);
    for (const generator of generators) {
      const parameterIds = generator.type === 'grid' ? [generator.rowParameterId, generator.columnParameterId] : [generator.countParameterId];
      const maximums = generator.type === 'grid' ? [generator.maxRows, generator.maxColumns] : [generator.maxCount];
      for (let index = 0; index < parameterIds.length; index += 1) {
        const parameter = parameterSchema.find((item: any) => item.id === parameterIds[index]);
        const maximum = Number(maximums[index]);
        if (!parameter || parameter.type !== 'number' || !Number.isInteger(parameter.min) || !Number.isInteger(parameter.max)
          || !Number.isFinite(maximum) || parameter.min < 1 || parameter.max > maximum) throw new BadRequestException('结构生成器必须绑定有效的整数数量参数：' + generator.id);
      }
    }
    const design = {
      ...original,
      objectSculptSpec: {
        schemaVersion: '2.0',
        targetName: String(input.targetName || original.objectType).slice(0,120),
        category: String(input.category || original.category || 'other').slice(0,80),
        objectType: String(input.objectType || original.objectType || '3D 资产').slice(0,120),
        visualStyle: String(input.visualStyle || original.visualStyle || 'stylized').slice(0,80),
        materials,
        componentTree,
        parameterSchema,
        generators,
        constraints,
      },
      reviewed: true,
      reviewedAt: new Date().toISOString(),
    };
    const designToken = this.signToken('design', createHash('sha256').update(JSON.stringify(design)).digest('hex'));
    return { design, designToken, designTokenExpiresInSeconds: 900 };
  }

  /** 对选中节点及其子树执行 AI 局部修改；未选中节点由服务端强制保持不变。 */
  async modifyObjectDesign(objectSculptSpecInput: unknown, selectedNodeIdsInput: unknown, instructionInput: unknown) {
    const current = objectSculptSpecInput as Record<string, any> | undefined;
    const selectedIds = Array.isArray(selectedNodeIdsInput) ? selectedNodeIdsInput.filter((id: unknown) => typeof id === 'string') : [];
    const instruction = typeof instructionInput === 'string' ? instructionInput.trim().slice(0, 3000) : '';
    if (!current || !['2.0','3.0'].includes(current.schemaVersion) || !Array.isArray(current.componentTree) || !current.materials || typeof current.materials !== 'object') {
      throw new BadRequestException('当前 ObjectSculptSpec 无效');
    }
    if (!selectedIds.length || selectedIds.length > 30 || !instruction) throw new BadRequestException('请选择一个或多个部件并填写修改要求');
    const byId = new Map(current.componentTree.map((node: any) => [node.id, node]));
    if (selectedIds.some((id: string) => !byId.has(id))) throw new BadRequestException('选中的组件 ID 不存在');
    const allowedIds = new Set<string>(selectedIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const node of current.componentTree) {
        if (node.parent && allowedIds.has(node.parent) && !allowedIds.has(node.id)) { allowedIds.add(node.id); expanded = true; }
      }
    }
    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey || !model) throw new ServiceUnavailableException('AI 局部修改未配置视觉模型');
    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
          model, temperature: 0.15, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: [
              '你是结构化 3D 资产局部编辑器。输入为当前 ObjectSculptSpec、允许修改的节点 ID 和用户指令。',
              '只返回 JSON：{ "objectSculptSpec": <完整更新后的 ObjectSculptSpec> }。不要输出代码、Markdown、解释。',
              '只允许修改 allowedNodeIds 中的节点及其 geometry/material/transform/hidden/locked 属性。其他节点必须逐字段保持完全不变；不允许删除或新增节点，不允许修改未授权节点。',
              '允许修改目标节点 primitive、dimensions、geometryDescriptor、transform、material；materials 可新增材质或修改仅被授权节点使用的材质。若共享材质会影响未授权节点，必须创建独立材质并只重新绑定授权节点。',
              '保留所有节点 ID、parent 关系、未授权节点和 parameterSchema。对于 2.0 保留 generators；对于 3.0 必须逐字段保留 operations，不得修改或删除任何 operation。若原参数目标因修改失效，删除或修正对应参数定义。组件仍需保持唯一根节点、无循环和完整父级引用。',
              'AI 仅返回结构化 JSON，不得生成或执行 JavaScript。',
            ].join('\n') },
            { role: 'user', content: JSON.stringify({ instruction, allowedNodeIds: [...allowedIds], objectSculptSpec: current }) },
          ],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('AI 局部修改连接失败：' + message);
      throw new ServiceUnavailableException('无法连接 AI 局部修改服务');
    }
    if (!response.ok) throw new ServiceUnavailableException('AI 局部修改失败（HTTP ' + response.status + '）');
    const payload = await response.json() as any;
    let parsed: any;
    try { parsed = JSON.parse(payload?.choices?.[0]?.message?.content || ''); } catch {
      throw new ServiceUnavailableException('AI 局部修改未返回有效 JSON');
    }
    const updated = parsed?.objectSculptSpec;
    if (!updated || !Array.isArray(updated.componentTree)) throw new ServiceUnavailableException('AI 局部修改结果缺少 ObjectSculptSpec');
    const updatedById = new Map<string, any>(updated.componentTree.map((node: any) => [node.id, node] as [string, any]));
    if (updated.componentTree.length !== current.componentTree.length) throw new ServiceUnavailableException('局部修改不能新增或删除组件；请先通过结构树建立目标组件');
    for (const node of current.componentTree) {
      const after = updatedById.get(node.id);
      if (!after) throw new ServiceUnavailableException('局部修改结果丢失组件：' + node.id);
      if (!allowedIds.has(node.id) && stableSerialize(after) !== stableSerialize(node)) {
        throw new ServiceUnavailableException('局部修改越界：AI 修改了未选中的组件 ' + node.id);
      }
      if (after.parent !== node.parent) throw new ServiceUnavailableException('局部修改不得改变组件父子关系：' + node.id);
    }
    if (current.schemaVersion === '3.0') {
      if (updated.schemaVersion !== '3.0' || stableSerialize(updated.operations || []) !== stableSerialize(current.operations || [])) {
        throw new ServiceUnavailableException('局部修改不得擅自改变 ObjectModelSpec 3.0 operations');
      }
    } else if (stableSerialize(updated.generators || []) !== stableSerialize(current.generators || [])) {
      throw new ServiceUnavailableException('局部修改不得擅自改变资产结构生成规则');
    }
        if (stableSerialize(updated.parameterSchema || []) !== stableSerialize(current.parameterSchema || [])) {
      throw new ServiceUnavailableException('局部修改不得擅自改变资产参数 Schema');
    }
    const protectedMaterials = new Set<string>();
    for (const node of current.componentTree) if (!allowedIds.has(node.id) && typeof node.material === 'string') protectedMaterials.add(node.material);
    for (const key of protectedMaterials) {
      if (stableSerialize(updated.materials?.[key]) !== stableSerialize(current.materials?.[key])) {
        throw new ServiceUnavailableException('局部修改不得改变未选中组件共用的材质：' + key);
      }
    }
    if (current.schemaVersion === '3.0') {
      return {
        objectSculptSpec: { ...updated, operations: current.operations, parameterSchema: current.parameterSchema },
        affectedNodeIds: [...allowedIds],
      };
    }
    const design = {
      source: 'ai-vision-object-sculpt',
      category: String(current.category || 'other'),
      objectType: String(current.objectType || current.targetName || '3D 资产'),
      visualStyle: String(current.visualStyle || 'stylized'),
      reviewed: false,
      objectSculptSpec: current,
    };
    const token = this.signToken('design', createHash('sha256').update(JSON.stringify(design)).digest('hex'));
    const reviewed = this.reviewObjectDesign(design, token, updated);
    return { objectSculptSpec: reviewed.design.objectSculptSpec, affectedNodeIds: [...allowedIds] };
  }


  /** 根据自然语言为现有模型新增可调参数；只允许绑定当前真实存在的组件，不生成或执行脚本。 */
  async addObjectParameters(objectSculptSpecInput: unknown, instructionInput: unknown) {
    const current = objectSculptSpecInput as Record<string, any> | undefined;
    const instruction = typeof instructionInput === 'string' ? instructionInput.trim().slice(0, 3000) : '';
    if (!current || current.schemaVersion !== '3.0' || !Array.isArray(current.componentTree)
      || !current.materials || typeof current.materials !== 'object'
      || Object.prototype.hasOwnProperty.call(current, 'generators') || Object.prototype.hasOwnProperty.call(current, 'constraints')) {
      throw new BadRequestException('当前 ObjectSculptSpec 无效');
    }
    if (!instruction) throw new BadRequestException('请描述希望新增的模型参数');
    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey || !model) throw new ServiceUnavailableException('AI 参数设计未配置视觉模型');
    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
          model, temperature: 0.1, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: [
              '你是参数化 3D 模型的参数设计器。根据用户要求和当前 ObjectSculptSpec，为现有模型设计可编辑参数。',

                '只返回 ObjectModelSpec 3.0 参数设计 JSON：{ "componentTree": [...], "parameterSchema": [...], "operations": [...], "unsupported": [...] }。',
                'componentTree 必须完整返回。已有节点 ID、parent、kind、primitive、dimensions、geometryDescriptor、material、transform、name、role、locked 必须逐字段保持不变；只允许增加不带几何的逻辑 Group，且不得改变现有节点的层级关系。',
                'operations 必须原样保留，逐字段、逐项、原顺序返回；不得删除、重写、转换成 repeat/grid 或更改任何表达式。不得返回 generators 或 constraints。',
                'parameterSchema 必须完整返回。已有参数必须逐字段保持不变；新增参数 ID 唯一。普通参数包含 id、label、type(number/color/boolean/select)、value、targets；number 另含 min/max/step/unit，select 另含 options。',
                '参数目标使用真实数据路径，不使用固定属性白名单。property 可指向节点 dimensions、transform、geometryDescriptor 中当前真实存在的标量字段，或节点引用材质中真实存在的标量字段；也可使用 geometry.primitive 与 visibility.visible。不得虚构字段、访问 id/parent/kind 等结构身份字段或原型链字段。服务端根据目标当前值的数据类型审核参数。',
                'operations 引用的数量参数必须保留 targets=[]，不得为其增加普通属性目标。空间表达式引用的参数必须是 number 类型。',
                '无法准确识别目标、无法在当前结构上安全创建参数或用户要求超出当前表达式能力时，必须写入 unsupported；不得伪造参数目标或改写 operations。',
                '最多 100 个参数，每项最多 100 个目标；禁止返回 JavaScript、TypeScript、函数体、eval 或自定义执行代码。',
              ] : [
                '只返回 JSON：{ "componentTree": [...], "parameterSchema": [...], "generators": [...], "unsupported": [...] }。componentTree 必须是完整结构树；若无需重构，原样返回当前树。parameterSchema 和 generators 必须返回完整定义，原有定义必须逐字段保持不变。',
                '普通参数包含 id、label、type(number/color/boolean/select)、value、targets；number 另含 min/max/step/unit，select 另含 options。',
                'targets 只能引用当前 componentTree 中真实存在的 nodeId。property 使用点分隔的真实数据路径，可指向当前节点 dimensions、transform、geometryDescriptor 中存在的标量字段，或当前材质中存在的标量字段；geometry.primitive 和 visibility.visible 为专用语义目标。不得预先穷举属性字段，不得虚构不存在的字段或访问 id、parent、kind 等结构身份字段。服务端按实际目标值的数据类型验证参数。',
                '结构数量参数可以 targets=[]，但必须同时创建一个 generators 项并绑定 countParameterId。禁止把楼层数只映射到预生成节点显隐。',
                '没有可用原型时必须明确返回 unsupported，不能伪造目标或生成器。',
                'generators 支持 repeat 和 grid。repeat 格式包含 templateRootId/countParameterId/axis/spacing/defaultCount/maxCount；grid 格式包含 templateRootId/rowParameterId/columnParameterId/spacingX/spacingZ/defaultRows/defaultColumns/maxRows/maxColumns。原型必须是完整的 Group 子树。',
                'constraints 可选用于 follow/span/attach/adjacency/cutout 关系；只在关系明确且引用真实节点时创建。',
                '不能为没有合适原型的结构创建生成器；最大展开组件数量 300。所有参数 ID 唯一；最多 100 个参数，每项最多 100 个目标。',
                '禁止返回 JavaScript/TypeScript。AI 只声明参数数据，服务端会再次校验所有字段与目标。',

            ].join('\\n') },
            { role: 'user', content: JSON.stringify({ instruction, objectSculptSpec: current }) },
          ],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('AI 参数设计连接失败：' + message);
      throw new ServiceUnavailableException('无法连接 AI 参数设计服务');
    }
    if (!response.ok) throw new ServiceUnavailableException('AI 参数设计失败（HTTP ' + response.status + '）');
    const payload = await response.json() as any;
    let parsed: any;
    try { parsed = JSON.parse(payload?.choices?.[0]?.message?.content || ''); } catch {
      throw new ServiceUnavailableException('AI 参数设计未返回有效 JSON');
    }
    if (!Array.isArray(parsed?.parameterSchema)) throw new ServiceUnavailableException('AI 参数设计结果缺少 parameterSchema');
    const componentTree = Array.isArray(parsed.componentTree) ? parsed.componentTree : current.componentTree;
    if (!Array.isArray(componentTree) || componentTree.length > 100) throw new ServiceUnavailableException('参数化结构树超出组件数量限制');
    const currentNodes = new Map(current.componentTree.map((node: any) => [node.id, node]));
    const nextNodes = new Map(componentTree.map((node: any) => [node.id, node]));
    for (const [id, before] of currentNodes) {
      const after = nextNodes.get(id);
      if (!after) throw new ServiceUnavailableException('参数化不能删除现有组件：' + id);
      const protectedFields = ['primitive','dimensions','material','geometryDescriptor','transform','name','role','locked'];
      for (const field of protectedFields) {
        if (stableSerialize(after[field]) !== stableSerialize(before[field])) {
          throw new ServiceUnavailableException('参数化不能改变现有组件的几何或外观字段：' + id + '.' + field);
        }
      }
      if ((after.kind || 'mesh') !== (before.kind || 'mesh')) throw new ServiceUnavailableException('参数化不能改变现有组件类型：' + id);
    }
    for (const [id, node] of nextNodes) {
      if (!currentNodes.has(id) && (node.kind || 'mesh') !== 'group') {
        throw new ServiceUnavailableException('参数化只允许新增逻辑 Group，不允许新增 Mesh：' + id);
      }
    }
    const operations = Array.isArray(current.operations) ? current.operations : [];
    if (parsed.operations !== undefined && stableSerialize(parsed.operations) !== stableSerialize(operations)) {
      throw new ServiceUnavailableException('AI 参数设计不得修改或删除已有 operations');
    }
    if (parsed.generators !== undefined || parsed.constraints !== undefined) {
      throw new ServiceUnavailableException('ObjectModelSpec 3.0 不接受 generators/constraints，请使用 operations');
    }
    const operationParameterIds = new Set(operations.map((operation: any) => operation?.count?.parameterId).filter((id: unknown) => typeof id === 'string'));
    const parameterSchema = normalizeObjectParameterSchema(parsed.parameterSchema, componentTree, current.materials || {}, operationParameterIds);
    const previous = current.parameterSchema || [];
    const nextById = new Map(parameterSchema.map((item: any) => [item.id, item]));
    for (const item of previous) {
      if (stableSerialize(nextById.get(item.id)) !== stableSerialize(item)) {
        throw new ServiceUnavailableException('AI 参数设计不得修改或删除已有参数：' + item.id);
      }
    }
    return {
      objectSculptSpec: { ...current, componentTree, parameterSchema, operations },
      addedParameters: parameterSchema.filter((item: any) => !previous.some((old: any) => old.id === item.id)),
      unsupported: Array.isArray(parsed.unsupported) ? parsed.unsupported.filter((item: unknown) => typeof item === 'string').slice(0, 8) : [],
    };
  }

  async analyzeReference(imageDataUrlInput: unknown, approvalTokenInput: unknown, promptInput?: unknown) {
    const image = this.parseReferenceImage(imageDataUrlInput);
    const promptContext = typeof promptInput === 'string' ? promptInput.trim().slice(0, 4000) : '';
    if (typeof approvalTokenInput !== 'string' || !approvalTokenInput) {
      throw new BadRequestException('请先确认建筑参考图片，再执行 3D 结构识别');
    }
    const digest = createHash('sha256').update(image).digest('hex');
    let referenceApproved = false;
    try { referenceApproved = this.verifyToken(approvalTokenInput, 'reference', digest); } catch { referenceApproved = false; }
    if (!referenceApproved) {
      throw new BadRequestException('图片确认凭证无效、已过期或与当前预览图片不一致，请重新确认图片预览');
    }

    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey || !model) {
      throw new ServiceUnavailableException('建筑参考图识别未配置视觉模型，请检查现有 VISION_API_KEY、VISION_MODEL 和 VISION_API_BASE_URL');
    }

    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                '你是建筑视觉分析助手。根据单张建筑参考图，提取可用于参数化低多边形建筑生成器的外观参数。',
                '只返回 JSON，不要 Markdown。字段：template（必须从以下枚举选择：' + TEMPLATES.join('、') + '）；floors（1-30 整数）；roofStyle（flat/pitched/span/glass）；roofRise（0-3 场景单位）；massing（rectangular/L-shaped/U-shaped/T-shaped/H-shaped/courtyard）；facadeStyle（modern/classical/industrial/glass/brick）；facadeSections（1-8）；windowRows（1-30）；windowColumns（1-24）；windowDensity（0.1-3）；windowWidth（0.28-2）；windowHeight（0.2-2）；hasBalconies（布尔值）；balconyFloors（楼层数字数组）；columnCount（0-20）；hasArcade（布尔值）；entrancePosition（front/left/right/rear）；podiumFloors（0-5）；roofColor（roofRed/roofGray/roofGreen/roofBlue）；doorWidth（0.5-3）；wallPalette（wallCream/wallPeach/wallMint/wall）；confidence（0-1）；evidence（字符串数组，最多 8 条）；limitations（字符串数组，最多 8 条）。',
                '不要输出建筑真实长宽、真实高度、地理位置或测绘结论。单张图无法确认的结构按保守值估计，并降低 confidence。',
                'roofStyle: 平屋顶选 flat，双坡屋顶选 pitched，跨度大/体育馆式屋顶选 span，玻璃顶选 glass。',
                'windowDensity 表示窗户密度；windowRows/windowColumns 描述可见立面的行列节奏。请按图片实际可见结构判断，不要统一套用教学楼。',
                'massing 必须根据建筑主体轮廓选择；facadeStyle、facadeSections、阳台、柱廊、入口位置和屋顶颜色必须反映图片可见特征。无法确认时选保守值并写入 limitations。',
                '请优先识别立面结构：主楼体与侧翼、裙房/基座、重复窗格、阳台、柱廊、檐口、屋顶体量；不要只给建筑分类。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这张校园建筑参考图，给出可直接驱动参数化 3D 几何生成器的外观参数。用户补充要求：' + (promptContext || '无') },
                { type: 'image_url', image_url: { url: imageDataUrlInput, detail: 'high' } },
              ],
            },
          ],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('建筑参考图识别连接失败：' + message);
      throw new ServiceUnavailableException('无法连接视觉识别服务，请检查后端到模型服务的网络连接');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      this.logger.warn('建筑参考图识别 API HTTP ' + response.status + '：' + detail);
      throw new ServiceUnavailableException('建筑参考图识别失败（HTTP ' + response.status + '）');
    }

    const payload = await response.json() as any;
    const content = payload?.choices?.[0]?.message?.content;
    let parsed: any;
    try {
      parsed = typeof content === 'string' ? JSON.parse(content) : null;
    } catch {
      throw new ServiceUnavailableException('视觉模型未返回有效 JSON 建筑参数');
    }
    const number = (value: unknown, fallback: number, min: number, max: number) => {
      const parsedNumber = Number(value);
      return Number.isFinite(parsedNumber) ? Math.min(max, Math.max(min, parsedNumber)) : fallback;
    };
    const floors = Math.round(number(parsed?.floors, 3, 1, 30));
    const design = {
      schemaVersion: 1,
      source: 'ai-vision-estimate',
      template: TEMPLATES.includes(parsed?.template) ? parsed.template : '教学楼',
      floors,
      // 这是 Three.js 场景视觉单位，不是建筑实测高度。
      height: Math.min(80, Math.max(1, floors * 1.25)),
      heightBasis: 'estimated-scene-units-not-surveyed',
      roofStyle: ROOFS.includes(parsed?.roofStyle) ? parsed.roofStyle : 'flat',
      massing: ['rectangular','L-shaped','U-shaped','T-shaped','H-shaped','courtyard'].includes(parsed?.massing) ? parsed.massing : 'rectangular',
      facadeStyle: ['modern','classical','industrial','glass','brick'].includes(parsed?.facadeStyle) ? parsed.facadeStyle : 'modern',
      facadeSections: Math.round(number(parsed?.facadeSections, 3, 1, 8)),
      windowRows: Math.round(number(parsed?.windowRows, floors, 1, 30)),
      windowColumns: Math.round(number(parsed?.windowColumns, 6, 1, 24)),
      hasBalconies: parsed?.hasBalconies === true,
      balconyFloors: Array.isArray(parsed?.balconyFloors) ? parsed.balconyFloors.map((v: unknown) => Math.round(number(v, 1, 1, floors))).filter((v: number) => v <= floors).slice(0, 12) : [],
      columnCount: Math.round(number(parsed?.columnCount, 0, 0, 20)),
      hasArcade: parsed?.hasArcade === true,
      entrancePosition: ['front','left','right','rear'].includes(parsed?.entrancePosition) ? parsed.entrancePosition : 'front',
      podiumFloors: Math.round(number(parsed?.podiumFloors, 0, 0, 5)),
      roofColor: ['roofRed','roofGray','roofGreen','roofBlue'].includes(parsed?.roofColor) ? parsed.roofColor : 'roofRed',
      roofRise: number(parsed?.roofRise, 0.6, 0, 3),
      windowDensity: number(parsed?.windowDensity, 1, 0.1, 3),
      windowWidth: number(parsed?.windowWidth, 0.48, 0.28, 2),
      windowHeight: number(parsed?.windowHeight, 0.62, 0.2, 2),
      doorWidth: number(parsed?.doorWidth, 0.9, 0.5, 3),
      wallPalette: WALLS.includes(parsed?.wallPalette) ? parsed.wallPalette : 'wallCream',
      confidence: number(parsed?.confidence, 0.35, 0, 1),
      evidence: Array.isArray(parsed?.evidence) ? parsed.evidence.filter((item: unknown) => typeof item === 'string').slice(0, 6).map((item: string) => item.slice(0, 180)) : [],
      limitations: Array.isArray(parsed?.limitations) ? parsed.limitations.filter((item: unknown) => typeof item === 'string').slice(0, 8).map((item: string) => item.slice(0, 180)) : [],
      reviewed: false,
    };
    const designDigest = createHash('sha256').update(JSON.stringify(design)).digest('hex');
    const designToken = this.signToken('design', designDigest);
    return { provider: baseUrl, model, design, designToken, designTokenExpiresInSeconds: 900 };
  }

  /** 通用场景资产识别：只处理已具备孤立 Mesh 生成器的类别。 */
  async analyzeSceneReference(
    categoryInput: unknown,
    objectTypeInput: unknown,
    visualStyleInput: unknown,
    imageDataUrlInput: unknown,
    approvalTokenInput: unknown,
    promptInput?: unknown,
  ) {
    const category = typeof categoryInput === 'string' ? categoryInput.trim().toLowerCase() : '';
    const objectType = typeof objectTypeInput === 'string' ? objectTypeInput.trim() : '';
    const visualStyle = typeof visualStyleInput === 'string' ? visualStyleInput.trim() : 'stylized';
    const supported: Record<string, string[]> = {
      vegetation: ['tree', '乔木', '香樟树', '树木', '大树', 'shrub', '灌木', '绿篱', '灌木丛', 'flower', '花卉', '花坛', '花丛'],
      structure: ['bridge', '拱桥', '桥梁', '人行桥', '廊架', 'pergola', '亭子', 'pavilion'],
      facility: ['bench', '长椅', '座椅', 'lamp', '路灯', '庭院灯', 'bin', '垃圾桶', 'sign', '指示牌', '公告栏'],
      decoration: ['rock', '景观石', '假山', 'flowerbed', '花坛'],
      sports: ['basketball-hoop', '篮球架', '篮球框'],
    };
    const styles = ['anime-painted', 'hand-painted', 'low-poly', 'realistic', 'pixel-art', 'stylized', 'toon', 'chinese-traditional', 'european-classical', 'futuristic'];
    if (!supported[category]) throw new BadRequestException('该场景类别尚未接入视觉识别 schema：' + category);
    if (!supported[category].includes(objectType)) throw new BadRequestException('对象类型与场景类别不匹配或暂不支持');
    if (!styles.includes(visualStyle)) throw new BadRequestException('视觉风格无效');
    const image = this.parseReferenceImage(imageDataUrlInput);
    if (typeof approvalTokenInput !== 'string' || !approvalTokenInput) throw new BadRequestException('请先确认场景资产参考图片，再执行结构识别');
    const imageDigest = createHash('sha256').update(image).digest('hex');
    let approved = false;
    try { approved = this.verifyToken(approvalTokenInput, 'reference', imageDigest); } catch { approved = false; }
    if (!approved) throw new BadRequestException('图片确认凭证无效、已过期或与当前预览图片不一致，请重新确认图片预览');

    const schemaGuidance: Record<string, string> = {
      vegetation: '识别植被形态。JSON 字段：form(tree/shrub/flower)、canopyShape(round/conical/layered/irregular)、trunkRatio(0.15-0.7)、crownLayers(1-6 整数)、branchSpread(0.2-1)、leafPalette(green/darkGreen/yellowGreen/red/autumn)、flowerCount(0-24 整数)。',
      structure: '识别构筑物结构。JSON 字段：form(bridge/pergola/pavilion)、bridgeForm(arch/beam/suspension)、supportCount(2-16 整数)、hasRailing(布尔值)、hasRoof(布尔值)、roofProfile(flat/pitched/curved)、spanRatio(0.3-8)、ornamentLevel(0-3 整数)。',
      facility: '识别公共设施结构。JSON 字段：form(bench/lamp/bin/sign)、seatCount(1-5 整数)、hasBackrest(布尔值)、hasArmrest(布尔值)、poleCount(1-4 整数)、fixtureShape(box/round/lantern)、boardShape(rectangle/round/arrow)、detailLevel(0-3 整数)。',
      decoration: '识别景观装饰。JSON 字段：form(rock/flowerbed)、rockShape(boulder/rugged/stacked)、rockCount(1-8 整数)、borderShape(rectangle/round/organic)、flowerCount(0-40 整数)、layerCount(1-5 整数)、ornamentLevel(0-3 整数)。',
      sports: '识别运动设施。JSON 字段：form(basketball-hoop)、supportType(single/dual/wall)、backboardShape(rectangle/fan)、rimVisible(布尔值)、baseType(fixed/mobile)、braceCount(0-6 整数)。',
    };
    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey || !model) throw new ServiceUnavailableException('场景资产视觉识别未配置视觉模型，请检查 VISION_API_KEY、VISION_MODEL 和 VISION_API_BASE_URL');
    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
          model, temperature: 0.1, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: [
              '你是通用 3D 场景资产结构分析助手。只返回 JSON，不要 Markdown。',
              '目标分类：' + category + '；对象类型：' + objectType + '；目标视觉风格：' + visualStyle + '。',
              schemaGuidance[category],
              '另返回 confidence(0-1)、evidence(字符串数组最多 6 条)、limitations(字符串数组最多 8 条)。',
              '只描述图片中可见的结构，不推断真实尺寸、地理位置、材质物理属性或不可见背面。缺失信息采用保守值并写入 limitations。',
              '结构类型必须服从给定 category/objectType，不得将参考图改识别成其他类别。数值必须处于字段范围。',
            ].join('\n') },
            { role: 'user', content: [
              { type: 'text', text: '分析已由用户确认的场景资产图片，提取可驱动 Three.js 参数化模型的结构参数。补充要求：' + (typeof promptInput === 'string' ? promptInput.trim().slice(0, 4000) : '无') },
              { type: 'image_url', image_url: { url: imageDataUrlInput, detail: 'high' } },
            ] },
          ],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('场景资产视觉识别连接失败：' + message);
      throw new ServiceUnavailableException('无法连接场景资产视觉识别服务，请检查后端网络连接');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      this.logger.warn('场景资产视觉识别 API HTTP ' + response.status + '：' + detail);
      throw new ServiceUnavailableException('场景资产视觉识别失败（HTTP ' + response.status + '）');
    }
    const payload = await response.json() as any;
    const raw = payload?.choices?.[0]?.message?.content;
    let parsed: any;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : null; } catch {
      throw new ServiceUnavailableException('视觉模型未返回有效 JSON 场景结构参数');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ServiceUnavailableException('视觉模型返回的场景结构参数格式无效');
    const bounded = (value: unknown, fallback: number, min: number, max: number) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    const enumValue = (value: unknown, allowed: string[], fallback: string) => allowed.includes(String(value)) ? String(value) : fallback;
    const boolValue = (value: unknown) => value === true;
    const geometry: Record<string, unknown> = {};
    const numberFields: Record<string, Record<string, [number, number, number]>> = {
      vegetation: { trunkRatio: [0.38, 0.15, 0.7], crownLayers: [2, 1, 6], branchSpread: [0.65, 0.2, 1], flowerCount: [8, 0, 24] },
      structure: { supportCount: [4, 2, 16], spanRatio: [2, 0.3, 8], ornamentLevel: [1, 0, 3] },
      facility: { seatCount: [3, 1, 5], poleCount: [1, 1, 4], detailLevel: [1, 0, 3] },
      decoration: { rockCount: [3, 1, 8], flowerCount: [12, 0, 40], layerCount: [2, 1, 5], ornamentLevel: [1, 0, 3] },
      sports: { braceCount: [2, 0, 6] },
    };
    const decimalFields = new Set(['trunkRatio', 'branchSpread', 'spanRatio']);
    for (const [key, [fallback, min, max]] of Object.entries(numberFields[category])) {
      const value = bounded(parsed[key], fallback, min, max);
      geometry[key] = decimalFields.has(key) ? value : Math.round(value);
    }
    const enumFields: Record<string, Record<string, [string[], string]>> = {
      vegetation: { form: [['tree','shrub','flower'], 'tree'], canopyShape: [['round','conical','layered','irregular'], 'round'], leafPalette: [['green','darkGreen','yellowGreen','red','autumn'], 'green'] },
      structure: { form: [['bridge','pergola','pavilion'], 'bridge'], bridgeForm: [['arch','beam','suspension'], 'arch'], roofProfile: [['flat','pitched','curved'], 'flat'] },
      facility: { form: [['bench','lamp','bin','sign'], 'bench'], fixtureShape: [['box','round','lantern'], 'box'], boardShape: [['rectangle','round','arrow'], 'rectangle'] },
      decoration: { form: [['rock','flowerbed'], 'rock'], rockShape: [['boulder','rugged','stacked'], 'rugged'], borderShape: [['rectangle','round','organic'], 'organic'] },
      sports: { form: [['basketball-hoop'], 'basketball-hoop'], supportType: [['single','dual','wall'], 'single'], backboardShape: [['rectangle','fan'], 'rectangle'], baseType: [['fixed','mobile'], 'fixed'] },
    };
    for (const [key, [allowed, fallback]] of Object.entries(enumFields[category])) geometry[key] = enumValue(parsed[key], allowed, fallback);
    const booleanFields: Record<string, string[]> = {
      vegetation: [], structure: ['hasRailing','hasRoof'], facility: ['hasBackrest','hasArmrest'], decoration: [], sports: ['rimVisible'],
    };
    for (const key of booleanFields[category]) geometry[key] = boolValue(parsed[key]);
    const canonicalForms: Record<string, Record<string, string>> = {
      vegetation: { tree: 'tree', '乔木': 'tree', '香樟树': 'tree', '树木': 'tree', '大树': 'tree', shrub: 'shrub', '灌木': 'shrub', '绿篱': 'shrub', '灌木丛': 'shrub', flower: 'flower', '花卉': 'flower', '花坛': 'flower', '花丛': 'flower' },
      structure: { bridge: 'bridge', '拱桥': 'bridge', '桥梁': 'bridge', '人行桥': 'bridge', '廊架': 'pergola', pergola: 'pergola', '亭子': 'pavilion', pavilion: 'pavilion' },
      facility: { bench: 'bench', '长椅': 'bench', '座椅': 'bench', lamp: 'lamp', '路灯': 'lamp', '庭院灯': 'lamp', bin: 'bin', '垃圾桶': 'bin', sign: 'sign', '指示牌': 'sign', '公告栏': 'sign' },
      decoration: { rock: 'rock', '景观石': 'rock', '假山': 'rock', flowerbed: 'flowerbed', '花坛': 'flowerbed' },
      sports: { 'basketball-hoop': 'basketball-hoop', '篮球架': 'basketball-hoop', '篮球框': 'basketball-hoop' },
    };
    geometry.form = canonicalForms[category][objectType];
    const design = {
      schemaVersion: 1, source: 'ai-vision-estimate', category, objectType, visualStyle, referenceImageSha256: imageDigest, geometry,
      confidence: bounded(parsed.confidence, 0.35, 0, 1),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter((x: unknown) => typeof x === 'string').slice(0, 6).map((x: string) => x.slice(0, 180)) : [],
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations.filter((x: unknown) => typeof x === 'string').slice(0, 8).map((x: string) => x.slice(0, 180)) : [],
      reviewed: false,
    };
    const tokenPayload = { category, objectType, visualStyle, design };
    const designDigest = createHash('sha256').update(JSON.stringify(tokenPayload)).digest('hex');
    const designToken = this.signToken('design', designDigest);
    return { provider: baseUrl, model, category, objectType, visualStyle, design, designToken, designTokenExpiresInSeconds: 900 };
  }

  /**
   * 人工审核 AI 识别参数。原始识别凭证必须有效；只允许编辑当前分类 schema
   * 中已声明的字段，并对数值/枚举/布尔值重新做服务端校验。
   * 返回的新凭证绑定审核后的完整参数，原始 AI 凭证不能直接用于模板发布。
   */
  reviewSceneDesign(categoryInput: unknown, objectTypeInput: unknown, visualStyleInput: unknown, originalDesignInput: unknown, originalTokenInput: unknown, geometryInput: unknown) {
    const category = String(categoryInput || '');
    const objectType = String(objectTypeInput || '').trim();
    const visualStyle = String(visualStyleInput || '').trim();
    const original = originalDesignInput as Record<string, any> | undefined;
    const supported = ['vegetation', 'structure', 'facility', 'decoration', 'sports'];
    if (!supported.includes(category) || !objectType || !visualStyle || !original || typeof original !== 'object') {
      throw new BadRequestException('仅支持审核已接入的五类对象识别结果');
    }
    if (original.category !== category || original.objectType !== objectType || original.visualStyle !== visualStyle) {
      throw new BadRequestException('原始识别结果与当前分类、对象类型或视觉风格不一致');
    }
    if (original.reviewed === true || !this.consumeSceneDesignToken(originalTokenInput, category, objectType, visualStyle, original)) {
      throw new BadRequestException('原始 AI 识别凭证无效、已审核或已过期，请重新识别');
    }
    const rules: Record<string, { numbers: Record<string, [number, number]>; enums: Record<string, string[]>; booleans: string[] }> = {
      vegetation: {
        numbers: { trunkRatio: [0.15, 0.7], crownLayers: [1, 6], branchSpread: [0.2, 1], flowerCount: [0, 24] },
        enums: { form: ['tree','shrub','flower'], canopyShape: ['round','conical','layered','irregular'], leafPalette: ['green','darkGreen','yellowGreen','red','autumn'] }, booleans: [],
      },
      structure: {
        numbers: { supportCount: [2, 16], spanRatio: [0.3, 8], ornamentLevel: [0, 3] },
        enums: { form: ['bridge','pergola','pavilion'], bridgeForm: ['arch','beam','suspension'], roofProfile: ['flat','pitched','curved'] }, booleans: ['hasRailing','hasRoof'],
      },
      facility: {
        numbers: { seatCount: [1, 5], poleCount: [1, 4], detailLevel: [0, 3] },
        enums: { form: ['bench','lamp','bin','sign'], fixtureShape: ['box','round','lantern'], boardShape: ['rectangle','round','arrow'] }, booleans: ['hasBackrest','hasArmrest'],
      },
      decoration: {
        numbers: { rockCount: [1, 8], flowerCount: [0, 40], layerCount: [1, 5], ornamentLevel: [0, 3] },
        enums: { form: ['rock','flowerbed'], rockShape: ['boulder','rugged','stacked'], borderShape: ['rectangle','round','organic'] }, booleans: [],
      },
      sports: {
        numbers: { braceCount: [0, 6] },
        enums: { form: ['basketball-hoop'], supportType: ['single','dual','wall'], backboardShape: ['rectangle','fan'], baseType: ['fixed','mobile'] }, booleans: ['rimVisible'],
      },
    };
    const schema = rules[category];
    const originalGeometry = original.geometry;
    if (!originalGeometry || typeof originalGeometry !== 'object' || Array.isArray(originalGeometry)
      || !geometryInput || typeof geometryInput !== 'object' || Array.isArray(geometryInput)) {
      throw new BadRequestException('待审核几何参数格式无效');
    }
    const beforeKeys = Object.keys(originalGeometry).sort();
    const afterKeys = Object.keys(geometryInput as object).sort();
    if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
      throw new BadRequestException('审核参数字段与当前类别 Schema 不一致，不允许新增或删除字段');
    }
    const geometry: Record<string, unknown> = {};
    for (const key of beforeKeys) {
      const value = (geometryInput as Record<string, unknown>)[key];
      if (Object.prototype.hasOwnProperty.call(schema.numbers, key)) {
        const [min, max] = schema.numbers[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
          throw new BadRequestException('参数 ' + key + ' 超出允许范围 ' + min + '–' + max);
        }
        geometry[key] = Number.isInteger(Number(originalGeometry[key])) && !['trunkRatio','branchSpread','spanRatio'].includes(key)
          ? Math.round(value) : value;
      } else if (Object.prototype.hasOwnProperty.call(schema.enums, key)) {
        if (typeof value !== 'string' || !schema.enums[key].includes(value)) throw new BadRequestException('参数 ' + key + ' 不属于允许的枚举值');
        if (key === 'form' && value !== originalGeometry.form) throw new BadRequestException('对象结构主类型不可在参数审核阶段变更');
        geometry[key] = value;
      } else if (schema.booleans.includes(key)) {
        if (typeof value !== 'boolean') throw new BadRequestException('参数 ' + key + ' 必须为布尔值');
        geometry[key] = value;
      } else {
        throw new BadRequestException('参数 ' + key + ' 不属于当前类别 Schema');
      }
    }
    const design = { ...original, geometry, reviewed: true, reviewedAt: new Date().toISOString() };
    const digest = createHash('sha256').update(JSON.stringify({ category, objectType, visualStyle, design })).digest('hex');
    const designToken = this.signToken('design', digest);
    return { category, objectType, visualStyle, design, designToken, designTokenExpiresInSeconds: 900 };
  }

  /** 验证通用场景设计凭证，签名同时绑定分类、对象类型、风格和完整结构参数。 */
  consumeSceneDesignToken(tokenInput: unknown, category: string, objectType: string, visualStyle: string, designInput: unknown) {
    if (!designInput || typeof designInput !== 'object') return false;
    const digest = createHash('sha256').update(JSON.stringify({ category, objectType, visualStyle, design: designInput })).digest('hex');
    try { return this.verifyToken(tokenInput, 'design', digest); } catch { return false; }
  }

}
