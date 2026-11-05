import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BuildingDesignService } from './building-design.service';

describe('BuildingDesignService', () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0,1,2,3,4]);
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

  it('rejects invalid reference image data before calling the provider', async () => {
    const service = new BuildingDesignService({ get: (key: string) => ({ VISION_API_KEY: 'key', VISION_MODEL: 'deepseek-flash' } as any)[key] } as never);
    await expect(service.analyzeReference('not-a-data-url')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the configured vision model and returns bounded procedural building parameters', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'secret',
        VISION_MODEL: 'deepseek-flash',
        VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          template: '宿舍楼', floors: 6, roofStyle: 'flat', roofRise: 0.2,
          windowDensity: 1.8, windowWidth: 0.42, windowHeight: 0.58,
          doorWidth: 0.9, wallPalette: 'wallPeach', confidence: 0.82,
          evidence: ['重复窗格'], limitations: ['背面不可见'],
        }) } }],
      }),
    }) as never;

    const result = await service.analyzeReference('data:image/png;base64,' + png.toString('base64'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('http://vision.local/v1/chat/completions');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('deepseek-flash');
    expect(result.design).toMatchObject({
      template: '宿舍楼', floors: 6, height: 7.5,
      heightBasis: 'estimated-scene-units-not-surveyed',
      roofStyle: 'flat', wallPalette: 'wallPeach', reviewed: false,
    });
  });

  it('fails clearly when vision configuration is absent', async () => {
    const service = new BuildingDesignService({ get: () => undefined } as never);
    await expect(service.analyzeReference('data:image/png;base64,' + png.toString('base64'))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
