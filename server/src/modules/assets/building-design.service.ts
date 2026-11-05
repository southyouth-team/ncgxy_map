import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const TEMPLATES = ['街区楼 A', '街区楼 B', '庭院楼', '坡顶楼', '教学楼', '宿舍楼', '办公楼', '实验楼', '图书馆', '体育馆'];
const ROOFS = ['flat', 'pitched', 'span', 'glass'];
const WALLS = ['wallCream', 'wallPeach', 'wallMint', 'wall'];

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
    const category = typeof categoryInput === 'string' ? categoryInput.trim().toLowerCase() : '';
    const objectType = typeof objectTypeInput === 'string' ? objectTypeInput.trim().slice(0, 80) : '';
    const visualStyle = typeof visualStyleInput === 'string' ? visualStyleInput.trim() : '';
    const supportedCategories = ['building', 'structure', 'vegetation', 'facility', 'decoration', 'sports'];
    const styles = ['anime-painted', 'hand-painted', 'low-poly', 'realistic', 'pixel-art', 'stylized', 'toon', 'chinese-traditional', 'european-classical', 'futuristic'];
    if (!supportedCategories.includes(category)) throw new BadRequestException('该分类尚未接入孤立物体结构重建');
    if (!objectType || !styles.includes(visualStyle)) throw new BadRequestException('对象类型或视觉风格无效');
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
                '你是专业的 Three.js 结构化物体重建工程师。根据单张参考图输出 ObjectSculptSpec JSON，不要输出代码、Markdown 或解释。',
                '输出根对象字段：schemaVersion（固定字符串 2.0）、targetName（字符串）、materials（对象，键为材质 ID，每项含 color=#RRGGBB、roughness 0-1、metalness 0-1、opacity 0.05-1）、componentTree（数组）。',
                '每个 componentTree 节点字段：id（唯一英文 ID）、name（中文部件名）、role（部件角色）、parent（父节点 ID，可省略或 null）、primitive（box/cuboid/polygon/wedge/arch/cylinder/cone/sphere/ellipsoid/torus）、dimensions（width/height/depth，均为正数）、transform（position/rotation/scale 三个长度为 3 的数字数组）、material（materials 中的键）、geometryDescriptor（可选 segments 3-48、tube 正数、arch inset 正数；polygon points 为 3-32 个 [-0.5,0.5] 归一化二维坐标点）。',
                '必须输出 12-40 个有意义的独立组件，不能只输出一个整体 Mesh。组件按真实结构拆分；主结构、附属结构、装饰件应有清晰 parent 关系。禁止重复 ID、缺失 parent、循环层级、未知 primitive。',
                '根据图片推断可见部件的相对比例、空间位置、颜色分区和层级。不要用单个大盒子代表整个对象。窗户、门、塔楼、屋顶、栏杆、檐口等明显结构应拆分为独立 Mesh。拱形门窗使用 arch，三角山墙/屋顶剖面使用 wedge；不规则可见平面轮廓使用 polygon 并输出 3-32 个归一化轮廓点；不要把拱门简化为矩形盒子。',
                '如果对象是城堡，优先识别主城楼、左右塔楼、各自塔顶、主屋顶、城垛/女儿墙、入口拱门、窗洞/窗框、旗杆、装饰边线等可见部件；塔楼与塔顶必须独立，左右结构不得错误合并。根据参考图实际内容决定数量，不要机械补全不可见部件。',
                '坐标约定：Y 轴向上；主体中心在 X/Z 原点附近；地面约为 Y=0；position 使用相对父节点坐标；rotation 使用弧度；scale 通常为 [1,1,1]。组件尺寸与场景单位无关，但整体建议落在 2-20 单位范围。',
                '风格必须匹配：' + visualStyle + '。材质颜色和粗糙度应反映图片的色彩分区；禁止把所有部件都输出为白色/灰色。',
                '只描述单张图可见的内容。背面、内部和遮挡部分不可确知，采用结构上合理的保守推断，并在 limitations 中明确说明。',
                '另返回 confidence（0-1）、evidence（最多 8 条字符串）、limitations（最多 8 条字符串）。',
                '分类：' + category + '；对象类型：' + objectType + '。用户补充要求：' + (userPrompt || '按参考图忠实重建可见结构。'),
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
    const minimumComponents = category === 'building' && /城堡|castle/i.test(objectType) ? 12 : category === 'building' ? 6 : 1;
    if (parsed.componentTree.length < minimumComponents || parsed.componentTree.length > 100) {
      throw new ServiceUnavailableException('ObjectSculptSpec 组件数量必须在 ' + minimumComponents + ' 到 100 之间；禁止用单一整体 Mesh 代替结构重建');
    }
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
      const primitive = String(input.primitive || '').toLowerCase();
      if (!['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus'].includes(primitive)) throw new ServiceUnavailableException('组件几何类型不受支持：' + primitive);
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
      if (input.geometryDescriptor && typeof input.geometryDescriptor === 'object') {
        if (input.geometryDescriptor.segments !== undefined) geometryDescriptor.segments = Math.round(number(input.geometryDescriptor.segments, 16, 3, 48));
        if (input.geometryDescriptor.tube !== undefined) geometryDescriptor.tube = number(input.geometryDescriptor.tube, 0.1, 0.01, 10);
        if (input.geometryDescriptor.inset !== undefined) geometryDescriptor.inset = number(input.geometryDescriptor.inset, 0.2, 0.02, 20);
        if (primitive === 'polygon') {
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
        name: String(input.name || id).slice(0, 120),
        role: String(input.role || 'component').slice(0, 80),
        ...(typeof input.parent === 'string' && input.parent ? { parent: input.parent } : {}),
        primitive,
        dimensions: {
          width: number(dimensions.width, 1, 0.02, 100),
          height: number(dimensions.height, 1, 0.02, 100),
          depth: number(dimensions.depth, 1, 0.02, 100),
        },
        transform: {
          position: vector(transform.position, [0, 0, 0]),
          rotation: vector(transform.rotation, [0, 0, 0]),
          scale,
        },
        material,
        ...(Object.keys(geometryDescriptor).length ? { geometryDescriptor } : {}),
      };
    });
    const byId = new Map<string, any>(componentTree.map((node: any) => [node.id, node] as [string, any]));
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
    const objectSculptSpec = {
      schemaVersion: '2.0',
      targetName: String(parsed.targetName || objectType).slice(0, 120),
      materials,
      componentTree,
    };
    const design = {
      schemaVersion: 1,
      source: 'ai-vision-object-sculpt',
      category,
      objectType,
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
    return { provider: baseUrl, model, category, objectType, visualStyle, design, designToken, designTokenExpiresInSeconds: 900 };
  }


  /**
   * 审核编辑后的 ObjectSculptSpec。原始 AI 凭证必须有效且未过期；
   * 服务端重新规范化整个组件树并签发绑定最终设计的新凭证。
   */
  reviewObjectDesign(originalDesignInput: unknown, originalTokenInput: unknown, objectSculptSpecInput: unknown) {
    const original = originalDesignInput as Record<string, any> | undefined;
    if (!original || typeof original !== 'object' || Array.isArray(original)
      || original.category !== 'building' || original.source !== 'ai-vision-object-sculpt'
      || original.reviewed === true || !this.consumeDesignToken(originalTokenInput, original)) {
      throw new BadRequestException('原始建筑设计凭证无效、已审核或已过期，请重新识别');
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
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(key) || !item || typeof item !== 'object' || Array.isArray(item)
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
      const primitive = String(node.primitive || '').toLowerCase();
      if (!primitives.includes(primitive)) throw new BadRequestException('组件几何类型不受支持：' + primitive);
      const dimensions = node.dimensions;
      if (!dimensions || typeof dimensions !== 'object') throw new BadRequestException('组件尺寸缺失：' + id);
      const dimension = (key: string) => {
        const value = dimensions[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.02 || value > 100) throw new BadRequestException(id + '.' + key + ' 超出允许范围');
        return value;
      };
      const width = dimension('width'), height = dimension('height'), depth = dimension('depth');
      const transform = node.transform && typeof node.transform === 'object' ? node.transform : {};
      const scale = vector(transform.scale, [1,1,1], id + '.scale', -20, 20);
      if (scale.some(value => Math.abs(value) < 0.001)) throw new BadRequestException(id + '.scale 不能为零');
      if (typeof node.material !== 'string' || !materials[node.material]) throw new BadRequestException(id + '.material 不存在');
      const geometryDescriptor: Record<string, any> = {};
      const descriptor = node.geometryDescriptor && typeof node.geometryDescriptor === 'object' ? node.geometryDescriptor : {};
      if (descriptor.segments !== undefined) {
        if (typeof descriptor.segments !== 'number' || !Number.isInteger(descriptor.segments) || descriptor.segments < 3 || descriptor.segments > 48) throw new BadRequestException(id + '.segments 超出范围');
        geometryDescriptor.segments = descriptor.segments;
      }
      if (descriptor.tube !== undefined) {
        if (typeof descriptor.tube !== 'number' || !Number.isFinite(descriptor.tube) || descriptor.tube < 0.01 || descriptor.tube > Math.max(width, depth) * 0.225) throw new BadRequestException(id + '.tube 超出范围');
        geometryDescriptor.tube = descriptor.tube;
      }
      if (descriptor.inset !== undefined) {
        if (typeof descriptor.inset !== 'number' || !Number.isFinite(descriptor.inset) || descriptor.inset < 0.02 || descriptor.inset > Math.min(width, height) * 0.4) throw new BadRequestException(id + '.inset 超出范围');
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
        id, name: String(node.name || id).slice(0,120), role: String(node.role || 'component').slice(0,80),
        ...(typeof node.parent === 'string' && node.parent ? { parent: node.parent } : {}),
        primitive,
        dimensions: { width, height, depth },
        transform: {
          position: vector(transform.position, [0,0,0], id + '.position', -100, 100),
          rotation: vector(transform.rotation, [0,0,0], id + '.rotation', -100, 100),
          scale,
        },
        material: node.material,
        ...(Object.keys(geometryDescriptor).length ? { geometryDescriptor } : {}),
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
    const design = {
      ...original,
      objectSculptSpec: {
        schemaVersion: '2.0',
        targetName: String(input.targetName || original.objectType).slice(0,120),
        materials,
        componentTree,
      },
      reviewed: true,
      reviewedAt: new Date().toISOString(),
    };
    const designToken = this.signToken('design', createHash('sha256').update(JSON.stringify(design)).digest('hex'));
    return { design, designToken, designTokenExpiresInSeconds: 900 };
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
