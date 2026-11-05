import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PARAMETER_BINDINGS = new Set(['dimensions.width','dimensions.height','dimensions.depth','transform.position.x','transform.position.y','transform.position.z','transform.scale.x','transform.scale.y','transform.scale.z','material.color','material.roughness','material.metalness','material.opacity','geometry.primitive','geometryDescriptor.inset','geometryDescriptor.tube','visibility.visible']);
function validateGeneratedParameterSchema(input: unknown, componentTree: any[]) {
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
    if (!Array.isArray(item.targets) || !item.targets.length || item.targets.length > 100) throw new ServiceUnavailableException('AI 参数目标无效：' + item.id);
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
  /**
   * Prompt-to-3D POC: ask the configured vision/chat model for a bounded ObjectSculptSpec.
   * The model returns JSON data only; no generated JavaScript is evaluated in the server.
   */
  async generateObjectFromPrompt(promptInput: unknown, objectTypeInput: unknown, visualStyleInput: unknown) {
    if (typeof promptInput !== 'string' || !promptInput.trim()) {
      throw new BadRequestException('Three.js 模型生成提示词不能为空');
    }
    const prompt = promptInput.trim().slice(0, 4000);
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
                '你是专业的 Three.js 独立物体建模工程师。根据用户提示词输出 ObjectSculptSpec JSON，不要输出 JavaScript、Markdown 或解释。',
                '根对象字段：schemaVersion 固定为字符串 2.0，targetName，category（AI 自行判断的开放分类）、objectType（AI 自行判断的具体物体）、visualStyle、materials、componentTree、parameterSchema。',
                'materials 是对象，材质项包含 color(#RRGGBB)、roughness(0-1)、metalness(0-1)、opacity(0.05-1)。',
                '根对象还必须输出 parameterSchema 数组，按当前物体实际结构声明可编辑参数。每项包含 id、label、type(number/color/boolean/select)、value、targets；number 另含 min/max/step/unit，select 另含 options；targets 每项包含 nodeId、property、mode。property 仅允许 dimensions.width/height/depth、transform.position.x/y/z、transform.scale.x/y/z、material.color/roughness/metalness/opacity、geometry.primitive、geometryDescriptor.inset/tube、visibility.visible；mode 为 set/multiply/add，visibility.visible 还允许 visible-from/visible-through 并提供 threshold，材质仅 set。一个参数可绑定多个节点实现联动；不要为所有类别硬编码参数，也不要输出脚本或表达式。',
                'componentTree 按对象复杂度包含 1-100 个有意义的独立组件；简单对象可以只有一个组件，复杂对象应按真实结构拆分，不得为了凑数量拆出无意义零件。节点字段：id（唯一英文 ID）、name、role、parent（唯一根节点省略，其余组件必填）、primitive（box/cuboid/polygon/wedge/arch/cylinder/cone/sphere/ellipsoid/torus）、dimensions（width/height/depth 正数）、transform（position/rotation/scale 三个三维数组）、material（materials 中的键）、geometryDescriptor（可选）。',
                '单个资产的装配完整性优先于组件数量：componentTree 必须恰好只有一个根节点，代表该对象的核心主体（例如建筑主体、树干/主枝、车身、人体躯干、家具主框架或机械机架）；其余组件必须通过 parent 连接到该根节点，形成一棵连通树。不要把单个资产拆成互不关联的多个根对象。',
                '所有子组件 position 必须是相对直接 parent 的局部坐标。先确定对象整体中心、尺度和局部坐标系，再按类别安排部件：建筑的屋顶/塔楼/门窗连接主体；树木的枝干连接树干、树冠叶簇连接枝条；车辆的车轮连接车轴/底盘、车门连接车身；人物的头部和四肢连接躯干/关节；家具的面板、桌腿、靠背连接主框架；机械的轴、齿轮、外壳连接机架或传动组件。',
                '几何接合规则按部件功能判断，而不是要求所有 Mesh 表面都互相贴合：承重、安装、插接部件必须接触、嵌入或通过连接件连接；叶片、毛发、装饰、辐条等允许自然间距，但必须有合理的父级归属和空间分布。禁止无理由漂浮、散落或远离主体的零件。',
                'parent 只定义层级，不会自动吸附几何体。必须根据 Mesh 的 dimensions、连接点和局部坐标计算 position；不要把所有子组件堆在原点，也不要将子组件误用世界坐标。',
                '坐标约定：Y 轴向上，根节点位于对象整体中心附近，rotation 使用弧度；地面接触类对象底部约为 Y=0，悬空/飞行类对象按其自身中心定位。整体尺寸建议在 2-20 个场景单位。',
                '材质颜色必须贴合提示词和对象类别，不允许全部白色或灰色。禁止重复 ID、缺失父节点、循环层级和未知 primitive。',
                '目标对象类型：' + objectType + '；视觉风格：' + visualStyle + '；用户要求：' + prompt,
              ].join('\\n'),
            },
            { role: 'user', content: '请直接构建可转换为真实 Three.js Mesh 的独立物体结构，优先保证外轮廓、部件层级、比例和材质。只返回 JSON。' },
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
    spec.parameterSchema = validateGeneratedParameterSchema(spec.parameterSchema, spec.componentTree);
    return { provider: baseUrl, model, objectType, visualStyle, objectSculptSpec: spec };
  }

}
