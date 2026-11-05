import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
function validateGeneratedGeometryDescriptors(componentTree: any[]) {
  const point = (value: any, size: number, min = -0.5, max = 0.5) =>
    Array.isArray(value) && value.length === size && value.every(item => Number.isFinite(Number(item)) && Number(item) >= min && Number(item) <= max);
  for (const node of componentTree) {
    if ((node?.kind || 'mesh') !== 'mesh') continue;
    const primitive = String(node?.primitive || 'box').toLowerCase(), descriptor = node?.geometryDescriptor || {};
    const fail = (field: string, reason: string): never => { throw new Error('ObjectSculptSpec 几何协议错误：' + node.id + '.geometryDescriptor.' + field + ' ' + reason); };
    if (primitive === 'polygon') {
      if (!Array.isArray(descriptor.points) || descriptor.points.length < 3 || descriptor.points.length > 32 || !descriptor.points.every((v: any) => point(v, 2))) fail('points', '必须包含 3-32 个合法二维点');
    } else if (primitive === 'tube' || primitive === 'sweep') {
      if (!Array.isArray(descriptor.path) || descriptor.path.length < 2 || descriptor.path.length > 32 || !descriptor.path.every((v: any) => point(v, 3))) fail('path', '必须包含 2-32 个合法三维点');
      if (primitive === 'sweep' && (!Array.isArray(descriptor.profile) || descriptor.profile.length < 3 || descriptor.profile.length > 24 || !descriptor.profile.every((v: any) => point(v, 2)))) fail('profile', '必须包含 3-24 个合法二维点');
    } else if (primitive === 'lathe') {
      if (!Array.isArray(descriptor.profile) || descriptor.profile.length < 2 || descriptor.profile.length > 32 || !descriptor.profile.every((v: any) => Array.isArray(v) && v.length === 2 && Number.isFinite(Number(v[0])) && Number(v[0]) >= 0 && Number(v[0]) <= 0.5 && Number.isFinite(Number(v[1])) && Number(v[1]) >= -0.5 && Number(v[1]) <= 0.5)) fail('profile', '必须包含 2-32 个合法旋转截面点');
    } else if (primitive === 'loft') {
      const sections = descriptor.sections;
      if (!Array.isArray(sections) || sections.length < 2 || sections.length > 12) fail('sections', '必须包含 2-12 个截面');
      let count: number | null = null, previous = -Infinity;
      sections.forEach((section: any, index: number) => {
        if (!section || typeof section !== 'object' || !Number.isFinite(Number(section.height)) || Number(section.height) < -0.5 || Number(section.height) > 0.5
          || !Array.isArray(section.points) || section.points.length < 3 || section.points.length > 24 || !section.points.every((v: any) => point(v, 2))) {
          throw new Error('ObjectSculptSpec 几何协议错误：' + node.id + '.geometryDescriptor.sections[' + index + '] 格式无效');
        }
        if (count === null) count = section.points.length;
        if (section.points.length !== count) fail('sections', '所有截面必须具有相同数量的轮廓点');
        if (Number(section.height) <= previous) fail('sections', 'height 必须严格递增');
        previous = Number(section.height);
      });
    }
  }
}
const PARAMETER_BINDINGS = new Set(['dimensions.width','dimensions.height','dimensions.depth','transform.position.x','transform.position.y','transform.position.z','transform.scale.x','transform.scale.y','transform.scale.z','material.color','material.roughness','material.metalness','material.opacity','geometry.primitive','geometryDescriptor.inset','geometryDescriptor.tube','geometryDescriptor.radius','visibility.visible']);
function validateGeneratedParameterSchema(input: unknown, componentTree: any[], generatorParameterIds = new Set<string>()) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 100) throw new ServiceUnavailableException('视觉模型返回的 parameterSchema 无效或超出 100 项');
  const ids = new Set<string>(), nodes = new Set(componentTree.map(node => node.id));
  for (const item of input) {
    if (!item || typeof item !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(item.id || '') || ids.has(item.id)) throw new ServiceUnavailableException('AI 参数 ID 无效或重复');
    ids.add(item.id);
    if (!['number','color','boolean','select'].includes(item.type)) throw new ServiceUnavailableException('AI 参数类型无效：' + item.id);
    if (item.type === 'number' && (!Number.isFinite(item.value) || !Number.isFinite(item.min) || !Number.isFinite(item.max) || item.min > item.max || item.value < item.min || item.value > item.max)) throw new ServiceUnavailableException('AI 数值参数范围无效：' + item.id);
    if (item.type === 'color' && (typeof item.value !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.value))) throw new ServiceUnavailableException('AI 颜色参数无效：' + item.id);
    if (item.type === 'boolean' && typeof item.value !== 'boolean') throw new ServiceUnavailableException('AI 布尔参数无效：' + item.id);
    if (item.type === 'select' && (!Array.isArray(item.options) || !item.options.some((option: any) => option?.value === item.value))) throw new ServiceUnavailableException('AI 枚举参数无效：' + item.id);
    if (!Array.isArray(item.targets) || item.targets.length > 100 || (!item.targets.length && !generatorParameterIds.has(item.id))) throw new ServiceUnavailableException('AI 参数目标无效：' + item.id);
    for (const target of item.targets) {
      if (!nodes.has(target?.nodeId) || !PARAMETER_BINDINGS.has(target?.property)) throw new ServiceUnavailableException('AI 参数目标引用无效：' + item.id);
      const mode = target.mode || 'set';
      if (!['set','multiply','add','visible-from','visible-through'].includes(mode)) throw new ServiceUnavailableException('AI 参数目标运算无效：' + item.id);
      if (['visible-from','visible-through'].includes(mode) && (target.property !== 'visibility.visible' || !Number.isFinite(target.threshold) || target.threshold < 1 || target.threshold > 100)) throw new ServiceUnavailableException('AI 参数可见性阈值无效：' + item.id);
      if (target.property === 'geometry.primitive' && item.type !== 'select') throw new ServiceUnavailableException('几何类型参数必须是枚举：' + item.id);
      if (target.property.startsWith('material.') && mode !== 'set') throw new ServiceUnavailableException('材质参数只允许 set：' + item.id);
    }
  }
  return input;
}

