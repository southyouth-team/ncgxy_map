import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ImageGenerationService } from './image-generation.service';

describe('ImageGenerationService', () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0,1,2,3,4]);
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(values: Record<string, string>) {
    return new ImageGenerationService({
      get: (key: string) => values[key],
    } as never);
  }

  it('validates prompt before calling provider', async () => {
    const service = createService({ IMAGE_API_KEY: 'test-key' });
    await expect(service.generate('  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.generate('x'.repeat(12001))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the configured image model and returns a validated PNG data URL', async () => {
    const service = createService({
      IMAGE_API_KEY: 'test-key',
      IMAGE_API_BASE_URL: 'http://image-provider.local/v1/',
      IMAGE_MODEL: 'gpt-image-2',
      VISION_MODEL: 'deepseek-flash',
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: png.toString('base64'), revised_prompt: 'revised' }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.generate('A stylized campus building');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://image-provider.local/v1/images/generations');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toMatchObject({ model: 'gpt-image-2', n: 1, size: '1024x1024' });
    expect(result.mimeType).toBe('image/png');
    expect(result.dataUrl).toBe('data:image/png;base64,' + png.toString('base64'));
    expect(result.model).toBe('gpt-image-2');
  });

  it('reuses vision credentials without changing the vision model', async () => {
    const service = createService({
      VISION_API_KEY: 'shared-key',
      VISION_API_BASE_URL: 'http://shared-provider.local/v1',
      VISION_MODEL: 'deepseek-flash',
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: png.toString('base64') }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.generate('Campus visual asset');
    expect(fetchMock.mock.calls[0][0]).toBe('http://shared-provider.local/v1/images/generations');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('gpt-image-2');
    expect(result.model).toBe('gpt-image-2');
  });

  it('fails clearly when image credentials are missing', async () => {
    const service = createService({});
    await expect(service.generate('Campus visual asset')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects non-image provider payloads', async () => {
    const service = createService({ IMAGE_API_KEY: 'test-key' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('not an image payload').toString('base64') }] }),
    }) as never;
    await expect(service.generate('Campus visual asset')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
