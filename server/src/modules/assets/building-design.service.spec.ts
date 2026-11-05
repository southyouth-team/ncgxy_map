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
});
