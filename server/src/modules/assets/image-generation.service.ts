import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateObjectModelSpecV3 } from '../../shared/object-model-spec-v3';
import { isObjectModelParameterTargetTypeCompatible, resolveObjectModelParameterTarget } from '../../shared/object-model-property-resolver';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * AI 有时会把材质参数写成语义化别名（如 lattice_color），但 Runtime 协议
 * 只接受标准材质绑定。将明确的材质字段别名收敛为统一协议，避免整次生成失败。
 */
function normalizeGeneratedParameterBindings(input: unknown) {
  if (!Array.isArray(input)) return input;
  const materialAliases: Record<string, string> = {
    lattice_color: 'material.color',
    lattice_roughness: 'material.roughness',
    lattice_metalness: 'material.metalness',
    lattice_opacity: 'material.opacity',
  };
  return input.map((parameter: any) => ({
    ...parameter,
    targets: Array.isArray(parameter?.targets) ? parameter.targets.map((target: any) => ({
      ...target,
      property: materialAliases[target?.property] || target?.property,
    })) : parameter?.targets,
  }));
}

function validateGeneratedParameterSchema(input: unknown, componentTree: any[], generatorParameterIds = new Set<string>(), materials: Record<string, any> = {}) {
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
      const targetNode = componentTree.find(node => node.id === target?.nodeId);
      const resolvedTarget = resolveObjectModelParameterTarget(targetNode, materials, target?.property);
      const mode = target.mode || 'set';
      if (!nodes.has(target?.nodeId) || !resolvedTarget
        || !isObjectModelParameterTargetTypeCompatible(item.type, resolvedTarget, mode, target?.property)) {
        throw new ServiceUnavailableException('AI 参数目标引用无效或数据类型不匹配：' + item.id);
      }
      if (!['set','multiply','add','visible-from','visible-through'].includes(mode)) throw new ServiceUnavailableException('AI 参数目标运算无效：' + item.id);
      if (['visible-from','visible-through'].includes(mode) && (target.property !== 'visibility.visible' || !Number.isFinite(target.threshold) || target.threshold < 1 || target.threshold > 100)) throw new ServiceUnavailableException('AI 参数可见性阈值无效：' + item.id);
      if (target.property === 'geometry.primitive' && item.type !== 'select') throw new ServiceUnavailableException('几何类型参数必须是枚举：' + item.id);
      if (target.property.startsWith('material.') && mode !== 'set') throw new ServiceUnavailableException('材质参数只允许 set：' + item.id);
    }
  }
  return input;
}

