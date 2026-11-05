import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuildingDesignService } from './building-design.service';
import { BuildingTemplatesService } from './building-templates.service';

describe('BuildingTemplatesService generic scene asset contract', () => {
  let directory: string;
  let service: BuildingTemplatesService;
  let buildingDesign: { consumeDesignToken: jest.Mock };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ncgxy-scene-templates-'));
    const config = { get: (key: string, fallback?: string) => key === 'ASSET_STORAGE_DIR' ? directory : fallback };
    buildingDesign = { consumeDesignToken: jest.fn(() => true) };
    service = new BuildingTemplatesService(config as any, buildingDesign as unknown as BuildingDesignService);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('creates an independent GLB template for a non-building scene category', async () => {
    const item = await service.create({
      name: '香樟树模板',
      category: 'vegetation',
      objectType: '乔木',
      visualStyle: 'low-poly',
      sourceType: 'manual_model',
      modelType: 'glb',
      prompt: '一棵校园香樟树',
    });

    expect(item).toMatchObject({
      name: '香樟树模板',
      category: 'vegetation',
      objectType: '乔木',
      visualStyle: 'low-poly',
      modelType: 'glb',
      status: 'review',
      design: null,
    });
    expect(item.templateId).toMatch(/^astpl-/);
    expect(buildingDesign.consumeDesignToken).not.toHaveBeenCalled();
  });

  it('rejects procedural generation for categories without a registered generator', async () => {
    await expect(service.create({
      name: '湖泊模板',
      category: 'water',
      objectType: '湖泊',
      visualStyle: 'stylized',
      sourceType: 'ai_generated',
      modelType: 'procedural',
      design: { schemaVersion: 1 },
      designToken: 'not-a-building-token',
    })).rejects.toThrow('当前仅建筑类别接入参数化生成器');

    expect(buildingDesign.consumeDesignToken).not.toHaveBeenCalled();
  });

  it('rejects unknown scene categories', async () => {
    await expect(service.create({
      name: '未知模板',
      category: 'unknown',
      sourceType: 'manual_model',
      modelType: 'glb',
    })).rejects.toThrow('模板分类无效');
  });
});
