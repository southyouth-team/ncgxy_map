import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateObjectModelSpecV3 } from '../../shared/object-model-spec-v3';
import { normalizeObjectModelParameterSchema } from '../../shared/object-model-parameter-schema';
import { applyObjectModelChangeSet, getObjectModelRevision } from '../../shared/object-model-change-set';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function stableJson(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * Convert a complete AI result into a vertex-only ChangeSet when component
 * identity, topology, materials and all non-position fields remain unchanged.
 * Any structural or topological difference deliberately falls back to the
 * existing component replacement path.
 */
function createVertexOnlyChangeSetResult(original: any, candidate: any) {
  const { componentTree: originalTree, ...originalMetadata } = original;
  const { componentTree: candidateTree, ...candidateMetadata } = candidate;
  if (stableJson(originalMetadata) !== stableJson(candidateMetadata)
    || !Array.isArray(originalTree) || !Array.isArray(candidateTree)
    || originalTree.length !== candidateTree.length) return null;

  const originalById = new Map(originalTree.map((node: any) => [node.id, node]));
  const candidateById = new Map(candidateTree.map((node: any) => [node.id, node]));
  if (originalById.size !== candidateById.size) return null;

  const changes: Array<{ type: 'update-mesh-vertices'; nodeId: string; updates: Array<{ index: number; position: [number, number, number] }> }> = [];
  for (const [nodeId, originalNode] of originalById) {
    const candidateNode = candidateById.get(nodeId);
    if (!candidateNode) return null;
    if (stableJson(originalNode) === stableJson(candidateNode)) continue;
    if (originalNode.geometry?.type !== 'indexed-mesh'
      || candidateNode.geometry?.type !== 'indexed-mesh'
      || !Array.isArray(originalNode.geometry.positions)
      || !Array.isArray(candidateNode.geometry.positions)
      || originalNode.geometry.positions.length !== candidateNode.geometry.positions.length
      || stableJson(originalNode.geometry.indices) !== stableJson(candidateNode.geometry.indices)) return null;

    const withoutPositions = (node: any) => {
      const { positions, ...geometry } = node.geometry;
      return { ...node, geometry };
    };
    if (stableJson(withoutPositions(originalNode)) !== stableJson(withoutPositions(candidateNode))) return null;

    const updates: Array<{ index: number; position: [number, number, number] }> = [];
    for (let offset = 0; offset < originalNode.geometry.positions.length; offset += 3) {
      const previous = originalNode.geometry.positions.slice(offset, offset + 3);
      const next = candidateNode.geometry.positions.slice(offset, offset + 3);
      if (stableJson(previous) === stableJson(next)) continue;
      updates.push({ index: offset / 3, position: next as [number, number, number] });
    }
    if (!updates.length) return null;
    changes.push({ type: 'update-mesh-vertices', nodeId, updates });
  }
  if (!changes.length) return null;

  const result = applyObjectModelChangeSet(original, {
    changeSetVersion: '1.0',
    baseRevision: getObjectModelRevision(original),
    changes,
  });
  return { ...result, changes };
}

/**
 * Convert a validated full AI candidate into the smallest supported structural ChangeSet.
 * The AI may still return a full Spec; the server owns the diff, revision and canonical validation.
 */
function createObjectModelChangeSetResult(original: any, candidate: any) {
  const vertexOnly = createVertexOnlyChangeSetResult(original, candidate);
  if (vertexOnly) return vertexOnly;
  const { componentTree: originalTree, materials: originalMaterials, parameterSchema: originalParameters, operations: originalOperations, ...originalMetadata } = original;
  const { componentTree: candidateTree, materials: candidateMaterials, parameterSchema: candidateParameters, operations: candidateOperations, ...candidateMetadata } = candidate;
  if (stableJson(originalMetadata) !== stableJson(candidateMetadata)
    || !Array.isArray(originalTree) || !Array.isArray(candidateTree)) return null;
  const originalById = new Map<string, any>(originalTree.map((node: any) => [node.id, node]));
  const candidateById = new Map<string, any>(candidateTree.map((node: any) => [node.id, node]));
  if (originalById.size !== originalTree.length || candidateById.size !== candidateTree.length) return null;
  const originalRoots = originalTree.filter((node: any) => !node.parent);
  const candidateRoots = candidateTree.filter((node: any) => !node.parent);
  if (originalRoots.length !== 1 || candidateRoots.length !== 1 || originalRoots[0].id !== candidateRoots[0].id) return null;
  const changes: any[] = [];
  const beforeMaterials = originalMaterials || {}, afterMaterials = candidateMaterials || {};
  for (const [materialId, material] of Object.entries(afterMaterials)) {
    if (!Object.prototype.hasOwnProperty.call(beforeMaterials, materialId) || stableJson(beforeMaterials[materialId]) !== stableJson(material)) {
      changes.push({ type: 'upsert-material', materialId, material });
    }
  }
  const addedNodes = candidateTree.filter((node: any) => !originalById.has(node.id));
  const availableIds = new Set(originalById.keys());
  const pendingAdds = [...addedNodes];
  while (pendingAdds.length) {
    const index = pendingAdds.findIndex((node: any) => node.parent && availableIds.has(node.parent));
    if (index < 0) return null;
    const [node] = pendingAdds.splice(index, 1);
    changes.push({ type: 'add-component', component: node });
    availableIds.add(node.id);
  }
  for (const node of candidateTree) {
    const previous = originalById.get(node.id);
    if (previous && stableJson(previous) !== stableJson(node)) {
      changes.push({ type: 'replace-component', nodeId: node.id, component: node });
    }
  }
  const removedIds = new Set(originalTree.filter((node: any) => !candidateById.has(node.id)).map((node: any) => node.id));
  const removalRoots = originalTree.filter((node: any) => removedIds.has(node.id) && (!node.parent || !removedIds.has(node.parent)));
  for (const node of removalRoots) changes.push({ type: 'remove-component', nodeId: node.id, cascade: true });
  for (const [materialId] of Object.entries(beforeMaterials)) {
    if (Object.prototype.hasOwnProperty.call(afterMaterials, materialId)) continue;
    if (candidateTree.some((node: any) => node.material === materialId)) return null;
    changes.push({ type: 'remove-material', materialId });
  }
  if (stableJson(originalParameters ?? []) !== stableJson(candidateParameters ?? [])) {
    changes.push({ type: 'replace-parameter-schema', parameterSchema: candidateParameters ?? [] });
  }
  if (stableJson(originalOperations ?? []) !== stableJson(candidateOperations ?? [])) {
    changes.push({ type: 'replace-operations', operations: candidateOperations ?? [] });
  }
  if (!changes.length || changes.length > 200) return null;
  const result = applyObjectModelChangeSet(original, {
    changeSetVersion: '1.0',
    baseRevision: getObjectModelRevision(original),
    changes,
  });
  return { ...result, changes };
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
    if (!root || roots.has(root.id)) {
      throw new ServiceUnavailableException('AI instance sourceRootId 必须引用唯一组件节点：' + id);
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

const WORLD_MVP_TEACHING_BUILDING_PROFILE = 'world-mvp-teaching-building';

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
      '只允许修改错误明确涉及的节点及其必要几何字段。不要删除组件，不要改变参考物体轮廓。若修复 indexed-mesh，geometry 必须严格为 {type:"indexed-mesh",positions:[有限数字,...],indices:[非负整数,...]}；positions 长度至少 9 且为 3 的倍数，indices 长度至少 3 且为 3 的倍数，所有索引必须小于顶点数，每个三角形不得退化。无法保证该格式时，删除该节点的 geometry 字段，改用合法 primitive + dimensions；绝不输出半成品 geometry。',
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
        if (mergedMaterials[materialKey] && stableJson(mergedMaterials[materialKey]) === stableJson(generatedMaterial)) return;
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
      const changeSetResult = createObjectModelChangeSetResult(original, mergedSpec);
      return {
        ...result,
        objectSculptSpec: changeSetResult?.objectModelSpec || mergedSpec,
        ...(changeSetResult ? { changeSetResult } : {}),
        affectedNodeIds: changeSetResult?.affectedNodeIds || [...allowedIds],
        editScope: 'component',
      };
    }
    const changeSetResult = createObjectModelChangeSetResult(original, result.objectSculptSpec);
    return {
      ...result,
      objectSculptSpec: changeSetResult?.objectModelSpec || result.objectSculptSpec,
      ...(changeSetResult ? { changeSetResult } : {}),
      affectedNodeIds: changeSetResult?.affectedNodeIds || result.objectSculptSpec.componentTree.map((node: any) => node.id),
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
  async generateObjectFromPrompt(promptInput: unknown, objectTypeInput: unknown, visualStyleInput: unknown, allowGeometryRepair = true, imageDataUrlInput?: unknown, generationProfileInput?: unknown): Promise<any> {
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
    const generationProfile = generationProfileInput == null || generationProfileInput === ''
      ? '' : String(generationProfileInput);
    if (generationProfile && generationProfile !== WORLD_MVP_TEACHING_BUILDING_PROFILE) {
      throw new BadRequestException('不支持的 3D 资产生成配置：' + generationProfile);
    }
    const generationProfileInstruction = generationProfile === WORLD_MVP_TEACHING_BUILDING_PROFILE
      ? '【World Sandbox MVP 建筑目标】生成一栋可从外部观察并可进入的完整两层教学楼。请根据建筑设计自行决定 componentTree 的层级、几何类型、构件数量和重复结构；不要求固定节点 ID、固定 Group、固定 primitive 或固定 operations。重点保证几何实际拼装：窗框/玻璃位于墙面开口内并与墙面贴合，不能漂浮在墙前或离开立面；门窗尺寸与墙体开口匹配；首层墙体、楼板、二层墙体和屋顶连续承接；主体底部与同一地面基准接触，不得整体悬空。允许使用任意合法 indexed-mesh、primitive、geometryDescriptor 和层级组合实现；重复窗户、栏杆、立柱等结构直接展开为普通组件节点，不输出 instance operations，不得为了满足某种协议形式牺牲建筑外观。输出前逐项检查构件的局部坐标和父子变换，确认上述空间关系在累积变换后的对象坐标系中成立。'
      : '';
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

    // 生成任务可能包含大量通用网格顶点数据；等待响应头和读取响应体共用总超时。
    // 默认 10 分钟，并允许部署环境通过 VISION_REQUEST_TIMEOUT_MS 调整，不限制模型输出结构或几何能力。
    const configuredTimeout = Number(this.config.get<string>('VISION_REQUEST_TIMEOUT_MS') || 600000);
    const requestTimeoutMs = Number.isFinite(configuredTimeout)
      ? Math.min(900000, Math.max(30000, Math.floor(configuredTimeout)))
      : 600000;
    const requestStartedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(requestTimeoutMs),
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
                'parameterSchema 必须根据本次对象真实结构动态声明，不得套用固定类别参数清单。只声明能精确绑定到当前 componentTree 真实存在的标量属性的可选参数；对于 indexed-mesh 或没有可编辑标量字段的节点，不得虚构 dimensions/geometryDescriptor 属性；无法确认合法 target 时直接省略该可选参数，不能让参数声明阻断模型生成。每项包含 id、label、type(number/color/boolean/select)、value、targets；number 另含 min/max/step/unit，select 另含 options；targets 每项包含 nodeId、property、mode。property 使用点分隔的真实数据路径，可指向当前节点 dimensions、transform、geometryDescriptor 中存在的标量字段，或当前材质中存在的标量字段；geometry.primitive 和 visibility.visible 为专用语义目标。不得预先穷举属性字段，也不得虚构节点中不存在的字段；服务端按目标实际数据类型校验 number/color/boolean/select。禁止访问 id、parent、kind 等结构身份字段及原型链字段；mode 为 set/multiply/add，visibility.visible 还允许 visible-from/visible-through 并提供 threshold，材质仅 set。一个参数可绑定多个节点实现联动。优先声明对对象语义有意义的参数，例如树高/树冠尺寸/树冠层数、车身长度/轮距/轮胎半径、建筑层数/开间/窗户数量、桌面尺寸/桌腿高度；这些只是示例，必须根据当前对象结构决定是否声明，不能机械添加。',
                '模型表达不受预置几何类型限制；应根据对象真实外形选择最合适的几何表达，通用 indexed-mesh 可直接描述任意三角网格表面，不要为迎合预设形状牺牲外观。',
                'componentTree 按对象复杂度包含 1-100 个有意义的独立组件；简单对象可以只有一个组件，复杂对象应按真实结构拆分，不得为了凑数量拆出无意义零件。节点字段：id（唯一英文 ID）、name、role、kind（group 或 mesh，省略时为 mesh）、parent（唯一根节点省略，其余组件必填）、material（materials 中的键）、transform（position/rotation/scale 三个三维数组）。MVP 优先使用 primitive + dimensions + geometryDescriptor 表达规则几何和可组合部件；只有当基础几何确实无法表达外形时才使用 indexed-mesh。indexed-mesh 的 geometry 必须严格是 {type:"indexed-mesh",positions:[x,y,z,...],indices:[a,b,c,...]}，type 必须逐字为 indexed-mesh；positions 是局部空间有限数字数组，长度至少 9 且为 3 的倍数；indices 是非负整数数组，长度至少 3 且为 3 的倍数，每三个索引定义一个三角形，所有索引必须小于 positions.length/3，且三角形不能退化。geometry 对象只允许 type、positions、indices 三个字段；使用 geometry 时不得同时输出 primitive、dimensions 或 geometryDescriptor。若无法完整满足上述格式，必须省略 geometry，改用合法 primitive + dimensions，不得输出 geometry:null、geometry:{}、geometry:{type:"mesh"} 或半成品字段。',
                '旧式 geometryDescriptor 仍可用于兼容构造：polygon 使用 points，tube 使用 path/radius，lathe 使用 profile，sweep 使用 path/profile，loft 使用 sections。通用 indexed-mesh 不使用这些描述符；不要把通用网格退化成受限轮廓点、路径点或截面数量。',
                'MVP 生成阶段不使用 instance operations、sourceRootId 或表达式参数绑定。重复窗户、栏杆、立柱、车轮、叶片等结构必须直接展开为 componentTree 中的普通组件节点，并通过 parent 组成完整对象；不要为了减少 JSON 长度引入实例化操作。',
                '所有空间结构直接由 componentTree 中的普通节点及其局部 transform 表达；operations 必须省略或返回空数组，不得输出 generators 或 constraints。',
                ...(generationProfileInstruction ? [generationProfileInstruction] : []),
                '单个资产的装配完整性优先于组件数量：componentTree 必须恰好只有一个根节点，代表该对象的核心主体（例如建筑主体、树干/主枝、车身、人体躯干、家具主框架或机械机架）；其余组件必须通过 parent 连接到该根节点，形成一棵连通树。不要把单个资产拆成互不关联的多个根对象。',
                '所有子组件 position 必须是相对直接 parent 的局部坐标。先确定对象整体中心、尺度和局部坐标系，再按类别安排部件：建筑的屋顶/塔楼/门窗连接主体；树木的枝干连接树干、树冠叶簇连接枝条；车辆的车轮连接车轴/底盘、车门连接车身；人物的头部和四肢连接躯干/关节；家具的面板、桌腿、靠背连接主框架；机械的轴、齿轮、外壳连接机架或传动组件。',
                '空间关系与连接规则必须以参考图片为准，而不是一律要求部件贴合：允许图片中真实存在的悬空、架空、镂空、环绕、分离式观景舱、细长支撑和装饰间隙；这些结构必须保留其在图片中的高度、间距、相对位置及真实支撑/连接方式。只有与参考图不符的漂浮、断开、错位或无依据散落才属于结构错误。没有参考图片时，再根据物体功能判断合理连接关系。承重、安装、插接部件应接触、嵌入或通过连接件连接；装饰、叶片、毛发和辐条允许自然间距。',
                'parent 只定义层级，不会自动吸附几何体。必须根据 Mesh 的 dimensions、连接点和局部坐标计算 position；不要把所有子组件堆在原点，也不要将子组件误用世界坐标。',
                '坐标约定：Y 轴向上，根节点位于对象整体中心附近，rotation 使用弧度；地面接触类对象底部约为 Y=0，悬空/飞行类对象按其自身中心定位。整体尺寸建议在 2-20 个场景单位。',
                '材质颜色必须贴合提示词和对象类别，不允许全部白色或灰色。禁止重复 ID、缺失父节点和循环层级。使用通用 geometry 时不得再声明 primitive。',
                '参考图片结构分析（必须优先遵循；不确定项不得臆造）：' + (visualAnalysis || '无参考图片分析'),
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
                : '请直接构建可转换为真实 Three.js Mesh 的独立物体结构，优先保证外轮廓、部件层级、比例和材质。' + (generationProfileInstruction ? '\\n' + generationProfileInstruction : '') + '只返回 JSON。',
            },
          ],
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const elapsedMs = Date.now() - requestStartedAt;
      this.logger.error('提示词 3D 模型生成请求失败（' + errorName + '，' + elapsedMs + 'ms）：' + message);
      if (errorName === 'TimeoutError' || errorName === 'AbortError') {
        throw new ServiceUnavailableException('视觉模型等待响应超时（' + Math.round(requestTimeoutMs / 1000) + ' 秒）');
      }
      throw new ServiceUnavailableException('无法连接视觉模型，请检查后端网络连接');
    }

    const headersReceivedAt = Date.now();
    this.logger.log('提示词 3D 模型生成已收到响应头：HTTP ' + response.status
      + '，等待响应头 ' + (headersReceivedAt - requestStartedAt) + 'ms');

    let responseText = '';
    let payload: any;
    let payloadAlreadyParsed = false;
    try {
      // 原生 Fetch Response 提供 text()，先完整读取响应体再统计字节数和解析耗时。
      // 兼容测试或第三方适配器提供的最小 Response Mock：这类对象可能只实现 json()。
      if (typeof response.text === 'function') {
        responseText = await response.text();
      } else if (typeof response.json === 'function') {
        payload = await response.json() as any;
        responseText = JSON.stringify(payload);
        payloadAlreadyParsed = true;
      } else {
        throw new Error('响应对象未提供 text() 或 json() 方法');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const bodyElapsedMs = Date.now() - headersReceivedAt;
      this.logger.error('提示词 3D 模型生成响应体读取失败（' + errorName + '，响应头等待 '
        + (headersReceivedAt - requestStartedAt) + 'ms，响应体读取 ' + bodyElapsedMs + 'ms，总计 '
        + (Date.now() - requestStartedAt) + 'ms）：' + message);
      if (errorName === 'TimeoutError' || errorName === 'AbortError') {
        throw new ServiceUnavailableException('视觉模型响应体读取超时（总超时 ' + Math.round(requestTimeoutMs / 1000) + ' 秒）');
      }
      throw new ServiceUnavailableException('视觉模型响应体读取失败：' + message.slice(0, 300));
    }

    const responseBytes = Buffer.byteLength(responseText, 'utf8');
    this.logger.log('提示词 3D 模型生成响应体读取完成：HTTP ' + response.status
      + '，响应体 ' + responseBytes + ' bytes，响应体读取 ' + (Date.now() - headersReceivedAt)
      + 'ms，总计 ' + (Date.now() - requestStartedAt) + 'ms');

    if (!response.ok) {
      this.logger.warn('提示词 3D 模型生成 API HTTP ' + response.status + '：' + responseText.slice(0, 1000));
      throw new ServiceUnavailableException('提示词 3D 模型生成失败（HTTP ' + response.status + '）');
    }

    if (!payloadAlreadyParsed) {
      const parseStartedAt = Date.now();
      try {
        payload = JSON.parse(responseText);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error('提示词 3D 模型生成 API JSON 解析失败（响应体 ' + responseBytes + ' bytes，解析 '
          + (Date.now() - parseStartedAt) + 'ms）：' + message);
        throw new ServiceUnavailableException('视觉模型 API 返回的响应不是有效 JSON：' + message.slice(0, 300));
      }
      this.logger.log('提示词 3D 模型生成 JSON 解析完成：解析耗时 ' + (Date.now() - parseStartedAt) + 'ms');
    }
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
    // MVP 先验证纯组件树到 Three.js 的完整链路，不依赖 AI instance/sourceRootId 协议。
    // 即使模型仍输出旧式 instance operations，也直接忽略，由模型提示词要求其展开为普通组件节点。
    if (Array.isArray(spec.operations) && spec.operations.length > 0) {
      this.logger.warn('MVP 生成结果包含 instance operations，已忽略并仅使用 componentTree；重复结构应由模型直接展开为普通组件节点');
    }
    spec.operations = [];
    const operationValidation = validateGeneratedOperations(spec.operations, spec.componentTree);
    spec.operations = operationValidation.operations;
    const operationParameterIds = new Set([...operationValidation.parameterIds, ...operationValidation.expressionParameterIds]);
    try {
      const declaredParameterCount = Array.isArray(spec.parameterSchema) ? spec.parameterSchema.length : 0;
      spec.parameterSchema = normalizeObjectModelParameterSchema(
        spec.parameterSchema, spec.componentTree, spec.materials, operationParameterIds,
        { dropInvalidOptionalTargets: true },
      );
      if (spec.parameterSchema.length < declaredParameterCount) {
        this.logger.warn('AI 参数 Schema 存在无效的可选目标，已丢弃对应编辑参数；资产几何与结构不受影响');
      }
    } catch (error) {
      throw new ServiceUnavailableException(error instanceof Error ? error.message : 'AI 参数 Schema 无效');
    }
    validateOperationParameterBindings(spec.operations, spec.parameterSchema, spec.componentTree, operationValidation.expressionParameterIds);

    try { validateObjectModelSpecV3(spec); } catch (error) {
      if (!allowGeometryRepair || !(error instanceof Error)) {
        throw new ServiceUnavailableException(error instanceof Error ? error.message : 'ObjectModelSpec 3.0 校验失败');
      }
      this.logger.warn('ObjectModelSpec 3.0 校验失败，执行一次定向修复：' + error.message);
      const repaired = await this.repairObjectFromValidation(spec, error.message, objectType, visualStyle);

      return repaired;
    }

    return { provider: baseUrl, model, objectType, visualStyle, referenceAnalysis, objectSculptSpec: spec };
  }


  /**
   * Procedural Three.js generation MVP.
   * The model returns a factory source string; this service never evaluates generated code.
   * Execution and rendering must happen in the isolated preview runtime, not in NestJS.
   */
  async generateProceduralObjectFromPrompt(
    promptInput: unknown,
    objectTypeInput: unknown,
    visualStyleInput: unknown,
    imageDataUrlInput?: unknown,
  ): Promise<any> {
    const prompt = typeof promptInput === 'string' ? promptInput.trim().slice(0, 40000) : '';
    const imageDataUrl = typeof imageDataUrlInput === 'string' ? imageDataUrlInput : '';
    if (!prompt && !imageDataUrl) throw new BadRequestException('程序化模型生成需要提示词或参考图片');
    if (imageDataUrl && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl)
      || Buffer.byteLength(imageDataUrl, 'utf8') > 14 * 1024 * 1024)) {
      throw new BadRequestException('参考图片格式无效或超过 10 MB');
    }

    const objectType = typeof objectTypeInput === 'string' && objectTypeInput.trim()
      ? objectTypeInput.trim().slice(0, 80) : '独立 3D 物体';
    const visualStyle = typeof visualStyleInput === 'string' && visualStyleInput.trim()
      ? visualStyleInput.trim().slice(0, 80) : 'stylized';
    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey || !model) {
      throw new ServiceUnavailableException('程序化模型生成未配置视觉模型，请检查 VISION_API_KEY、VISION_MODEL 和 VISION_API_BASE_URL');
    }

    const configuredTimeout = Number(this.config.get<string>('VISION_REQUEST_TIMEOUT_MS') || 600000);
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.min(900000, Math.max(30000, Math.floor(configuredTimeout))) : 600000;
    const messages: any[] = [
      {
        role: 'system',
        content: [
          'You are an expert procedural Three.js asset artist using the img2threejs editable procedural-draft approach.',
          'Return JavaScript ES module source code only. Do not return JSON, Markdown fences, explanations, TypeScript annotations, imports, or external dependencies.',
          'Legacy factory contract: export function createModel(THREE) remains callable. New factory signature: export function createModel(THREE, params = {}) { ... }.',
          'Export modelParameters and modelParts arrays as named constants. modelParameters describes dynamic controls using id, label, type, default, optional min/max/step/options/group/description. Supported UI types are number, color, boolean, select and text; declare only useful controls for this model. modelParts describes stable part ids, names and parentId values. These arrays are metadata, not a geometry whitelist.',
          'Every adjustable feature must actually read its value from params inside createModel. Use parameter defaults when a value is absent. Keep stable userData.componentId on part groups so parts can be selected.',
          'The factory must synchronously return one THREE.Group. Build real geometry and materials with Three.js APIs.',
          'Use arbitrary combinations of BufferGeometry, ExtrudeGeometry, LatheGeometry, Shape, curves, custom vertices, meshes, groups and materials as appropriate. Do not restrict yourself to a predefined primitive catalogue.',
          'Keep meaningful parts in nested THREE.Group objects. Set stable descriptive object.name values and userData.componentId on editable part groups. Give the root group userData.assetName.',
          'Use local coordinates for child parts. The model should be centered near X/Z origin, Y-up, and stand on Y=0 unless the reference clearly depicts a floating object.',
          'Use procedural geometry and code to reproduce silhouette, proportions, visible structure, material boundaries and small details. Do not use external textures, URLs, network requests, DOM, browser globals, Node APIs, eval, Function, or dynamic imports.',
          'The code must be self-contained and use only the THREE and params arguments. Do not access window, document, globalThis, fetch, XMLHttpRequest, WebSocket, process, require, or filesystem.',
          'Dispose is managed by the host. Do not start animation loops or create renderers/cameras. Return only the model group.',
          'Prefer visual fidelity over low polygon count, but avoid pathological geometry or unbounded loops. Target a practical real-time asset.',
          'Object type: ' + objectType,
          'Visual style: ' + visualStyle,
          'User request: ' + (prompt || 'Reconstruct the visible object in the reference image.'),
        ].join('\n'),
      },
      {
        role: 'user',
        content: imageDataUrl
          ? [
              { type: 'text', text: 'Create the complete editable procedural Three.js model from this reference image. Reproduce visible silhouette, proportions, part relationships and material regions. The image is the primary evidence; do not invent hidden details. Return only the complete JavaScript module exporting createModel(THREE, params = {}), modelParameters and modelParts.' },
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
            ]
          : 'Generate the complete editable procedural model. Return only the createModel(THREE) JavaScript factory.',
      },
    ];

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ model, temperature: 0.25, messages }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('程序化 Three.js 生成请求失败：' + message);
      throw new ServiceUnavailableException('程序化模型生成服务连接失败');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      this.logger.warn('程序化 Three.js 生成 API HTTP ' + response.status + '：' + detail);
      throw new ServiceUnavailableException('程序化模型生成失败（HTTP ' + response.status + '）');
    }
    const payload = await response.json() as any;
    const raw = payload?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new ServiceUnavailableException('视觉模型未返回程序化 Three.js 源码');
    }
    let generatedCode = raw.trim()
      .replace(/^\`\`\`(?:javascript|js|typescript|ts)?\s*/i, '')
      .replace(/\s*\`\`\`$/, '');
    if (generatedCode.length > 120000) {
      throw new ServiceUnavailableException('程序化模型源码超过 120 KB');
    }
    if (!/export\s+function\s+createModel\s*\(\s*THREE(?:\s*,[^)]*)?\)/.test(generatedCode)
      || !/return\s+[A-Za-z_$][\w$]*\s*;?/.test(generatedCode)) {
      throw new ServiceUnavailableException('程序化模型源码缺少 createModel(THREE) 工厂或 Group 返回语句');
    }
    this.logger.log('程序化 Three.js 源码生成完成：模型 ' + model + '，耗时 ' + (Date.now() - startedAt) + 'ms，源码 ' + Buffer.byteLength(generatedCode, 'utf8') + ' bytes');
    return {
      provider: baseUrl,
      model,
      objectType,
      visualStyle,
      generationMethod: 'img2threejs-procedural',
      generatedCode,
      generatedAt: new Date().toISOString(),
    };
  }


  async modifyProceduralObjectFromInstruction(
    sourceInput: unknown, parametersInput: unknown, parameterValuesInput: unknown, partsInput: unknown,
    selectedPartIdInput: unknown, instructionInput: unknown, objectTypeInput?: unknown,
  ): Promise<any> {
    const source = typeof sourceInput === 'string' ? sourceInput.trim() : '';
    const instruction = typeof instructionInput === 'string' ? instructionInput.trim().slice(0, 12000) : '';
    if (!source || !instruction) throw new BadRequestException('模型源码和调整指令不能为空');
    if (source.length > 120000) throw new BadRequestException('模型源码超过 120 KB');
    const parameterDefinitions = Array.isArray(parametersInput) ? parametersInput.slice(0, 100) : [];
    const parameterValues = parameterValuesInput && typeof parameterValuesInput === 'object' && !Array.isArray(parameterValuesInput) ? parameterValuesInput : {};
    const parts = Array.isArray(partsInput) ? partsInput.slice(0, 300) : [];
    const selectedPartId = typeof selectedPartIdInput === 'string' ? selectedPartIdInput.slice(0, 160) : '';
    const objectType = typeof objectTypeInput === 'string' ? objectTypeInput.slice(0, 100) : '独立 3D 模型';
    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (!apiKey || !model) throw new ServiceUnavailableException('模型编辑未配置视觉模型服务');
    const configuredTimeout = Number(this.config.get<string>('VISION_REQUEST_TIMEOUT_MS') || 600000);
    const timeoutMs = Number.isFinite(configuredTimeout) ? Math.min(900000, Math.max(30000, Math.floor(configuredTimeout))) : 600000;
    const system = [
      'You are editing an existing procedural Three.js model for a real-time 3D sandbox.',
      'Return one valid JSON object only, with keys generatedCode, parameters, parts, changeSummary. Do not use Markdown fences.',
      'generatedCode must be a complete self-contained JavaScript ES module exporting createModel(THREE, params = {}), modelParameters and modelParts.',
      'Preserve the existing model identity and visual structure unless the instruction explicitly requests a structural change. Do not replace the whole model unnecessarily.',
      'For part-scoped edits, change only the selected part and the minimum dependent geometry/material required. Keep all unrelated parts and their stable component IDs.',
      'For parameter requests, add or update dynamic controls in modelParameters and make createModel read those values from params. Do not invent a fixed global parameter catalogue; declare model-specific controls.',
      'modelParameters entries should use id, label, type, default, and optional min, max, step, options, group, description. UI types: number, color, boolean, select, text.',
      'modelParts entries should use stable id, name, and optional parentId. Give editable THREE.Group objects matching userData.componentId values.',
      'Do not use external dependencies, imports, network, DOM, browser globals, Node APIs, eval, Function, dynamic imports, animation loops or renderers.',
      'The factory must synchronously return one THREE.Group, use only THREE and params, and keep the model centered near X/Z origin, Y-up, standing on Y=0.',
      'Avoid unbounded loops and pathological geometry. Do not claim that geometry intersections have been automatically detected.',
    ].join('\n');
    const user = JSON.stringify({ objectType, selectedPartId: selectedPartId || null, currentParameters: parameters, currentParts: parts, currentSource: source, instruction });
    let response: Response;
    try {
      response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('程序化模型 AI 编辑请求失败：' + message);
      throw new ServiceUnavailableException('模型 AI 编辑服务连接失败');
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      this.logger.warn('程序化模型 AI 编辑 API HTTP ' + response.status + '：' + detail);
      throw new ServiceUnavailableException('模型 AI 编辑失败（HTTP ' + response.status + '）');
    }
    const payload = await response.json() as any;
    const raw = payload?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string' || !raw.trim()) throw new ServiceUnavailableException('AI 未返回模型编辑结果');
    let result: any;
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      result = JSON.parse(cleaned);
    } catch {
      throw new ServiceUnavailableException('AI 模型编辑结果不是有效 JSON');
    }
    if (!result || typeof result.generatedCode !== 'string' || !result.generatedCode.trim()
      || result.generatedCode.length > 120000
      || !/export\s+function\s+createModel\s*\(\s*THREE(?:\s*,[^)]*)?\)/.test(result.generatedCode)) {
      throw new ServiceUnavailableException('AI 返回的模型源码无效或超过 120 KB');
    }
    return {
      generatedCode: result.generatedCode,
      parameters: Array.isArray(result.parameters) ? result.parameters : [],
      parts: Array.isArray(result.parts) ? result.parts : [],
      changeSummary: typeof result.changeSummary === 'string' ? result.changeSummary : '模型已更新',
      generatedAt: new Date().toISOString(),
    };
  }

}