function validateGeneratedOperations(input: unknown, componentTree: any[]) {
  if (input == null) return { operations: [], parameterIds: new Set<string>(), expressionParameterIds: new Set<string>() };
  if (!Array.isArray(input) || input.length > 40) throw new ServiceUnavailableException('AI operations 必须是最多 40 项的数组');
  const byId = new Map(componentTree.map(node => [node.id, node]));
  const ids = new Set<string>(), roots = new Set<string>(), claimedSourceNodes = new Set<string>(), parameterIds = new Set<string>(), expressionParameterIds = new Set<string>();
  let estimatedExpandedCount = componentTree.length;
  const subtreeFor = (rootId: string) => componentTree.filter(node => {
    let current = node;
    while (current) {
      if (current.id === rootId) return true;
      current = current.parent ? byId.get(current.parent) : null;
    }
    return false;
  });
  const validateExpression = (expression: any, depth = 0): void => {
    if (depth > 16) throw new ServiceUnavailableException('AI 表达式嵌套层级超过 16 层');
    if (typeof expression === 'number') {
      if (!Number.isFinite(expression) || Math.abs(expression) > 10000) throw new ServiceUnavailableException('AI 表达式常量超出范围');
      return;
    }
    if (!expression || typeof expression !== 'object' || Array.isArray(expression)) throw new ServiceUnavailableException('AI 表达式节点格式无效');
    if (expression.op === 'constant') {
      if (!Number.isFinite(Number(expression.value)) || Math.abs(Number(expression.value)) > 10000) throw new ServiceUnavailableException('AI 表达式常量无效');
    } else if (expression.op === 'index' || expression.op === 'count') {
      return;
    } else if (expression.op === 'parameter') {
      if (typeof expression.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(expression.id)) throw new ServiceUnavailableException('AI 表达式参数引用无效');
      expressionParameterIds.add(expression.id);
      return;
    } else if (['add','subtract','multiply','divide'].includes(expression.op)) {
      validateExpression(expression.left, depth + 1);
      validateExpression(expression.right, depth + 1);
    } else if (['sin','cos','negate'].includes(expression.op)) {
      validateExpression(expression.value, depth + 1);
    } else {
      throw new ServiceUnavailableException('AI 表达式运算不受支持：' + String(expression.op));
    }
  };
  const operations = input.map((raw: any) => {
    const id = typeof raw?.id === 'string' ? raw.id : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) || ids.has(id) || raw?.type !== 'instance') {
      throw new ServiceUnavailableException('AI operation ID 或类型无效：' + id);
    }
    ids.add(id);
    const root = byId.get(raw.sourceRootId);
    if (!root || (root.kind || 'mesh') !== 'group' || roots.has(root.id)) {
      throw new ServiceUnavailableException('AI instance sourceRootId 必须引用唯一 Group：' + id);
    }
    roots.add(root.id);
    const subtree = subtreeFor(root.id);
    if (!subtree.length) throw new ServiceUnavailableException('AI instance 源子树为空：' + id);
    const parameterId = raw.count?.parameterId;
    if (typeof parameterId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(parameterId)) {
      throw new ServiceUnavailableException('AI instance 数量参数引用无效：' + id);
    }
    parameterIds.add(parameterId);
    const transform = raw.transform || {};
    for (const key of ['position','rotation','scale']) {
      const vector = transform[key] ?? (key === 'scale' ? [1,1,1] : [0,0,0]);
      if (!Array.isArray(vector) || vector.length !== 3) throw new ServiceUnavailableException('AI instance transform.' + key + ' 必须是三维表达式数组：' + id);
      vector.forEach((value: any) => validateExpression(value));
    }
    return { id, type: 'instance', sourceRootId: root.id, count: { parameterId }, transform };
  });
  for (const operation of operations) {
    const subtree = subtreeFor(operation.sourceRootId);
    // Parameter ranges are checked after parameterSchema normalization.
    estimatedExpandedCount += subtree.length;
  }
  if (estimatedExpandedCount > 300) throw new ServiceUnavailableException('AI operations 基础展开规模超过 300 个组件');
  return { operations, parameterIds, expressionParameterIds };
}

