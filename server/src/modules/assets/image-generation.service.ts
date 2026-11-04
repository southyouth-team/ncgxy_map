import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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
}