/**
 * 生成器模板必须以 Group 为根。模型有时会把单个 Mesh 直接声明为模板根，
 * 这里自动补一层无几何 Group，保留原节点及其局部变换，避免把可修复的结构偏差升级为 503。
 */
function normalizeGeneratorTemplateRoots(componentTree: any[], generators: any[]) {
  const byId = new Map(componentTree.map(node => [node.id, node]));
  const usedIds = new Set(byId.keys());
  for (const generator of generators) {
    const root = byId.get(generator?.templateRootId);
    if (!root) continue; // 后续 validator 会给出明确的引用错误
    if (String(root.kind || 'mesh').toLowerCase() === 'group') {
      root.kind = 'group';
      continue;
    }
    const originalParent = root.parent;
    const baseId = String(generator.id || 'generator') + '-template-group';
    let groupId = baseId, suffix = 2;
    while (usedIds.has(groupId)) groupId = baseId + '-' + suffix++;
    usedIds.add(groupId);
    const wrapper = {
      id: groupId,
      kind: 'group',
      name: (root.name || generator.id || '生成器模板') + '（结构组）',
      ...(originalParent ? { parent: originalParent } : {}),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    };
    root.parent = groupId;
    componentTree.push(wrapper);
    byId.set(groupId, wrapper);
    generator.templateRootId = groupId;
  }
}

