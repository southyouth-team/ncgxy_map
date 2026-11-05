import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const TEMPLATES = ['街区楼 A', '街区楼 B', '庭院楼', '坡顶楼', '教学楼', '宿舍楼', '办公楼', '实验楼', '图书馆', '体育馆'];
const ROOFS = ['flat', 'pitched', 'span', 'glass'];
const WALLS = ['wallCream', 'wallPeach', 'wallMint', 'wall'];
const PARAMETER_TARGETS = new Set(['dimensions.width','dimensions.height','dimensions.depth','transform.position.x','transform.position.y','transform.position.z','transform.scale.x','transform.scale.y','transform.scale.z','material.color','material.roughness','material.metalness','material.opacity','geometry.primitive','geometryDescriptor.inset','geometryDescriptor.tube','visibility.visible']);
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
    const spacingX = Number(raw.spacingX), spacingZ = Number(raw.spacingZ);
    const defaultRows = Number(raw.defaultRows), defaultColumns = Number(raw.defaultColumns);
    const maxRows = Number(raw.maxRows), maxColumns = Number(raw.maxColumns);
    if (![spacingX,spacingZ].every(value => Number.isFinite(value) && Math.abs(value) <= 100)
      || !Number.isInteger(defaultRows) || !Number.isInteger(defaultColumns) || !Number.isInteger(maxRows) || !Number.isInteger(maxColumns)
      || defaultRows < 1 || defaultColumns < 1 || maxRows < defaultRows || maxColumns < defaultColumns
      || maxRows > 100 || maxColumns > 100 || maxRows * maxColumns * descendants.length > 300) {
      throw new ServiceUnavailableException('网格生成器行列、间距或最大展开数量无效：' + id);
    }
    estimatedExpandedCount += descendants.length * (maxRows * maxColumns - 1);
    if (estimatedExpandedCount > 300) throw new ServiceUnavailableException('网格生成器最大展开数量超过 300：' + id);
    return { id, type: 'grid', templateRootId: raw.templateRootId, rowParameterId, columnParameterId, spacingX, spacingZ, defaultRows, defaultColumns, maxRows, maxColumns };
  });
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
      if (!nodeIds.has(target?.nodeId) || !PARAMETER_TARGETS.has(target?.property)) throw new ServiceUnavailableException('参数目标无效：' + id);
      if (node.kind === 'group' && !String(target.property).startsWith('transform.') && target.property !== 'visibility.visible') throw new ServiceUnavailableException('Group 节点仅支持变换和显隐参数：' + id);
      const mode = target.mode || 'set';
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
                'componentTree 是有意义的结构节点数组。节点字段：id（稳定唯一英文 ID）、kind（group 或 mesh，默认 mesh）、name、role、parent（唯一根节点省略，其余节点填写直接父节点 ID）、transform（position/rotation/scale）。group 是纯逻辑分组，不带 primitive/dimensions/material，可包含子节点；mesh 必须声明 primitive（box/cuboid/polygon/wedge/arch/cylinder/cone/sphere/ellipsoid/torus）、dimensions（width/height/depth）、material、geometryDescriptor（可选）。',
                '根据对象本身的真实组成自主决定组件数量和层级；不要求固定层数或固定部件数量。简单对象可以只有一个 Mesh；复杂对象必须拆分为可独立编辑的部件。',
                '整个资产必须只有一个根节点，其他节点通过 parent 形成连通树。子节点 position 是相对直接 parent 的局部坐标。parent 只定义层级，不会自动吸附几何体，必须根据尺寸和连接关系计算位置。',
                'parameterSchema 用于声明真正有意义的可编辑参数，而不是穷举通用参数。每项格式：id、label、type(number/color/boolean/select)、value；number 另含 min/max/step/unit；select 另含 options([{label,value}])；targets 为数组，每项含 nodeId、property、mode。property 只允许 dimensions.width/height/depth、transform.position.x/y/z、transform.scale.x/y/z、material.color/roughness/metalness/opacity、geometry.primitive、geometryDescriptor.inset/tube、visibility.visible。mode 允许 set/multiply/add；visibility.visible 还允许 visible-from/visible-through 并提供 threshold；材质只允许 set。',
                '只声明对当前资产有实际意义的参数。例如重复楼层、树冠层、车轮、窗户、叶片等结构的尺寸/颜色/比例；一个参数可绑定多个节点实现联动。不要凭空声明没有可控目标的参数。',
                '参数目标必须引用真实存在的 nodeId。数值参数给出合理 min/max/current value；颜色参数使用 #RRGGBB；枚举参数提供有限 options。不要输出表达式、函数、脚本或任意属性路径。',
                '材质颜色必须匹配参考图，不得全部白色/灰色。几何部件应合理接合，避免无理由漂浮。只推断图中可见结构，遮挡/背面不确定性写入 limitations。',
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
      if (kind === 'mesh' && !['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus'].includes(primitive)) throw new ServiceUnavailableException('组件几何类型不受支持：' + primitive);
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
      const geometryDescriptor: Record<string, number | number[][]> = {};
      if (kind === 'mesh' && input.geometryDescriptor && typeof input.geometryDescriptor === 'object') {
        if (input.geometryDescriptor.segments !== undefined) geometryDescriptor.segments = Math.round(number(input.geometryDescriptor.segments, 16, 3, 48));
        if (input.geometryDescriptor.tube !== undefined) geometryDescriptor.tube = number(input.geometryDescriptor.tube, 0.1, 0.01, 10);
        if (input.geometryDescriptor.inset !== undefined) geometryDescriptor.inset = number(input.geometryDescriptor.inset, 0.2, 0.02, 20);
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
    const parameterSchema = normalizeObjectParameterSchema(parsed.parameterSchema, componentTree, materials);
    const objectSculptSpec = {
      schemaVersion: '2.0',
      targetName: String(parsed.targetName || objectType || 'AI 生成资产').slice(0, 120),
      category: String(parsed.category || categoryHint || 'other').slice(0, 80),
      objectType: String(parsed.objectType || objectType || parsed.targetName || '3D 资产').slice(0, 120),
      visualStyle: String(parsed.visualStyle || visualStyle).slice(0, 80),
      materials,
      componentTree,
      parameterSchema,
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
    const primitives = ['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus'];
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
    const generatorParameterIds = new Set(generators.map((generator: any) => generator.countParameterId));
    const parameterSchema = normalizeObjectParameterSchema(input.parameterSchema ?? original.objectSculptSpec?.parameterSchema, componentTree, materials, generatorParameterIds);
    for (const generator of generators) {
      const parameter = parameterSchema.find((item: any) => item.id === generator.countParameterId);
      if (!parameter || parameter.type !== 'number' || parameter.min < 1 || parameter.max > generator.maxCount || !Number.isInteger(parameter.min) || !Number.isInteger(parameter.max) || generator.defaultCount < parameter.min || generator.defaultCount > parameter.max) {
        throw new BadRequestException('结构生成器必须绑定有效的整数数量参数：' + generator.id);
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
    if (!current || current.schemaVersion !== '2.0' || !Array.isArray(current.componentTree) || !current.materials || typeof current.materials !== 'object') {
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
              '保留所有节点 ID、parent 关系、未授权节点、parameterSchema 和 generators；不得修改或删除已有生成器定义。若原参数目标因修改失效，删除或修正对应参数定义。组件仍需保持唯一根节点、无循环和完整父级引用。',
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
    if (stableSerialize(updated.generators || []) !== stableSerialize(current.generators || [])) {
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
    if (!current || current.schemaVersion !== '2.0' || !Array.isArray(current.componentTree)
      || !current.materials || typeof current.materials !== 'object') {
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
              '只返回 JSON：{ "componentTree": [...], "parameterSchema": [...], "generators": [...], "unsupported": [...] }。componentTree 必须是完整结构树；若无需重构，原样返回当前树。parameterSchema 和 generators 必须返回完整定义，原有定义必须逐字段保持不变。',
              '普通参数包含 id、label、type(number/color/boolean/select)、value、targets；number 另含 min/max/step/unit，select 另含 options。',
              'targets 只能引用当前 componentTree 中真实存在的 nodeId。property 仅允许 dimensions.width/height/depth、transform.position.x/y/z、transform.scale.x/y/z、material.color/roughness/metalness/opacity、geometry.primitive、geometryDescriptor.inset/tube、visibility.visible。',
              '结构数量参数可以 targets=[]，但必须同时创建一个 generators 项并绑定 countParameterId。禁止把楼层数只映射到预生成节点显隐。',
              '没有可用原型时必须明确返回 unsupported，不能伪造目标或生成器。',
              '如果用户要求楼层数变量而当前楼层是多个独立重复节点，可以在 componentTree 中增加纯 Group 包装节点，把一个完整楼层整理为原型，并将其余静态重复楼层设为 hidden=true；必须保留所有原有节点 ID，不得删除原有节点，不得新增 Mesh，不得改变原有几何、材质、尺寸和 transform。无法可靠识别单层完整子树时，不得强行重构，应返回 unsupported。',
              'generators 只支持安全声明式 repeat：{id,type:"repeat",templateRootId,countParameterId,axis:"x"|"y"|"z",spacing,defaultCount,maxCount,followers:[{nodeId,axis,offset}]}。templateRootId 必须是当前 componentTree 中代表一个完整可重复单元的现有节点；其子树会作为原型复制。第一份保留原节点 ID，后续实例由运行时派生稳定 ID。defaultCount 必须等于数量参数默认 value；followers 用于在数量变化时同步移动屋顶等非重复节点。',
              '当用户要求楼层数时，寻找一个完整楼层 Group 子树作为模板，沿 y 轴重复，spacing 使用楼层高度；设置 defaultCount 为当前楼层数，maxCount 为允许上限，并把屋顶等结构加入 followers，沿 y 轴偏移 spacing*(楼层数-defaultCount)。屋顶等非重复结构不能放进楼层原型子树。',
              '当用户要求房间数时，只有能识别完整房间原型和合理排列轴/间距时才创建 repeat；否则说明当前模型缺少可重复房间结构，不能假装参数已生效。',
              '不能为没有合适原型的结构创建生成器；不允许执行脚本、表达式或自定义函数。最大展开组件数量 300。',
              '所有参数 ID 唯一；新增参数不得与现有 ID 冲突。最多 100 个参数，每项最多 100 个目标。',
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
    const generators = normalizeObjectGenerators(parsed.generators ?? current.generators ?? [], componentTree);
    const generatorParameterIds = new Set(generators.map((generator: any) => generator.countParameterId));
    const parameterSchema = normalizeObjectParameterSchema(parsed.parameterSchema, componentTree, current.materials, generatorParameterIds);
    for (const generator of generators) {
      const parameter = parameterSchema.find((item: any) => item.id === generator.countParameterId);
      if (!parameter || parameter.type !== 'number' || !Number.isInteger(parameter.min) || !Number.isInteger(parameter.max)
        || parameter.min < 1 || parameter.max > generator.maxCount || generator.defaultCount < parameter.min || generator.defaultCount > parameter.max) {
        throw new ServiceUnavailableException('结构生成器必须绑定有效的整数数量参数：' + generator.id);
      }
    }
    const previousGenerators = current.generators || [];
    const nextGeneratorById = new Map(generators.map((item: any) => [item.id, item]));
    for (const item of previousGenerators) {
      if (stableSerialize(nextGeneratorById.get(item.id)) !== stableSerialize(item)) {
        throw new ServiceUnavailableException('AI 参数设计不得修改或删除已有结构生成器：' + item.id);
      }
    }
    const previous = current.parameterSchema || [];
    const nextById = new Map(parameterSchema.map((item: any) => [item.id, item]));
    for (const item of previous) {
      if (stableSerialize(nextById.get(item.id)) !== stableSerialize(item)) {
        throw new ServiceUnavailableException('AI 参数设计不得修改或删除已有参数：' + item.id);
      }
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
    const reviewed = this.reviewObjectDesign(design, token, { ...current, componentTree, parameterSchema, generators });
    return {
      objectSculptSpec: reviewed.design.objectSculptSpec,
      addedParameters: parameterSchema.filter((item: any) => !previous.some((old: any) => old.id === item.id)),
      addedGenerators: generators.filter((item: any) => !(current.generators || []).some((old: any) => old.id === item.id)),
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
