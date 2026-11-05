import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BuildingDesignService } from './building-design.service';

@Injectable()
export class BuildingTemplatesService {
  private readonly root: string;
  private readonly manifestPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(config: ConfigService, private readonly buildingDesign: BuildingDesignService) {
    this.root = resolve(config.get<string>('ASSET_STORAGE_DIR', './uploads'), 'campus-building-templates');
    this.manifestPath = resolve(this.root, 'manifest.json');
  }
  async list() { return this.readManifest(); }
  async get(id: string) {
    const item = (await this.readManifest()).templates.find((x: any) => x.templateId === id);
    if (!item) throw new NotFoundException('建筑模板不存在');
    return item;
  }
  async create(input: Record<string, unknown>) {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
    if (!name) throw new BadRequestException('模板名称不能为空');
    if (!['ai_generated','manual_model','procedural','external'].includes(String(input.sourceType))) throw new BadRequestException('模板来源无效');
    if (!['procedural','glb'].includes(String(input.modelType))) throw new BadRequestException('模板类型无效');
    if (!['building', 'facility', 'decoration', 'vegetation'].includes(String(input.category || 'building'))) throw new BadRequestException('模板分类无效');
    const design = input.buildingDesign as Record<string, unknown> | undefined;
    if (input.modelType === 'procedural' && (!design || typeof design !== 'object')) throw new BadRequestException('程序化模板缺少结构参数');
    if (input.modelType === 'procedural' && !this.buildingDesign.consumeDesignToken(input.designToken, design)) throw new BadRequestException('程序化模板必须使用已确认图片生成的有效结构参数；请重新确认图片并识别');
    const now = new Date().toISOString();
    const item = { templateId: 'bldtpl-' + randomUUID(), version: 1, name, category: String(input.category || 'building'), sourceType: input.sourceType, modelType: input.modelType, status: 'review', buildingDesign: design || null, prompt: String(input.prompt || '').slice(0,12000), generationModel: input.generationModel || null, referenceImage: null, modelFile: null, createdAt: now, updatedAt: now };
    await this.enqueue(async () => { const m = await this.readManifest(); m.templates.unshift(item); await this.writeManifest(m); });
    return item;
  }
  async uploadFile(id: string, role: string, file: any) {
    if (!file?.buffer || file.size < 1 || file.size > 30 * 1024 * 1024) throw new BadRequestException('模板文件无效或超过 30 MB');
    if (!['model', 'reference'].includes(role)) throw new BadRequestException('文件角色无效');
    const item = await this.get(id);
    if (item.status !== 'review') throw new BadRequestException('只有待审核模板允许上传或替换文件');
    const b: Buffer = file.buffer;
    const glb = b.length >= 20 && b.toString('ascii', 0, 4) === 'glTF' && b.readUInt32LE(4) === 2 && b.readUInt32LE(8) === b.length;
    const png = b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg = b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    const webp = b.length >= 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP';
    if (role === 'model' && (item.modelType !== 'glb' || !glb)) throw new BadRequestException('GLB 模板必须上传有效 GLB 文件');
    if (role === 'reference' && !(png || jpg || webp)) throw new BadRequestException('参考文件必须为 PNG/JPG/WebP');
    const ext = role === 'model' ? '.glb' : jpg ? '.jpg' : webp ? '.webp' : '.png';
    const fileId = randomUUID();
    await mkdir(resolve(this.root, 'files'), { recursive: true });
    const storageName = fileId + ext;
    await writeFile(resolve(this.root, 'files', storageName), b, { flag: 'wx' });
    const metadata = { fileId, storageName, fileName: String(file.originalname || 'asset').slice(0,180),
      mimeType: role === 'model' ? 'model/gltf-binary' : jpg ? 'image/jpeg' : webp ? 'image/webp' : 'image/png',
      sizeBytes: file.size, url: '/api/v1/assets/building-templates/' + id + '/files/' + role };
    await this.enqueue(async () => {
      const m = await this.readManifest(); const target = m.templates.find((x: any) => x.templateId === id);
      if (!target) throw new NotFoundException('建筑模板不存在');
      if (role === 'model') target.modelFile = metadata; else target.referenceImage = metadata;
      target.updatedAt = new Date().toISOString(); await this.writeManifest(m);
    });
    const { storageName: _storageName, ...publicMetadata } = metadata;
    return publicMetadata;
  }
  async getFile(id: string, role: string) {
    const item = await this.get(id); const file = role === 'model' ? item.modelFile : item.referenceImage;
    if (!file?.storageName) throw new NotFoundException('模板文件不存在');
    return { absolutePath: resolve(this.root, 'files', file.storageName), mimeType: file.mimeType, size: file.sizeBytes };
  }
  async approve(id: string) {
    let result: any;
    await this.enqueue(async () => {
      const m = await this.readManifest(); const item = m.templates.find((x: any) => x.templateId === id);
      if (!item) throw new NotFoundException('建筑模板不存在');
      if (item.modelType === 'glb' && !item.modelFile) throw new BadRequestException('请先上传 GLB 模型');
      if (item.modelType === 'procedural' && !item.buildingDesign) throw new BadRequestException('程序化模板缺少结构参数');
      if (item.modelType === 'procedural' && !item.referenceImage) throw new BadRequestException('程序化模板必须保留已确认的参考图片');
      item.status = 'ready'; item.updatedAt = new Date().toISOString(); result = item; await this.writeManifest(m);
    });
    return result;
  }
  private async enqueue(fn: () => Promise<any>) { const next = this.queue.then(fn, fn); this.queue = next.then(() => undefined, () => undefined); return next; }
  private async readManifest(): Promise<any> {
    try { const m = JSON.parse(await readFile(this.manifestPath, 'utf8')); if (m.schemaVersion !== 1 || !Array.isArray(m.templates)) throw new Error('模板清单无效'); return m; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { schemaVersion: 1, templates: [] }; }
  }
  private async writeManifest(m: any) { await mkdir(this.root, { recursive: true }); const tmp = this.manifestPath + '.tmp'; await writeFile(tmp, JSON.stringify(m, null, 2), 'utf8'); await rename(tmp, this.manifestPath); }
}
