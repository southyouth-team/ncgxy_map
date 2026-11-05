import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetsService } from './assets.service';

describe('AssetsService visual asset persistence', () => {
  let directory: string;
  let service: AssetsService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ncgxy-visual-assets-'));
    const config = { get: (key: string, fallback?: string) => key === 'ASSET_STORAGE_DIR' ? directory : fallback };
    service = new AssetsService({ query: jest.fn() } as any, config as any);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists approved image bytes and atomically registers a ready Feature binding', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await service.uploadVisualAsset('local-user', {
      originalname: 'campus.png',
      mimetype: 'image/png',
      size: bytes.length,
      buffer: bytes,
    }, {
      featureId: 'building-001',
      viewMode: '2.5d',
      sourceType: 'ai_generated',
      name: '教学楼 AI 图片',
      generationModel: 'gpt-image-2',
      prompt: 'isometric campus building',
    });

    expect(result.assetId).toBe('campus-building-001');
    expect(result.url).toContain('/api/v1/assets/visual-assets/');
    const manifest = await service.getVisualAssetManifest();
    expect(manifest.assets[0].status).toBe('ready');
    expect(manifest.bindings).toEqual([{ featureId: 'building-001', assetId: 'campus-building-001' }]);

    const stored = await service.getVisualAssetContent(result.fileId);
    expect(await readFile(stored.absolutePath)).toEqual(bytes);
  });


  it('persists AI-derived 3D building parameters alongside the 2.5D reference image', async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const design = { schemaVersion: 1, template: '教学楼', floors: 4, height: 5, roofStyle: 'pitched', roofRise: 0.8, windowDensity: 1.2, windowWidth: 0.5, windowHeight: 0.7, doorWidth: 0.9, wallPalette: 'wallCream', confidence: 0.78 };
    await service.uploadVisualAsset('local-user', { originalname: 'reference.png', mimetype: 'image/png', size: bytes.length, buffer: bytes }, { featureId: 'building-003', viewMode: '2.5d', sourceType: 'ai_generated', name: '教学楼参考图', buildingDesign: JSON.stringify(design) });
    const manifest = await service.getVisualAssetManifest();
    expect(manifest.assets[0].buildingDesign).toMatchObject({ template: '教学楼', floors: 4, roofStyle: 'pitched', heightBasis: 'estimated-scene-units-not-surveyed', confidence: 0.78 });
  });

  it('rejects a file whose signature does not match the selected view', async () => {
    await expect(service.uploadVisualAsset('local-user', {
      originalname: 'not-an-image.png',
      mimetype: 'image/png',
      size: 8,
      buffer: Buffer.from('not-image'),
    }, {
      featureId: 'building-001',
      viewMode: '2.5d',
      sourceType: 'ai_generated',
      name: 'invalid',
    })).rejects.toThrow('文件真实格式与所选视角不匹配');
  });

  it('groups 2.5D and 3D variants under the same stable asset ID', async () => {
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await service.uploadVisualAsset('local-user', {
      originalname: 'campus.png', mimetype: 'image/png', size: image.length, buffer: image,
    }, { featureId: 'building-002', viewMode: '2.5d', sourceType: 'ai_generated', name: '楼栋' });

    const glb = Buffer.alloc(20);
    glb.write('glTF', 0, 'ascii');
    glb.writeUInt32LE(2, 4);
    await service.uploadVisualAsset('local-user', {
      originalname: 'campus.glb', mimetype: 'model/gltf-binary', size: glb.length, buffer: glb,
    }, { featureId: 'building-002', viewMode: '3d', sourceType: 'manual_model', name: '楼栋' });

    const manifest = await service.getVisualAssetManifest();
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0].assetId).toBe('campus-building-002');
    expect(manifest.assets[0].files.map((file: any) => file.viewMode).sort()).toEqual(['2.5d', '3d']);
    expect(manifest.bindings).toHaveLength(1);
  });
  it('persists and owner-scopes a complete structured ObjectSculptSpec', async () => {
    const objectSculptSpec = {
      schemaVersion: '2.0',
      targetName: '参数化教学楼',
      category: 'building',
      objectType: '教学楼',
      visualStyle: 'anime-painted',
      materials: { wall: { color: '#e7d2a5', roughness: 0.8, metalness: 0, opacity: 1 } },
      componentTree: [
        { id: 'body-group', kind: 'group', transform: { position: [0,5,0] } },
        { id: 'body', parent: 'body-group', primitive: 'box', material: 'wall', dimensions: { width: 8, height: 10, depth: 6 } },
      ],
      parameterSchema: [{ id: 'height', label: '整体高度', type: 'number', value: 10, min: 5, max: 20, targets: [{ nodeId: 'body', property: 'dimensions.height', mode: 'set' }] }],
    };
    const saved = await service.saveObjectSculptAsset('owner-1', { name: '教学楼', objectSculptSpec });
    expect(saved.assetId).toMatch(/^[a-f0-9-]{36}$/i);
    const loaded = await service.getObjectSculptAsset('owner-1', saved.assetId);
    expect(loaded.spec).toEqual(objectSculptSpec);
    expect(loaded.spec.componentTree[0].kind).toBe('group');
    await expect(service.getObjectSculptAsset('owner-2', saved.assetId)).rejects.toThrow('无权读取');
  });

});
