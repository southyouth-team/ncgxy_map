import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

@Injectable()
export class BuildingTemplatesService {
  private readonly root: string;
  private readonly manifestPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(config: ConfigService) {
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
    const design = input.buildingDesign as Record<string, unknown> | undefined;
    if (input.modelType === 'procedural' && (!design || typeof design !== 'object')) throw new BadRequestException('程序化模板缺少结构参数');
    const now = new Date().toISOString();
    const item = { templateId: 'bldtpl-' + randomUUID(), name, category: String(input.category || 'building'), sourceType: input.sourceType, modelType: input.modelType, status: 'review', buildingDesign: design || null, prompt: String(input.prompt || '').slice(0,12000), generationModel: input.generationModel || null, referenceImage: null, modelFile: null, createdAt: now, updatedAt: now };
    await this.enqueue(async () => { const m = await this.readManifest(); m.templates.unshift(item); await this.writeManifest(m); });
    return item;
  }
  async approve(id: string) {
    let result: any;
    await this.enqueue(async () => {
      const m = await this.readManifest(); const item = m.templates.find((x: any) => x.templateId === id);
      if (!item) throw new NotFoundException('建筑模板不存在');
      if (item.modelType === 'glb' && !item.modelFile) throw new BadRequestException('请先上传 GLB 模型');
      if (item.modelType === 'procedural' && !item.buildingDesign) throw new BadRequestException('程序化模板缺少结构参数');
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