function validateOperationParameterBindings(operations: any[], parameterSchema: any[], componentTree: any[], expressionParameterIds = new Set<string>()) {
  const byId = new Map(parameterSchema.map(item => [item.id, item]));
  const byNode = new Map(componentTree.map(node => [node.id, node]));
  for (const parameterId of expressionParameterIds) {
    if (byId.get(parameterId)?.type !== 'number') throw new ServiceUnavailableException('空间表达式只能引用数值参数：' + parameterId);
  }
  let expandedCount = componentTree.length;
  for (const operation of operations) {
    const parameter = byId.get(operation.count.parameterId);
    if (!parameter || parameter.type !== 'number' || !Number.isInteger(parameter.value)
      || !Number.isInteger(parameter.min) || !Number.isInteger(parameter.max)
      || parameter.min < 1 || parameter.max > 100 || parameter.value < parameter.min || parameter.value > parameter.max) {
      throw new ServiceUnavailableException('instance 必须绑定 1-100 范围内的整数数量参数：' + operation.id);
    }
    const root = byNode.get(operation.sourceRootId);
    const subtree = componentTree.filter(node => {
      let current = node;
      while (current) {
        if (current.id === root.id) return true;
        current = current.parent ? byNode.get(current.parent) : null;
      }
      return false;
    });
    expandedCount += subtree.length * (parameter.max - 1);
    if (expandedCount > 300) throw new ServiceUnavailableException('AI operations 最大展开组件数超过 300：' + operation.id);
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
    if (!objectSculptSpecInput || typeof objectSculptSpecInput !== 'object' || Array.isArray(objectSculptSpecInput)
      || (objectSculptSpecInput as any).schemaVersion !== '3.0'
      || Object.prototype.hasOwnProperty.call(objectSculptSpecInput, 'generators')
      || Object.prototype.hasOwnProperty.call(objectSculptSpecInput, 'constraints')) throw new BadRequestException('待修复的 ObjectModelSpec 3.0 无效');
    const validationError = typeof validationErrorInput === 'string' ? validationErrorInput.trim().slice(0, 2000) : '';
    if (!validationError) throw new BadRequestException('缺少 Runtime 校验错误信息');
    const original = objectSculptSpecInput as any;
    const serialized = JSON.stringify(original);
    if (serialized.length > 30000) throw new BadRequestException('待修复模型数据超过 30 KB');
    const repairPrompt = [
      '这是针对现有 ObjectSculptSpec 的定向结构修复，不是重新设计或重新生成整个物体。',
      '必须保留 ObjectModelSpec 3.0 的 targetName、category、objectType、visualStyle、materials、所有节点 ID、parent 层级、非错误节点几何、transform、parameterSchema 和 operations；operations 必须逐字段保持不变。',
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



  /**
   * 对当前 ObjectSculptSpec 执行 AI 微调。selectedNodeIds 为空表示整体模型；
   * 非空时明确告知模型只修改选中部件及其必要关联结构。
   */
  async modifyObjectFromInstruction(objectSculptSpecInput: unknown, selectedNodeIdsInput: unknown, instructionInput: unknown): Promise<any> {
    if (!objectSculptSpecInput || typeof objectSculptSpecInput !== 'object' || Array.isArray(objectSculptSpecInput)
      || (objectSculptSpecInput as any).schemaVersion !== '3.0'
      || Object.prototype.hasOwnProperty.call(objectSculptSpecInput, 'generators')
      || Object.prototype.hasOwnProperty.call(objectSculptSpecInput, 'constraints')) {
      throw new BadRequestException('当前 ObjectModelSpec 3.0 无效，无法执行微调');
    }
    const original = objectSculptSpecInput as any;
    const serialized = JSON.stringify(original);
    if (serialized.length > 30000 || !Array.isArray(original.componentTree) || !original.componentTree.length) {
      throw new BadRequestException('当前模型结构缺失或超过 30 KB');
    }
    const instruction = typeof instructionInput === 'string' ? instructionInput.trim().slice(0, 4000) : '';
    if (!instruction) throw new BadRequestException('请输入微调要求');
    const selectedNodeIds = Array.isArray(selectedNodeIdsInput) ? selectedNodeIdsInput.filter((id: unknown) => typeof id === 'string') : [];
    const knownIds = new Set(original.componentTree.map((node: any) => node?.id));
    if (selectedNodeIds.some((id: string) => !knownIds.has(id))) throw new BadRequestException('微调目标部件不存在，请重新选择');
    const targetDescription = selectedNodeIds.length
      ? '本次目标是选中的部件：' + selectedNodeIds.join('、') + '。只允许调整这些节点及其必要的直接关联结构；其他部件的 ID、几何、材质、变换、父子关系和参数必须保持不变。'
      : '本次没有选中任何部件，目标是整个模型。允许根据要求调整模型整体及相关部件，但必须保持对象身份、合理层级和结构完整性。';
    const editPrompt = [
      '这是对现有 Three.js ObjectSculptSpec 的微调任务，不是从零创建新物体。',
      targetDescription,
      '必须返回完整 ObjectModelSpec 3.0 JSON。尽可能保留原有节点 ID、层级、未涉及几何、材质、参数和 operations；operations 必须逐字段保持不变。',
      '不得把复杂几何降级成简单方盒，不得无故删除部件或改变整体风格。',
      '用户微调要求：' + instruction,
      '当前 ObjectSculptSpec：' + serialized,
    ].join('\n');
    const result = await this.generateObjectFromPrompt(editPrompt, original.objectType || original.targetName || '独立 3D 物体', original.visualStyle || 'stylized', false);
    if (selectedNodeIds.length) {
      // 局部微调采用服务端结构合并：AI 只能提交选中节点子树的变化，
      // 其余节点直接沿用原始数据，避免仅靠 Prompt 约束导致整棵模型被重写。
      const originalById = new Map<string, any>(original.componentTree.map((node: any) => [node.id, node]));
      const generatedById = new Map<string, any>((result.objectSculptSpec.componentTree || []).map((node: any) => [node.id, node]));
      const allowedIds = new Set<string>();
      for (const selectedId of selectedNodeIds) {
        allowedIds.add(selectedId);
        let changed = true;
        while (changed) {
          changed = false;
          for (const node of original.componentTree) {
            if (node.parent && allowedIds.has(node.parent) && !allowedIds.has(node.id)) {
              allowedIds.add(node.id);
              changed = true;
            }
          }
        }
      }
      for (const selectedId of selectedNodeIds) {
        if (!generatedById.has(selectedId)) throw new ServiceUnavailableException('AI 局部微调结果缺少目标部件：' + selectedId);
      }
      // 允许 AI 在选中子树内新增节点，但新增节点必须挂接到已允许的节点上。
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const node of result.objectSculptSpec.componentTree || []) {
          if (node.parent && allowedIds.has(node.parent) && !allowedIds.has(node.id)) {
            allowedIds.add(node.id);
            expanded = true;
          }
        }
      }
      const preservedNodes = original.componentTree.filter((node: any) => !allowedIds.has(node.id));
      const editedNodes = (result.objectSculptSpec.componentTree || []).filter((node: any) => allowedIds.has(node.id)).map((node: any) => ({ ...node }));
      const mergedMaterials = { ...(original.materials || {}) };
      editedNodes.forEach((node: any) => {
        const materialKey = typeof node.material === 'string' ? node.material : '';
        const generatedMaterial = materialKey ? result.objectSculptSpec.materials?.[materialKey] : null;
        if (!generatedMaterial) return;
        const isolatedKey = 'local-edit-' + node.id + '-' + materialKey;
        mergedMaterials[isolatedKey] = generatedMaterial;
        node.material = isolatedKey;
      });
      const mergedSpec = {
        ...original,
        materials: mergedMaterials,
        componentTree: [...preservedNodes, ...editedNodes],
        // 局部编辑不允许重写全局参数和结构运算；避免选中部件之外的联动被意外改变。
        parameterSchema: original.parameterSchema || [],
        operations: original.operations || [],
      };
      return {
        ...result,
        objectSculptSpec: mergedSpec,
        affectedNodeIds: [...allowedIds],
        editScope: 'component',
      };
    }
    return {
      ...result,
      affectedNodeIds: original.componentTree.map((node: any) => node.id),
      editScope: 'whole-object',
    };
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
    if (imageDataUrl && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl) || Buffer.byteLength(imageDataUrl, 'utf8') > 14 * 1024 * 1024)) {
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

    // 参考图采用两阶段视觉链路：先独立提取可见结构证据，再将分析结果交给结构生成阶段。
    // 这样可避免模型一边猜测图片结构、一边直接编写几何协议，导致比例和部件关系漂移。
    let visualAnalysis = '';
    let referenceAnalysis: any = null;
    if (imageDataUrl) {
      let analysisResponse: Response;
      try {
        analysisResponse = await fetch(baseUrl + '/chat/completions', {
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
                  '你是计算机视觉结构分析器。只分析图像中可见的物体，不生成 3D 几何、不补造看不见的结构。',
                  '输出 JSON：subject、silhouette、aspectRatio、verticalSections、components、spatialRelations、supports、groundContact、uncertainties。',
                  'aspectRatio 为主体可见宽高比估计；verticalSections 从下到上描述各段高度占比和宽度变化；components 描述可见部件及其相对位置/尺寸；spatialRelations 明确悬空、环绕、穿插、间隔、接触和连接关系；supports 说明可见支撑路径；groundContact 只描述图片中实际接地的部位。',
                  '允许且必须如实记录图片中的悬空、架空、镂空、环绕、观景舱等设计，不得把悬空直接判为错误。区分“视觉上分离”与“结构上无支撑”，无法确认时写入 uncertainties。',
                  '所有比例均为基于单张图的估计值，标记 confidence；不得伪造精确尺寸。只返回 JSON。',
                ].join('\\n'),
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '请分析参考图片中主体的轮廓、分段比例、部件尺寸与空间/支撑关系。对象提示：' + objectType + '；用户补充：' + (prompt || '无') },
                  { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
                ],
              },
            ],
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error('参考图片视觉分析连接失败：' + message);
        throw new ServiceUnavailableException('参考图片视觉分析失败，请检查视觉模型服务连接');
      }
      if (!analysisResponse.ok) {
        const detail = (await analysisResponse.text()).slice(0, 1000);
        this.logger.warn('参考图片视觉分析 API HTTP ' + analysisResponse.status + '：' + detail);
        throw new ServiceUnavailableException('参考图片视觉分析失败（HTTP ' + analysisResponse.status + '）');
      }
      const analysisPayload = await analysisResponse.json() as any;
      const analysisRaw = analysisPayload?.choices?.[0]?.message?.content;
      let analysisObject: any;
      try { analysisObject = typeof analysisRaw === 'string' ? JSON.parse(analysisRaw) : null; } catch {
        throw new ServiceUnavailableException('视觉模型未返回有效的参考图片结构分析 JSON');
      }
      if (!analysisObject || typeof analysisObject !== 'object' || Array.isArray(analysisObject)
        || !analysisObject.silhouette || !Array.isArray(analysisObject.components)
        || !Array.isArray(analysisObject.spatialRelations)) {
        throw new ServiceUnavailableException('参考图片视觉分析结果缺少轮廓、组件或空间关系信息');
      }
      referenceAnalysis = analysisObject;
      visualAnalysis = JSON.stringify(analysisObject).slice(0, 16000);
      this.logger.log('参考图片视觉分析完成：' + model + '，识别组件 ' + analysisObject.components.length + ' 项');
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
                '根对象字段：schemaVersion 固定为字符串 3.0，targetName，category，objectType，visualStyle，materials，componentTree，parameterSchema，operations。',
                'materials 是对象，材质项包含 color(#RRGGBB)、roughness(0-1)、metalness(0-1)、opacity(0.05-1)。',
                'parameterSchema 必须根据本次对象真实结构动态声明，不得套用固定类别参数清单。每项包含 id、label、type(number/color/boolean/select)、value、targets；number 另含 min/max/step/unit，select 另含 options；targets 每项包含 nodeId、property、mode。property 使用点分隔的真实数据路径，可指向当前节点 dimensions、transform、geometryDescriptor 中存在的标量字段，或当前材质中存在的标量字段；geometry.primitive 和 visibility.visible 为专用语义目标。不得预先穷举属性字段，也不得虚构节点中不存在的字段；服务端按目标实际数据类型校验 number/color/boolean/select。禁止访问 id、parent、kind 等结构身份字段及原型链字段；mode 为 set/multiply/add，visibility.visible 还允许 visible-from/visible-through 并提供 threshold，材质仅 set。一个参数可绑定多个节点实现联动。优先声明对对象语义有意义的参数，例如树高/树冠尺寸/树冠层数、车身长度/轮距/轮胎半径、建筑层数/开间/窗户数量、桌面尺寸/桌腿高度；这些只是示例，必须根据当前对象结构决定是否声明，不能机械添加。',
                'componentTree 按对象复杂度包含 1-100 个有意义的独立组件；简单对象可以只有一个组件，复杂对象应按真实结构拆分，不得为了凑数量拆出无意义零件。节点字段：id（唯一英文 ID）、name、role、kind（group 或 mesh，省略时为 mesh）、parent（唯一根节点省略，其余组件必填）、primitive、dimensions（width/height/depth 正数）、transform（position/rotation/scale 三个三维数组）、material（materials 中的键）、geometryDescriptor（可选）。mesh primitive 必须从引擎支持集合中按几何形态选择：box/cuboid、polygon、wedge、arch、cylinder、cone、sphere、ellipsoid、torus、tube、lathe、sweep、loft；不得把所有曲面或异形物体都近似成 box。',
                '复杂几何描述符必须按 primitive 输出：polygon 使用 geometryDescriptor.points（3-32 个归一化二维轮廓点）；tube 使用 path（2-32 个归一化三维点）及 radius/tubularSegments/radialSegments；lathe 使用 profile（2-32 个 [半径,高度] 归一化点）；sweep 使用 path（2-32 个归一化三维点）、profile（3-24 个归一化二维截面点）及 steps；loft 使用 sections（2-12 个截面，每个截面含严格递增的 height 与相同数量的 points）。这些坐标范围为 [-0.5,0.5]；tube/sweep 的 geometryDescriptor.radius 必须是 0.01-10 的有限数值，且应结合组件 dimensions 使用合理的小半径（细肋条/格栅通常远小于组件宽高），禁止把直径、百分比或归一化坐标误填为 radius；不需要复杂几何时使用基础 primitive。',
