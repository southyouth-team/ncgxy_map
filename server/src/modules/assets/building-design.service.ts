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
function normalizeObjectParameterSchema(input: unknown, componentTree: any[], materials: Record<string, any>, operationParameterIds = new Set<string>()) {
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
    if (!Array.isArray(raw.targets) || raw.targets.length > 100 || (raw.targets.length < 1 && !operationParameterIds.has(id))) throw new ServiceUnavailableException('参数目标不能为空或超出数量限制：' + id);
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
              '你是 ObjectModelSpec 3.0 参数设计器。根据用户要求为当前模型声明可编辑参数。',
              '只返回 JSON：{ "componentTree": [...], "parameterSchema": [...], "operations": [...], "unsupported": [...] }。',
              'componentTree 必须完整返回。已有节点 ID、parent、kind、primitive、dimensions、geometryDescriptor、material、transform、name、role、locked 必须逐字段保持不变；只允许增加不带几何的逻辑 Group，且不得改变现有节点的层级关系。',
              'operations 必须原样保留，逐字段、逐项、原顺序返回；不得删除、重写或更改任何表达式。不得返回 generators 或 constraints。',
              'parameterSchema 必须完整返回。已有参数必须逐字段保持不变；新增参数 ID 唯一。普通参数包含 id、label、type(number/color/boolean/select)、value、targets；number 另含 min/max/step/unit，select 另含 options。',
              '参数目标使用真实数据路径，不使用固定属性白名单。property 可指向节点 dimensions、transform、geometryDescriptor 中当前真实存在的标量字段，或节点引用材质中真实存在的标量字段；也可使用 geometry.primitive 与 visibility.visible。不得虚构字段、访问 id/parent/kind 等结构身份字段或原型链字段。服务端根据目标当前值的数据类型审核参数。',
              'operations 引用的数量参数必须保留 targets=[]，不得为其增加普通属性目标。空间表达式引用的参数必须是 number 类型。',
              '无法准确识别目标、无法在当前结构上安全创建参数或用户要求超出当前表达式能力时，必须写入 unsupported；不得伪造参数目标或改写 operations。',
              '最多 100 个参数，每项最多 100 个目标；禁止返回 JavaScript、TypeScript、函数体、eval 或自定义执行代码。',
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
    const operationParameterIds = new Set<string>();
    const collectExpressionParameterIds = (expression: any) => {
      if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return;
      if (expression.op === 'parameter' && typeof expression.id === 'string') operationParameterIds.add(expression.id);
      collectExpressionParameterIds(expression.left);
      collectExpressionParameterIds(expression.right);
      collectExpressionParameterIds(expression.value);
    };
    for (const operation of operations) {
      if (typeof operation?.count?.parameterId === 'string') operationParameterIds.add(operation.count.parameterId);
      for (const vector of [operation.transform?.position, operation.transform?.rotation, operation.transform?.scale]) {
        if (Array.isArray(vector)) vector.forEach(collectExpressionParameterIds);
      }
    }
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
