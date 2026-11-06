import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ImageGenerationService } from './image-generation.service';

describe('ImageGenerationService procedural generation', () => {
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

  it('returns a procedural Three.js factory source without evaluating it', async () => {
    const service = createService({
      VISION_API_KEY: 'test-key',
      VISION_API_BASE_URL: 'http://vision.local/v1',
      VISION_MODEL: 'vision-test',
    });
    const source = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: source } }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.generateProceduralObjectFromPrompt('一栋教学楼', '教学楼', 'realistic');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://vision.local/v1/chat/completions');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[0].content).toContain('img2threejs editable procedural-draft');
    expect(request.messages[0].content).toContain('export function createModel(THREE)');
    expect(result).toMatchObject({
      model: 'vision-test',
      objectType: '教学楼',
      generationMethod: 'img2threejs-procedural',
      generatedCode: source,
    });
  });

  it('passes the reference image to the multimodal model', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_MODEL: 'vision-test' });
    const imageDataUrl = 'data:image/png;base64,aGVsbG8=';
    const source = 'export function createModel(THREE) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: source } }] }),
    });
    global.fetch = fetchMock as never;

    await service.generateProceduralObjectFromPrompt('', '物体', 'stylized', imageDataUrl);

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.messages[1].content[1].image_url.url).toBe(imageDataUrl);
  });

  it('rejects invalid input and malformed factory output', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_MODEL: 'vision-test' });
    await expect(service.generateProceduralObjectFromPrompt(' ', '物体', 'stylized'))
      .rejects.toBeInstanceOf(BadRequestException);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'const group = {}; return group;' } }] }),
    }) as never;

    await expect(service.generateProceduralObjectFromPrompt('一个物体', '物体', 'stylized'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
