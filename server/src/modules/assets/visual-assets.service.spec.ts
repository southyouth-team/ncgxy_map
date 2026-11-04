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
});
