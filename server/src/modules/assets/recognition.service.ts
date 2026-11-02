import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

@Injectable()
export class RecognitionService {
  private readonly storageDir: string;
  constructor(private readonly db: DataSource, private readonly config: ConfigService) {
    this.storageDir = resolve(config.get<string>('ASSET_STORAGE_DIR', './uploads'));
  }

  async recognize(userId: string, campusId: string, mapId: string, assetId: string) {
    await this.requireRole(userId, campusId, ['owner', 'admin', 'editor']);
    const assets = await this.db.query(`SELECT object_key,mime_type FROM campus_asset WHERE id=$1 AND campus_id=$2 AND map_id=$3 AND asset_type='base-map' AND storage_provider='local-filesystem'`, [assetId,campusId,mapId]);
    if (!assets.length) throw new NotFoundException('底图资源不存在或不属于当前地图');
    const apiKey = this.config.get<string>('VISION_API_KEY');
    const model = this.config.get<string>('VISION_MODEL');
    if (!apiKey || !model) throw new ServiceUnavailableException('尚未配置视觉模型：请设置 VISION_API_KEY、VISION_MODEL；兼容接口可设置 VISION_API_BASE_URL。');
    const path = resolve(this.storageDir, assets[0].object_key);
    const rel = relative(this.storageDir, path);
    if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new BadRequestException('底图资源路径无效');
    const image = await readFile(path);
    const mime = assets[0].mime_type;
    const baseUrl = (this.config.get<string>('VISION_API_BASE_URL', 'https://api.openai.com/v1') || '').replace(/\/$/, '');
    const response = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        model, temperature: 0.1, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是 GIS 制图识别助手。只返回 JSON：{"imageSummary":"...","features":[{"type":"building|road|green|water|sports|plaza|parking|facility","name":"...","confidence":0.0,"geometry":{"type":"Polygon|LineString","coordinates":[]},"properties":{}}]}。坐标为图片原始像素，原点左上。Polygon coordinates 为 [外环] 且首尾闭合；LineString 至少两个点。识别建筑、道路、绿地、水体、运动场、广场、停车场和设施；忽略文字、图例、指北针和图框；不确定时降低置信度，不要臆造。规划图优先提取建筑边界与道路边界。' },
          { role: 'user', content: [{ type: 'text', text: '提取这张校园地图中的全部可见空间要素。' }, { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + image.toString('base64'), detail: 'high' } }] },
        ],
      }),
    });
    if (!response.ok) throw new ServiceUnavailableException('视觉模型请求失败 HTTP ' + response.status + '：' + (await response.text()).slice(0, 1000));
    const payload = await response.json() as any;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new BadRequestException('视觉模型未返回 JSON 文本');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.features) || parsed.features.length > 20000) throw new BadRequestException('识别结果格式无效');
    const allowed = ['building','road','green','water','sports','plaza','parking','facility'];
    const features = parsed.features.map((item: any, index: number) => {
      if (!allowed.includes(item?.type) || !['Polygon','LineString'].includes(item?.geometry?.type)) throw new BadRequestException('第 ' + (index + 1) + ' 个要素类型或几何无效');
      const coords = item.geometry.type === 'Polygon' ? item.geometry.coordinates?.[0] : item.geometry.coordinates;
      if (!Array.isArray(coords) || coords.length < (item.geometry.type === 'Polygon' ? 4 : 2) || coords.some((p: any) => !Array.isArray(p) || p.length !== 2 || p.some((v: any) => !Number.isFinite(Number(v))))) throw new BadRequestException('第 ' + (index + 1) + ' 个要素坐标无效');
      const confidence = Number(item.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new BadRequestException('第 ' + (index + 1) + ' 个要素置信度无效');
      return { type: item.type, name: String(item.name || item.type).slice(0,120), confidence, geometry: item.geometry, properties: item.properties || {}, source: 'ai-vision', reviewRequired: confidence < 0.75 };
    });
    return { provider: baseUrl, model, imageSummary: String(parsed.imageSummary || ''), featureCount: features.length, features };
  }

  private async requireRole(userId: string, campusId: string, allowed: string[]) {
    const rows = await this.db.query('SELECT role FROM campus_member WHERE campus_id=$1 AND user_id=$2', [campusId,userId]);
    if (!rows.length) throw new NotFoundException('学校不存在或无权访问');
    if (!allowed.includes(rows[0].role)) throw new ForbiddenException('当前角色无权执行此操作');
  }
}