function validateGeneratedGenerators(input: unknown, componentTree: any[]) {
  if (input == null) return { generators: [], parameterIds: new Set<string>() };
  if (!Array.isArray(input) || input.length > 30) throw new ServiceUnavailableException('AI generators 必须是最多 30 项的数组');
  const byId = new Map(componentTree.map(node => [node.id, node]));
  const ids = new Set<string>(), parameterIds = new Set<string>(), claimedNodes = new Set<string>();
  let expandedCount = componentTree.length;
  const getSubtree = (rootId: string) => componentTree.filter(node => {
    let parent = node.id;
    while (parent) {
      if (parent === rootId) return true;
      parent = byId.get(parent)?.parent;
    }
    return false;
  });
  const generators = input.map((raw: any) => {
    const id = typeof raw?.id === 'string' ? raw.id : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) || ids.has(id)
      || !['repeat','grid'].includes(raw?.type)) throw new ServiceUnavailableException('AI 结构生成器 ID 或类型无效：' + id);
    ids.add(id);
    const root = byId.get(raw.templateRootId);
    if (!root || (root.kind || 'mesh') !== 'group') throw new ServiceUnavailableException('AI 结构生成器模板根节点必须是 Group：' + id);
    const subtree = getSubtree(root.id);
    if (!subtree.length) throw new ServiceUnavailableException('AI 结构生成器模板子树为空：' + id);
    for (const node of subtree) {
      if (claimedNodes.has(node.id)) throw new ServiceUnavailableException('AI 结构生成器模板不能嵌套或重叠：' + id);
      claimedNodes.add(node.id);
    }
    const parameterId = (value: unknown): string => {
      if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) {
        throw new ServiceUnavailableException('AI 结构生成器数量参数引用 ID 无效：' + id);
      }
      // Generator parameter IDs are references to shared business parameters.
      // Uniqueness belongs to parameterSchema and to row/column pairs within one grid, not across generators.
      parameterIds.add(value);
      return value;
    };
    if (raw.type === 'repeat') {
      const countParameterId = parameterId(raw.countParameterId);
      const spacing = Number(raw.spacing), defaultCount = Number(raw.defaultCount), maxCount = Number(raw.maxCount);
      if (!['x','y','z'].includes(raw.axis) || !Number.isFinite(spacing) || Math.abs(spacing) > 100
        || !Number.isInteger(defaultCount) || !Number.isInteger(maxCount) || defaultCount < 1 || defaultCount > maxCount || maxCount > 100
        || (raw.followers !== undefined && (!Array.isArray(raw.followers) || raw.followers.length > 30))) {
        throw new ServiceUnavailableException('AI repeat 生成器间距、轴向或数量范围无效：' + id);
      }
      const followers = (raw.followers || []).map((follower: any) => {
        if (!byId.has(follower?.nodeId) || !['x','y','z'].includes(follower.axis)
          || subtree.some(node => node.id === follower.nodeId) || !Number.isFinite(Number(follower.offset ?? 0))
          || Math.abs(Number(follower.offset ?? 0)) > 100) throw new ServiceUnavailableException('AI repeat followers 无效：' + id);
        return follower;
      });
      expandedCount += subtree.length * (maxCount - 1);
      if (expandedCount > 300) throw new ServiceUnavailableException('AI 生成器最大展开组件数超过 300：' + id);
      return { ...raw, id, countParameterId, spacing, defaultCount, maxCount, followers };
    }
    const rowParameterId = parameterId(raw.rowParameterId), columnParameterId = parameterId(raw.columnParameterId);
    const spacingX = Number(raw.spacingX), spacingZ = Number(raw.spacingZ);
    const spacingXParameterId = raw.spacingXParameterId == null ? undefined : raw.spacingXParameterId;
    const spacingZParameterId = raw.spacingZParameterId == null ? undefined : raw.spacingZParameterId;
    // Dynamic spacing parameters are generator controls too; they may intentionally
    // have no component targets, just like repeat counts and grid dimensions.
    if (spacingXParameterId) parameterIds.add(spacingXParameterId);
    if (spacingZParameterId) parameterIds.add(spacingZParameterId);
    const spacingXScale = Number(raw.spacingXScale), spacingZScale = Number(raw.spacingZScale);
    const defaultRows = Number(raw.defaultRows), defaultColumns = Number(raw.defaultColumns);
    const maxRows = Number(raw.maxRows), maxColumns = Number(raw.maxColumns);
    if (raw.centered !== undefined && typeof raw.centered !== 'boolean') throw new ServiceUnavailableException('AI grid centered 必须是布尔值：' + id);
    if ((spacingXParameterId && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(spacingXParameterId) || !Number.isFinite(spacingXScale) || Math.abs(spacingXScale) > 10)) || (spacingZParameterId && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(spacingZParameterId) || !Number.isFinite(spacingZScale) || Math.abs(spacingZScale) > 10))) throw new ServiceUnavailableException('AI grid 动态间距比例无效：' + id);
    if (rowParameterId === columnParameterId || ![spacingX,spacingZ].every(value => Number.isFinite(value) && Math.abs(value) <= 100)
      || ![defaultRows,defaultColumns,maxRows,maxColumns].every(Number.isInteger)
      || defaultRows < 1 || defaultColumns < 1 || defaultRows > maxRows || defaultColumns > maxColumns
      || maxRows > 100 || maxColumns > 100 || maxRows * maxColumns * subtree.length > 300) {
      throw new ServiceUnavailableException('AI grid 生成器行列、间距或最大展开数量无效：' + id);
    }
    expandedCount += subtree.length * (maxRows * maxColumns - 1);
    if (expandedCount > 300) throw new ServiceUnavailableException('AI 生成器最大展开组件数超过 300：' + id);
    return { ...raw, id, rowParameterId, columnParameterId, spacingX, spacingZ, spacingXParameterId, spacingXScale, spacingZParameterId, spacingZScale, centered: raw.centered === true, defaultRows, defaultColumns, maxRows, maxColumns };
  });
  return { generators, parameterIds };
}

