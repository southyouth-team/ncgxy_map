import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuildingDesignService } from './building-design.service';
import { BuildingTemplatesService } from './building-templates.service';

describe('BuildingTemplatesService generic scene asset contract', () => {
  let directory: string;
  let service: BuildingTemplatesService;
  let buildingDesign: { consumeDesignToken: jest.Mock; consumeSceneDesignToken: jest.Mock };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ncgxy-scene-templates-'));
    const config = { get: (key: string, fallback?: string) => key === 'ASSET_STORAGE_DIR' ? directory : fallback };
    buildingDesign = { consumeDesignToken: jest.fn(() => true), consumeSceneDesignToken: jest.fn(() => true) };
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
      dimensions: { width: 3, height: 5, depth: 2 },
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
      dimensions: { width: 3, height: 5, depth: 2 },
      status: 'review',
      design: null,
    });
    expect(item.templateId).toMatch(/^astpl-/);
    expect(buildingDesign.consumeDesignToken).not.toHaveBeenCalled();
  });

  it('rejects procedural generation for categories without a registered generator', async () => {
    await expect(service.create({
      name: '室内场景模板',
      category: 'indoor',
      objectType: '教室',
      visualStyle: 'stylized',
      sourceType: 'ai_generated',
      modelType: 'procedural',
      design: { schemaVersion: 1 },
      designToken: 'not-a-building-token',
    })).rejects.toThrow('该场景类别尚未接入参数化生成与识别 schema');

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

  it('creates and publishes a signed procedural template for a supported non-building category', async () => {
    const design = {
      schemaVersion: 1, source: 'ai-vision-estimate', category: 'vegetation',
      objectType: '香樟树', visualStyle: 'low-poly', geometry: { form: 'tree', crownLayers: 3 },
      confidence: 0.8, evidence: [], limitations: [], reviewed: false,
    };
    const item = await service.create({
      name: '识别香樟树', category: 'vegetation', objectType: '香樟树', visualStyle: 'low-poly',
      sourceType: 'ai_generated', modelType: 'procedural', design, designToken: 'signed-scene-token',
    });
    expect(buildingDesign.consumeSceneDesignToken).toHaveBeenCalledWith('signed-scene-token', 'vegetation', '香樟树', 'low-poly', design);
    const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0,1,2,3,4]);
    await service.uploadFile(item.templateId, 'reference', {
      buffer: png, size: png.length, originalname: 'confirmed-reference.png',
    });
    const published = await service.approve(item.templateId);
    expect(published).toMatchObject({ status: 'ready', category: 'vegetation', modelType: 'procedural' });
  });

  it('rejects a scene design whose embedded category, object type or style differs from template metadata', async () => {
    await expect(service.create({
      name: '错误分类模板', category: 'vegetation', objectType: '香樟树', visualStyle: 'low-poly',
      sourceType: 'ai_generated', modelType: 'procedural',
      design: { schemaVersion: 1, category: 'facility', objectType: '长椅', visualStyle: 'toon' },
      designToken: 'token',
    })).rejects.toThrow('场景结构参数分类与模板分类不一致');
    expect(buildingDesign.consumeSceneDesignToken).toHaveBeenCalledTimes(1);
  });

});