'重复结构必须用通用 operations 描述，不得使用 repeat/grid 专用生成器。operations 项格式：{id,type:"instance",sourceRootId,count:{parameterId},transform:{position:[表达式,表达式,表达式],rotation:[表达式,表达式,表达式],scale:[表达式,表达式,表达式]}}。sourceRootId 指向 componentTree 中完整的 Group 子树；count.parameterId 指向 parameterSchema 中的整数参数。表达式只允许数字常量或 AST：{op:"constant",value}、{op:"index"}、{op:"count"}、{op:"parameter",id}、{op:"add"|"subtract"|"multiply"|"divide",left,right}、{op:"sin"|"cos"|"negate",value}。index 是当前实例索引，count 是实例总数；角度使用弧度。通过三角函数、向量分量和旋转表达式描述任意轴向/圆周/螺旋/非均匀分布，不得把这些分布固化成专用类型。数量参数 targets=[]，由 operation 控制。禁止输出 JavaScript、函数体、eval 或未声明的表达式操作。',
                '所有重复、旋转、路径和空间分布均通过 operations 与受限表达式声明；不得输出 generators 或 constraints。',
                '单个资产的装配完整性优先于组件数量：componentTree 必须恰好只有一个根节点，代表该对象的核心主体（例如建筑主体、树干/主枝、车身、人体躯干、家具主框架或机械机架）；其余组件必须通过 parent 连接到该根节点，形成一棵连通树。不要把单个资产拆成互不关联的多个根对象。',
                '所有子组件 position 必须是相对直接 parent 的局部坐标。先确定对象整体中心、尺度和局部坐标系，再按类别安排部件：建筑的屋顶/塔楼/门窗连接主体；树木的枝干连接树干、树冠叶簇连接枝条；车辆的车轮连接车轴/底盘、车门连接车身；人物的头部和四肢连接躯干/关节；家具的面板、桌腿、靠背连接主框架；机械的轴、齿轮、外壳连接机架或传动组件。',
                '空间关系与连接规则必须以参考图片为准，而不是一律要求部件贴合：允许图片中真实存在的悬空、架空、镂空、环绕、分离式观景舱、细长支撑和装饰间隙；这些结构必须保留其在图片中的高度、间距、相对位置及真实支撑/连接方式。只有与参考图不符的漂浮、断开、错位或无依据散落才属于结构错误。没有参考图片时，再根据物体功能判断合理连接关系。承重、安装、插接部件应接触、嵌入或通过连接件连接；装饰、叶片、毛发和辐条允许自然间距。',
                'parent 只定义层级，不会自动吸附几何体。必须根据 Mesh 的 dimensions、连接点和局部坐标计算 position；不要把所有子组件堆在原点，也不要将子组件误用世界坐标。',
                '坐标约定：Y 轴向上，根节点位于对象整体中心附近，rotation 使用弧度；地面接触类对象底部约为 Y=0，悬空/飞行类对象按其自身中心定位。整体尺寸建议在 2-20 个场景单位。',
                '材质颜色必须贴合提示词和对象类别，不允许全部白色或灰色。禁止重复 ID、缺失父节点、循环层级和未知 primitive。',
                '参考图片结构分析（必须优先遵循；不确定项不得臆造）：' + (visualAnalysis || '无参考图片分析') ,
                '目标对象类型：' + objectType + '；视觉风格：' + visualStyle + '；用户要求：' + prompt,
              ].join('\\n'),
            },
            {
              role: 'user',
              content: imageDataUrl
                ? [
                    { type: 'text', text: '请依据上面的视觉分析和参考图片生成 ObjectSculptSpec。分析中记录的轮廓、宽高比、分段宽度变化、组件相对位置、悬空/间隔/支撑关系必须落实到几何和局部坐标。允许并保留图片中真实存在的悬空、架空、镂空、环绕和观景舱结构；不得为了消除悬空而擅自移动、贴合或删除部件。只修正与图片不符的漂浮、断开和错位。用户补充要求：' + (prompt || '无') + '。只返回 JSON。' },
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
      || spec.schemaVersion !== '3.0' || !Array.isArray(spec.componentTree) || spec.componentTree.length < 1 || spec.componentTree.length > 100
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
    if (Object.prototype.hasOwnProperty.call(spec, 'generators') || Object.prototype.hasOwnProperty.call(spec, 'constraints')) {
      throw new ServiceUnavailableException('ObjectModelSpec 3.0 不接受 generators/constraints；请使用 operations 声明结构运算');
    }
    const operationValidation = validateGeneratedOperations(spec.operations, spec.componentTree);
    spec.operations = operationValidation.operations;
    const operationParameterIds = new Set([...operationValidation.parameterIds, ...operationValidation.expressionParameterIds]);
    spec.parameterSchema = validateGeneratedParameterSchema(normalizeGeneratedParameterBindings(spec.parameterSchema), spec.componentTree, operationParameterIds, spec.materials);
    validateOperationParameterBindings(spec.operations, spec.parameterSchema, spec.componentTree, operationValidation.expressionParameterIds);
    try { validateObjectModelSpecV3(spec); } catch (error) {
      if (!allowGeometryRepair || !(error instanceof Error)) {
        throw new ServiceUnavailableException(error instanceof Error ? error.message : 'ObjectModelSpec 3.0 校验失败');
      }
      this.logger.warn('ObjectModelSpec 3.0 校验失败，执行一次定向修复：' + error.message);
      return this.repairObjectFromValidation(spec, error.message, objectType, visualStyle);
    }

    return { provider: baseUrl, model, objectType, visualStyle, referenceAnalysis, objectSculptSpec: spec };
  }

}