function validateGeneratorParameterBindings(generators: any[], parameterSchema: any[]) {
  for (const generator of generators) {
    const ids = generator.type === 'grid' ? [generator.rowParameterId, generator.columnParameterId] : [generator.countParameterId];
    const defaults = generator.type === 'grid' ? [generator.defaultRows, generator.defaultColumns] : [generator.defaultCount];
    const maximums = generator.type === 'grid' ? [generator.maxRows, generator.maxColumns] : [generator.maxCount];
    for (let index = 0; index < ids.length; index += 1) {
      const parameter = parameterSchema.find(item => item.id === ids[index]);
      if (!parameter || parameter.type !== 'number' || !Number.isInteger(parameter.min)
        || !Number.isInteger(parameter.max) || !Number.isInteger(parameter.value)
        || parameter.min < 1 || parameter.max > maximums[index]
        || parameter.value !== defaults[index] || parameter.value < parameter.min || parameter.value > parameter.max) {
        throw new ServiceUnavailableException('AI 生成器必须绑定默认值一致的有效整数数量参数：' + generator.id);
      }
    }
    if (generator.type === 'grid') {
      for (const [parameterId, scale] of [[generator.spacingXParameterId, generator.spacingXScale], [generator.spacingZParameterId, generator.spacingZScale]]) {
        if (!parameterId) continue;
        const parameter = parameterSchema.find(item => item.id === parameterId);
        if (!parameter || parameter.type !== 'number' || !Number.isFinite(parameter.value) || !Number.isFinite(scale) || Math.abs(scale) > 10) throw new ServiceUnavailableException('AI 网格动态间距必须绑定有效数值参数：' + generator.id);
      }
    }
  }
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);

  constructor(private readonly config: ConfigService) {}

  async generate(promptInput: unknown) {
    if (typeof promptInput !== 'string' || !promptInput.trim()) {
      throw new BadRequestException('图片生成提示词不能为空');
    }
    const prompt = promptInput.trim();
    if (prompt.length > 12000) {
      throw new BadRequestException('图片生成提示词不能超过 12000 个字符');
    }

    // 图片生成配置优先独立读取；未单独配置时复用现有视觉服务的鉴权和 Base URL。
    // 识图模型仍由 VISION_MODEL 控制，不会被图片生成模型覆盖。
    const apiKey = this.config.get<string>('IMAGE_API_KEY')
      || this.config.get<string>('VISION_API_KEY');
    const configuredBaseUrl = this.config.get<string>('IMAGE_API_BASE_URL')
      || this.config.get<string>('VISION_API_BASE_URL')
      || 'https://api.openai.com/v1';
    const baseUrl = configuredBaseUrl.replace(/\/+$/, '');
    const model = this.config.get<string>('IMAGE_MODEL') || 'gpt-image-2';

    if (!apiKey) {
      throw new ServiceUnavailableException('图片生成服务未配置鉴权信息；请检查现有 IMAGE_API_KEY 或 VISION_API_KEY 环境变量');
    }

    let response: Response;
    try {
      response = await fetch(baseUrl + '/images/generations', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: '1024x1024',
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('图片生成服务连接失败：' + message);
      throw new ServiceUnavailableException('无法连接图片生成服务，请检查后端容器到 API 服务的网络地址及服务状态');
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      this.logger.warn('图片生成 API 返回 HTTP ' + response.status + '：' + detail);
      throw new ServiceUnavailableException('图片生成 API 请求失败（HTTP ' + response.status + '）：' + detail);
    }

    const payload = await response.json() as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const item = payload?.data?.[0];
    let imageBuffer: Buffer;
    let mimeType = 'image/png';

    if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
      imageBuffer = Buffer.from(item.b64_json, 'base64');
    } else if (typeof item?.url === 'string' && item.url.length > 0) {
      // 兼容返回 URL 的 OpenAI 兼容服务，但只允许回源到同一 API 主机，避免借图片生成接口访问内网地址。
      let imageUrl: URL;
      try {
        imageUrl = new URL(item.url);
      } catch {
        throw new ServiceUnavailableException('图片生成服务返回了无效的图片 URL');
      }
      const apiOrigin = new URL(baseUrl).origin;
      if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') {
        throw new ServiceUnavailableException('图片生成服务返回了不支持的图片协议');
      }
      if (imageUrl.origin !== apiOrigin) {
        throw new ServiceUnavailableException('图片生成服务返回了跨域图片 URL；当前安全策略仅允许同源文件地址，请调整服务响应为 Base64');
      }
      const fileResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
      if (!fileResponse.ok) {
        throw new ServiceUnavailableException('读取生成图片失败（HTTP ' + fileResponse.status + '）');
      }
      mimeType = (fileResponse.headers.get('content-type') || 'image/png').split(';')[0].trim();
      imageBuffer = Buffer.from(await fileResponse.arrayBuffer());
    } else {
      throw new ServiceUnavailableException('图片生成服务未返回 data[0].b64_json 或可用的同源图片 URL');
    }

    if (imageBuffer.length < 16 || imageBuffer.length > MAX_IMAGE_BYTES) {
      throw new ServiceUnavailableException('生成图片大小无效或超过 20 MB');
    }

    // 通过文件签名识别真实格式，不信任第三方响应头。
    if (imageBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      mimeType = 'image/png';
    } else if (imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff) {
      mimeType = 'image/jpeg';
    } else if (imageBuffer.toString('ascii', 0, 4) === 'RIFF' && imageBuffer.toString('ascii', 8, 12) === 'WEBP') {
      mimeType = 'image/webp';
    } else {
      throw new ServiceUnavailableException('生成结果不是有效的 PNG、JPG 或 WebP 图片');
    }

    return {
      mimeType,
      dataUrl: 'data:' + mimeType + ';base64,' + imageBuffer.toString('base64'),
      model,
      provider: baseUrl,
      revisedPrompt: item.revised_prompt || null,
      sizeBytes: imageBuffer.length,
    };
  }
  async repairObjectFromValidation(objectSculptSpecInput: unknown, validationErrorInput: unknown, objectTypeInput: unknown, visualStyleInput: unknown): Promise<any> {
    if (!objectSculptSpecInput || typeof objectSculptSpecInput !== 'object' || Array.isArray(objectSculptSpecInput)) throw new BadRequestException('待修复的 ObjectSculptSpec 无效');
    const validationError = typeof validationErrorInput === 'string' ? validationErrorInput.trim().slice(0, 2000) : '';
    if (!validationError) throw new BadRequestException('缺少 Runtime 校验错误信息');
    const original = objectSculptSpecInput as any;
    const serialized = JSON.stringify(original);
    if (serialized.length > 30000) throw new BadRequestException('待修复模型数据超过 30 KB');
    const repairPrompt = [
      '这是针对现有 ObjectSculptSpec 的定向结构修复，不是重新设计或重新生成整个物体。',
      '必须保留 targetName、category、objectType、visualStyle、materials、所有节点 ID、parent 层级、非错误节点几何、transform、parameterSchema、generators 和 constraints。',
      '只允许修改错误明确涉及的节点及其必要几何字段。不要删除组件，不要把复杂几何降级为 box，不要改变参考物体轮廓。',
      'Runtime 错误：' + validationError,
      '原始 ObjectSculptSpec JSON：' + serialized,
      '输出完整修复后的 ObjectSculptSpec JSON。',
    ].join('\n');
    const result = await this.generateObjectFromPrompt(repairPrompt,
      typeof objectTypeInput === 'string' && objectTypeInput.trim() ? objectTypeInput : (original.objectType || '独立 3D 物体'),
      typeof visualStyleInput === 'string' && visualStyleInput.trim() ? visualStyleInput : (original.visualStyle || 'stylized'), false);
    return { ...result, repair: { strategy: 'targeted-structure-repair', validationError } };
  }


  async reconstructObjectFromImage(imageDataUrl: unknown, prompt: unknown, objectType: unknown, visualStyle: unknown): Promise<any> {
    if (typeof imageDataUrl !== 'string' || !imageDataUrl) throw new BadRequestException('请上传参考图片');
    return this.generateObjectFromPrompt(prompt, objectType, visualStyle, true, imageDataUrl);
  }

  /**
   * Prompt-to-3D POC: ask the configured vision/chat model for a bounded ObjectSculptSpec.
   * The model returns JSON data only; no generated JavaScript is evaluated in the server.
   */
  async generateObjectFromPrompt(promptInput: unknown, objectTypeInput: unknown, visualStyleInput: unknown, allowGeometryRepair = true, imageDataUrlInput?: unknown): Promise<any> {
    const promptText = typeof promptInput === 'string' ? promptInput.trim() : '';
    const imageDataUrl = typeof imageDataUrlInput === 'string' ? imageDataUrlInput : '';
    if (!promptText && !imageDataUrl) throw new BadRequestException('Three.js 模型生成需要提示词或参考图片');
    if (imageDataUrl && (!/^data:image\\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl) || Buffer.byteLength(imageDataUrl, 'utf8') > 14 * 1024 * 1024)) {
      throw new BadRequestException('参考图片格式无效或超过 10 MB');
    }
    const prompt = (promptText || '请严格依据参考图片重建该物体。') .slice(0, 40000);
    const objectType = typeof objectTypeInput === 'string' && objectTypeInput.trim()
      ? objectTypeInput.trim().slice(0, 80) : '独立 3D 物体';
    const visualStyle = typeof visualStyleInput === 'string' && visualStyleInput.trim()
      ? visualStyleInput.trim().slice(0, 80) : 'stylized';
    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey || !model) {
      throw new ServiceUnavailableException('提示词模型生成未配置视觉模型，请检查 VISION_API_KEY、VISION_MODEL 和 VISION_API_BASE_URL');
    }

    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                '你是专业的 Three.js 独立物体建模工程师。根据用户提示词和可能提供的参考图片输出 ObjectSculptSpec JSON，不要输出 JavaScript、Markdown 或解释。',
                '当提供参考图片时，图片是几何外形和比例的第一依据，提示词只能补充图片中不可见的信息。不得把图片简单当成贴图，不得忽略图片主体轮廓；应使用足够的分段、曲线和截面描述可见结构。',
                '根对象字段：schemaVersion 固定为字符串 2.0，targetName，category（AI 自行判断的开放分类）、objectType（AI 自行判断的具体物体）、visualStyle、materials、componentTree、parameterSchema。',
                'materials 是对象，材质项包含 color(#RRGGBB)、roughness(0-1)、metalness(0-1)、opacity(0.05-1)。',
                'parameterSchema 必须根据本次对象真实结构动态声明，不得套用固定类别参数清单。每项包含 id、label、type(number/color/boolean/select)、value、targets；number 另含 min/max/step/unit，select 另含 options；targets 每项包含 nodeId、property、mode。property 仅允许 dimensions.width/height/depth、transform.position.x/y/z、transform.scale.x/y/z、material.color/roughness/metalness/opacity、geometry.primitive、geometryDescriptor.inset/tube、visibility.visible；mode 为 set/multiply/add，visibility.visible 还允许 visible-from/visible-through 并提供 threshold，材质仅 set。一个参数可绑定多个节点实现联动。优先声明对对象语义有意义的参数，例如树高/树冠尺寸/树冠层数、车身长度/轮距/轮胎半径、建筑层数/开间/窗户数量、桌面尺寸/桌腿高度；这些只是示例，必须根据当前对象结构决定是否声明，不能机械添加。',
                'componentTree 按对象复杂度包含 1-100 个有意义的独立组件；简单对象可以只有一个组件，复杂对象应按真实结构拆分，不得为了凑数量拆出无意义零件。节点字段：id（唯一英文 ID）、name、role、kind（group 或 mesh，省略时为 mesh）、parent（唯一根节点省略，其余组件必填）、primitive、dimensions（width/height/depth 正数）、transform（position/rotation/scale 三个三维数组）、material（materials 中的键）、geometryDescriptor（可选）。mesh primitive 必须从引擎支持集合中按几何形态选择：box/cuboid、polygon、wedge、arch、cylinder、cone、sphere、ellipsoid、torus、tube、lathe、sweep、loft；不得把所有曲面或异形物体都近似成 box。',
                '复杂几何描述符必须按 primitive 输出：polygon 使用 geometryDescriptor.points（3-32 个归一化二维轮廓点）；tube 使用 path（2-32 个归一化三维点）及 radius/tubularSegments/radialSegments；lathe 使用 profile（2-32 个 [半径,高度] 归一化点）；sweep 使用 path（2-32 个归一化三维点）、profile（3-24 个归一化二维截面点）及 steps；loft 使用 sections（2-12 个截面，每个截面含严格递增的 height 与相同数量的 points）。这些坐标范围为 [-0.5,0.5]，半径按引擎约束；不需要复杂几何时使用基础 primitive。',
                '每个 generator.templateRootId 必须指向 componentTree 中 kind="group" 的节点；重复模板即使只有一个 Mesh，也必须先创建一个无几何 Group 作为模板容器，再把 Mesh 作为该 Group 的子节点。不得让 generator 直接引用 Mesh。',
                '当对象存在规则重复结构时，必须优先用声明式 generators，而不是手工复制大量相同节点。generators 允许 repeat 或 grid。repeat 字段：id、type=repeat、templateRootId、axis(x/y/z)、spacing、defaultCount、maxCount、countParameterId；grid 字段：id、type=grid、templateRootId、spacingX、spacingZ、defaultRows、defaultColumns、maxRows、maxColumns、rowParameterId、columnParameterId；可选 centered=true 让网格围绕模板根节点居中展开。对应数量参数必须存在于 parameterSchema，type=number，min/value/max 为整数且从 1 开始，maxCount/maxRows/maxColumns 不超过 100；模板子树只允许被一个 generator 使用，不得嵌套。repeat 可用 followers 将主体/底座等非重复节点按数量变化联动，字段为 nodeId、axis、offset。栏杆立柱、车轮组、窗户阵列、树冠层/叶簇、椅子重复横档等可按实际结构判断是否适用；不要为了使用生成器而强行重复。',
                'constraints 可选用于部件联动，支持引擎已实现的 follow、span、attach、adjacency、cutout；仅在能准确表达几何依赖时使用，引用必须指向真实节点或生成器。',
                '单个资产的装配完整性优先于组件数量：componentTree 必须恰好只有一个根节点，代表该对象的核心主体（例如建筑主体、树干/主枝、车身、人体躯干、家具主框架或机械机架）；其余组件必须通过 parent 连接到该根节点，形成一棵连通树。不要把单个资产拆成互不关联的多个根对象。',
                '所有子组件 position 必须是相对直接 parent 的局部坐标。先确定对象整体中心、尺度和局部坐标系，再按类别安排部件：建筑的屋顶/塔楼/门窗连接主体；树木的枝干连接树干、树冠叶簇连接枝条；车辆的车轮连接车轴/底盘、车门连接车身；人物的头部和四肢连接躯干/关节；家具的面板、桌腿、靠背连接主框架；机械的轴、齿轮、外壳连接机架或传动组件。',
                '几何接合规则按部件功能判断，而不是要求所有 Mesh 表面都互相贴合：承重、安装、插接部件必须接触、嵌入或通过连接件连接；叶片、毛发、装饰、辐条等允许自然间距，但必须有合理的父级归属和空间分布。禁止无理由漂浮、散落或远离主体的零件。',
                'parent 只定义层级，不会自动吸附几何体。必须根据 Mesh 的 dimensions、连接点和局部坐标计算 position；不要把所有子组件堆在原点，也不要将子组件误用世界坐标。',
                '坐标约定：Y 轴向上，根节点位于对象整体中心附近，rotation 使用弧度；地面接触类对象底部约为 Y=0，悬空/飞行类对象按其自身中心定位。整体尺寸建议在 2-20 个场景单位。',
                '材质颜色必须贴合提示词和对象类别，不允许全部白色或灰色。禁止重复 ID、缺失父节点、循环层级和未知 primitive。',
                '目标对象类型：' + objectType + '；视觉风格：' + visualStyle + '；用户要求：' + prompt,
              ].join('\\n'),
            },
            {
              role: 'user',
              content: imageDataUrl
                ? [
                    { type: 'text', text: '请以参考图片为首要几何依据，重建图片中的主体。不要臆造与图片不符的轮廓、塔身比例、顶部结构或底座。先识别主体边界、宽高比、分段轮廓、支撑结构和接地位置，再输出 ObjectSculptSpec。用户补充要求：' + (prompt || '无') + '。图片中的主体必须作为一个完整对象，所有部件按真实连接关系组织；不得出现无理由悬空部件。只返回 JSON。' },
                    { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
                  ]
                : '请直接构建可转换为真实 Three.js Mesh 的独立物体结构，优先保证外轮廓、部件层级、比例和材质。只返回 JSON。',
            },
          ],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('提示词 3D 模型生成连接失败：' + message);
      throw new ServiceUnavailableException('无法连接视觉模型，请检查后端网络连接');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      this.logger.warn('提示词 3D 模型生成 API HTTP ' + response.status + '：' + detail);
      throw new ServiceUnavailableException('提示词 3D 模型生成失败（HTTP ' + response.status + '）');
    }
    const payload = await response.json() as any;
    const raw = payload?.choices?.[0]?.message?.content;
    let spec: any;
    try { spec = typeof raw === 'string' ? JSON.parse(raw) : null; } catch {
      throw new ServiceUnavailableException('视觉模型未返回有效 ObjectSculptSpec JSON');
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)
      || !Array.isArray(spec.componentTree) || spec.componentTree.length < 1 || spec.componentTree.length > 100
      || !spec.materials || typeof spec.materials !== 'object' || Array.isArray(spec.materials)) {
      throw new ServiceUnavailableException('视觉模型返回的 ObjectSculptSpec 结构无效');
    }
    // IDs are identities within their own namespaces. Validate component identities
    // before building Maps; otherwise duplicate keys silently overwrite earlier nodes.
    const componentIds = new Set<string>();
    for (const node of spec.componentTree) {
      if (!node || typeof node !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(node.id || '') || componentIds.has(node.id)) {
        throw new ServiceUnavailableException('组件 ID 无效或重复：' + String(node?.id || 'unknown'));
      }
      componentIds.add(node.id);
    }
    const roots = spec.componentTree.filter((node: any) => !node?.parent);
    if (roots.length !== 1) {
      throw new ServiceUnavailableException('ObjectSculptSpec 必须只有一个主体根节点；检测到 ' + roots.length + ' 个根节点，组件没有组成完整对象');
    }
    const byId = new Map<string, any>(spec.componentTree
      .filter((node: any) => typeof node?.id === 'string')
      .map((node: any) => [node.id, node] as [string, any]));
    for (const node of spec.componentTree) {
      if (node?.parent && !byId.has(node.parent)) {
        throw new ServiceUnavailableException('组件父节点不存在：' + String(node.id || 'unknown'));
      }
      const visited = new Set([node.id]);
      let parent = node?.parent;
      let depth = 1;
      while (parent) {
        if (visited.has(parent)) throw new ServiceUnavailableException('组件树存在循环引用：' + String(node.id || 'unknown'));
        visited.add(parent);
        depth += 1;
        if (depth > 16) throw new ServiceUnavailableException('组件树层级超过 16 层');
        parent = byId.get(parent)?.parent;
      }
      if (parent !== undefined && parent !== null) {
        throw new ServiceUnavailableException('组件未连接到主体根节点：' + String(node.id || 'unknown'));
      }
    }
    if (Array.isArray(spec.generators)) normalizeGeneratorTemplateRoots(spec.componentTree, spec.generators);
    try {
      validateGeneratedGeometryDescriptors(spec.componentTree);
    } catch (error) {
      if (!allowGeometryRepair || !(error instanceof Error)) throw error;
      this.logger.warn('ObjectSculptSpec 几何校验失败，执行一次定向修复：' + error.message);
      return this.repairObjectFromValidation(spec, error.message, objectType, visualStyle);
    }
    const generatorValidation = validateGeneratedGenerators(spec.generators, spec.componentTree);
    spec.generators = generatorValidation.generators;
    spec.parameterSchema = validateGeneratedParameterSchema(spec.parameterSchema, spec.componentTree, generatorValidation.parameterIds);
    validateGeneratorParameterBindings(spec.generators, spec.parameterSchema);

    // Validate constraint identities and references at the generation boundary too.
    // The browser Runtime repeats these checks before materialization; this catches
    // malformed AI output here instead of returning a spec that can only fail later.
    if (spec.constraints !== undefined && (!Array.isArray(spec.constraints) || spec.constraints.length > 60)) {
      throw new ServiceUnavailableException('AI constraints 必须是最多 60 项的数组');
    }
    const constraintIds = new Set<string>();
    const generatorIds = new Set((spec.generators || []).map((item: any) => item.id));
    for (const constraint of spec.constraints || []) {
      if (!constraint || typeof constraint !== 'object'
        || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(constraint.id || '')
        || constraintIds.has(constraint.id)) {
        throw new ServiceUnavailableException('AI 结构约束 ID 无效或重复');
      }
      constraintIds.add(constraint.id);
      const componentRef = (id: unknown) => typeof id === 'string' && componentIds.has(id);
      if ((constraint.type === 'follow' || constraint.type === 'span')
        ? (!generatorIds.has(constraint.sourceGeneratorId) || !componentRef(constraint.targetNodeId))
        : constraint.type === 'cutout'
          ? (!componentRef(constraint.targetNodeId) || !componentRef(constraint.cutterNodeId))
          : ['attach', 'adjacency'].includes(constraint.type)
            ? (!componentRef(constraint.sourceNodeId) || !componentRef(constraint.targetNodeId))
            : true) {
        throw new ServiceUnavailableException('AI 结构约束引用无效：' + constraint.id);
      }
    }
    return { provider: baseUrl, model, objectType, visualStyle, objectSculptSpec: spec };
  }

}
