import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const TEMPLATES = ['街区楼 A', '街区楼 B', '庭院楼', '坡顶楼', '教学楼', '宿舍楼', '办公楼', '实验楼', '图书馆', '体育馆'];
const ROOFS = ['flat', 'pitched', 'span', 'glass'];
const WALLS = ['wallCream', 'wallPeach', 'wallMint', 'wall'];

@Injectable()
export class BuildingDesignService {
  private readonly logger = new Logger(BuildingDesignService.name);

  constructor(private readonly config: ConfigService) {}

  async analyzeReference(imageDataUrlInput: unknown) {
    if (typeof imageDataUrlInput !== 'string') {
      throw new BadRequestException('请提供建筑参考图');
    }
    const match = imageDataUrlInput.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new BadRequestException('参考图必须是 Base64 PNG、JPG 或 WebP');
    const image = Buffer.from(match[2], 'base64');
    if (image.length < 16 || image.length > MAX_REFERENCE_BYTES) {
      throw new BadRequestException('参考图为空或超过 10 MB（避免 Base64 请求体超过服务端 JSON 限额）');
    }
    const validSignature = image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff)
      || (image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP');
    if (!validSignature) throw new BadRequestException('参考图文件签名无效');

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
                '只返回 JSON，不要 Markdown。字段：template（必须从以下枚举选择：' + TEMPLATES.join('、') + '）；floors（1-30 整数）；roofStyle（flat/pitched/span/glass）；roofRise（0-3 的场景视觉单位）；windowDensity（0.1-3）；windowWidth（0.28-2）；windowHeight（0.2-2）；doorWidth（0.5-3）；wallPalette（wallCream/wallPeach/wallMint/wall）；confidence（0-1）；evidence（字符串数组，最多 6 条）；limitations（字符串数组，最多 6 条）。',
                '不要输出建筑真实长宽、真实高度、地理位置或测绘结论。单张图无法确认的结构按保守值估计，并降低 confidence。',
                'roofStyle: 平屋顶选 flat，双坡屋顶选 pitched，跨度大/体育馆式屋顶选 span，玻璃顶选 glass。',
                'windowDensity 表示每段立面相对窗户密度，常规教学楼约 1，密集宿舍楼约 1.4，稀疏公共建筑约 0.5。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这张 AI 生成的校园建筑参考图，给出可直接驱动参数化 3D 几何生成器的外观参数。' },
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
      roofRise: number(parsed?.roofRise, 0.6, 0, 3),
      windowDensity: number(parsed?.windowDensity, 1, 0.1, 3),
      windowWidth: number(parsed?.windowWidth, 0.48, 0.28, 2),
      windowHeight: number(parsed?.windowHeight, 0.62, 0.2, 2),
      doorWidth: number(parsed?.doorWidth, 0.9, 0.5, 3),
      wallPalette: WALLS.includes(parsed?.wallPalette) ? parsed.wallPalette : 'wallCream',
      confidence: number(parsed?.confidence, 0.35, 0, 1),
      evidence: Array.isArray(parsed?.evidence) ? parsed.evidence.filter((item: unknown) => typeof item === 'string').slice(0, 6).map((item: string) => item.slice(0, 180)) : [],
      limitations: Array.isArray(parsed?.limitations) ? parsed.limitations.filter((item: unknown) => typeof item === 'string').slice(0, 6).map((item: string) => item.slice(0, 180)) : [],
      reviewed: false,
    };
    return { provider: baseUrl, model, design };
  }
}
