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
    if (typeof imageDataUrlInput !== 'string') throw new BadRequestException('请提供建筑参考图');
    const match = imageDataUrlInput.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new BadRequestException('参考图必须是 Base64 PNG、JPG 或 WebP');
    const image = Buffer.from(match[2], 'base64');
    if (image.length < 16 || image.length > MAX_REFERENCE_BYTES) throw new BadRequestException('参考图为空或超过 10 MB');
    const validSignature = image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff)
      || (image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP');
    if (!validSignature) throw new BadRequestException('参考图文件签名无效');
    return image;
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
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\\/+$/, '');
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
            ].join('\\n') },
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
    for (const [key, [fallback, min, max]] of Object.entries(numberFields[category])) {
      geometry[key] = Math.round(bounded(parsed[key], fallback, min, max));
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
    const design = {
      schemaVersion: 1, source: 'ai-vision-estimate', category, objectType, visualStyle, geometry,
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

  /** 验证通用场景设计凭证，签名同时绑定分类、对象类型、风格和完整结构参数。 */
  consumeSceneDesignToken(tokenInput: unknown, category: string, objectType: string, visualStyle: string, designInput: unknown) {
    if (!designInput || typeof designInput !== 'object') return false;
    const digest = createHash('sha256').update(JSON.stringify({ category, objectType, visualStyle, design: designInput })).digest('hex');
    try { return this.verifyToken(tokenInput, 'design', digest); } catch { return false; }
  }

}
