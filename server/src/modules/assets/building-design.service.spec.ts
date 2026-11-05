import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BuildingDesignService } from './building-design.service';

describe('BuildingDesignService', () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0,1,2,3,4]);
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('rejects invalid reference image data before calling the provider', async () => {
    const service = new BuildingDesignService({ get: (key: string) => ({ VISION_API_KEY: 'key', VISION_MODEL: 'deepseek-flash' } as any)[key] } as never);
    await expect(service.analyzeReference('not-a-data-url', 'missing-token')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the configured vision model and returns bounded procedural building parameters', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'secret',
        VISION_MODEL: 'deepseek-flash',
        VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          template: '宿舍楼', floors: 6, roofStyle: 'flat', roofRise: 0.2, massing: 'U-shaped', facadeStyle: 'classical', facadeSections: 4, windowRows: 6, windowColumns: 8, hasBalconies: true, balconyFloors: [2,3,4], columnCount: 6, hasArcade: true, entrancePosition: 'front', podiumFloors: 1, roofColor: 'roofGray',
          windowDensity: 1.8, windowWidth: 0.42, windowHeight: 0.58,
          doorWidth: 0.9, wallPalette: 'wallPeach', confidence: 0.82,
          evidence: ['重复窗格'], limitations: ['背面不可见'],
        }) } }],
      }),
    });
    global.fetch = fetchMock as never;

    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    const result = await service.analyzeReference(imageDataUrl, approval.approvalToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://vision.local/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('deepseek-flash');
    expect(result.design).toMatchObject({
      template: '宿舍楼', floors: 6, height: 7.5,
      heightBasis: 'estimated-scene-units-not-surveyed',
      roofStyle: 'flat', wallPalette: 'wallPeach', massing: 'U-shaped', facadeStyle: 'classical', hasBalconies: true, columnCount: 6, roofColor: 'roofGray', reviewed: false,
    });
    expect(result.designToken).toBeTruthy();
    expect(service.consumeDesignToken(result.designToken, result.design)).toBe(true);
    const secondInstance = new BuildingDesignService({ get: (key: string) => ({ VISION_API_KEY: 'secret' } as Record<string, string>)[key] } as never);
    expect(secondInstance.consumeDesignToken(result.designToken, result.design)).toBe(true);
  });


  it('requires approval of the exact preview image and verifies approval across service instances', async () => {
    const service = new BuildingDesignService({ get: (key: string) => ({ VISION_API_KEY: 'shared-secret' } as Record<string, string>)[key] } as never);
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    await expect(service.analyzeReference(imageDataUrl, undefined)).rejects.toThrow('请先确认建筑参考图片');
    const approval = service.approveReference(imageDataUrl);
    await expect(service.analyzeReference(imageDataUrl, 'wrong-token')).rejects.toThrow('图片确认凭证无效');
    const secondInstance = new BuildingDesignService({ get: () => 'shared-secret' } as never);
    await expect(secondInstance.analyzeReference(imageDataUrl, approval.approvalToken)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails clearly when vision configuration is absent', async () => {
    const service = new BuildingDesignService({ get: (key: string) => ({ ASSET_TOKEN_SECRET: 'test-token-secret' } as Record<string, string>)[key] } as never);
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    await expect(service.analyzeReference(imageDataUrl, approval.approvalToken)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('analyzes a confirmed non-building scene reference and signs category-specific geometry', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'scene-secret', VISION_MODEL: 'vision-test', VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        form: 'tree', canopyShape: 'layered', trunkRatio: 0.5, crownLayers: 4, branchSpread: 0.8,
        leafPalette: 'darkGreen', flowerCount: 0, confidence: 0.9, evidence: ['分层树冠'], limitations: ['背面不可见'],
      }) } }] }),
    }) as never;
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    const result = await service.analyzeSceneReference('vegetation', '香樟树', 'low-poly', imageDataUrl, approval.approvalToken);
    expect(result.design).toMatchObject({
      schemaVersion: 1, category: 'vegetation', objectType: '香樟树', visualStyle: 'low-poly',
      geometry: { form: 'tree', canopyShape: 'layered', trunkRatio: 0.5, crownLayers: 4, leafPalette: 'darkGreen' },
      confidence: 0.9, referenceImageSha256: expect.any(String), reviewed: false,
    });
    expect(service.consumeSceneDesignToken(result.designToken, 'vegetation', '香樟树', 'low-poly', result.design)).toBe(true);
    expect(service.consumeSceneDesignToken(result.designToken, 'vegetation', '灌木', 'low-poly', result.design)).toBe(false);
    expect(service.consumeSceneDesignToken(result.designToken, 'vegetation', '香樟树', 'anime-painted', result.design)).toBe(false);
  });

  it('rejects unsupported category and object combinations before calling vision provider', async () => {
    const service = new BuildingDesignService({ get: (key: string) => ({ VISION_API_KEY: 'secret', VISION_MODEL: 'vision-test' } as Record<string, string>)[key] } as never);
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    await expect(service.analyzeSceneReference('interior', '教室', 'stylized', imageDataUrl, approval.approvalToken)).rejects.toThrow('尚未接入视觉识别 schema');
    await expect(service.analyzeSceneReference('vegetation', '篮球架', 'stylized', imageDataUrl, approval.approvalToken)).rejects.toThrow('对象类型与场景类别不匹配');
  });


  it('rejects spatial categories from the isolated-object recognition endpoint', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'scene-secret', VISION_MODEL: 'vision-test',
      } as Record<string, string>)[key],
    } as never);
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    await expect(service.analyzeSceneReference('road', '道路', 'stylized', imageDataUrl, approval.approvalToken))
      .rejects.toThrow('尚未接入视觉识别 schema');
    await expect(service.analyzeSceneReference('water', '湖泊', 'stylized', imageDataUrl, approval.approvalToken))
      .rejects.toThrow('尚未接入视觉识别 schema');
    await expect(service.analyzeSceneReference('terrain', '山坡', 'stylized', imageDataUrl, approval.approvalToken))
      .rejects.toThrow('尚未接入视觉识别 schema');
  });


  it('issues a new signed credential only after category-bounded manual geometry review', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'review-secret', VISION_MODEL: 'vision-test', VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        form: 'tree', canopyShape: 'layered', trunkRatio: 0.5, crownLayers: 4, branchSpread: 0.8,
        leafPalette: 'darkGreen', flowerCount: 0, confidence: 0.9, evidence: ['分层树冠'], limitations: [],
      }) } }] }),
    }) as never;
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    const identified = await service.analyzeSceneReference('vegetation', '香樟树', 'low-poly', imageDataUrl, approval.approvalToken);
    expect(identified.design.reviewed).toBe(false);
    const geometry = { ...identified.design.geometry, crownLayers: 5, trunkRatio: 0.46 };
    const reviewed = service.reviewSceneDesign('vegetation', '香樟树', 'low-poly', identified.design, identified.designToken, geometry);
    expect(reviewed.design).toMatchObject({ reviewed: true, geometry: { crownLayers: 5, trunkRatio: 0.46 } });
    expect(service.consumeSceneDesignToken(reviewed.designToken, 'vegetation', '香樟树', 'low-poly', reviewed.design)).toBe(true);
    expect(service.consumeSceneDesignToken(identified.designToken, 'vegetation', '香樟树', 'low-poly', reviewed.design)).toBe(false);
    expect(() => service.reviewSceneDesign('vegetation', '香樟树', 'low-poly', identified.design, identified.designToken, { ...geometry, crownLayers: 99 }))
      .toThrow('超出允许范围');
    expect(() => service.reviewSceneDesign('vegetation', '香樟树', 'low-poly', identified.design, identified.designToken, { ...geometry, arbitrary: true }))
      .toThrow('字段与当前类别 Schema 不一致');
  });


});
