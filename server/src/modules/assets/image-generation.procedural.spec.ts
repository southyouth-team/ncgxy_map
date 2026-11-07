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

  it('returns a parameterized model update from conversational edit context', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const source = 'export const modelParameters = []; export const modelParts = []; export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const generatedCode = 'export const modelParameters = [{ id: "roofColor", label: "屋顶颜色", type: "color", default: "#223355" }]; export const modelParts = [{ id: "roof", name: "屋顶" }]; export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        generatedCode,
        parameters: [{ id: 'roofColor', label: '屋顶颜色', type: 'color', default: '#223355' }],
        parts: [{ id: 'roof', name: '屋顶' }],
        changeSummary: '新增屋顶颜色控制',
      }) } }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.modifyProceduralObjectFromInstruction(
      source,
      [],
      { oldColor: '#ffffff' },
      [{ id: 'roof', name: '屋顶' }],
      'roof',
      '新增一个屋顶颜色控制参数',
      '教学楼',
    );

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const context = JSON.parse(request.messages[1].content);
    expect(context.currentParameterValues.oldColor).toBe('#ffffff');
    expect(context.selectedPartId).toBe('roof');
    expect(result).toMatchObject({
      generatedCode,
      parameters: [{ id: 'roofColor', type: 'color' }],
      parts: [{ id: 'roof', name: '屋顶' }],
      changeSummary: '新增屋顶颜色控制',
    });
  });

  it('passes bounded geometry diagnostics into conversational model-edit context', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const generatedCode = 'export function createModel(THREE, params = {}) { const group = new THREE.Group(); return group; }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        generatedCode, parameters: [], parts: [], changeSummary: '模型已更新',
      }) } }] }),
    });
    global.fetch = fetchMock as never;
    const geometryDiagnostics = {
      version: 1,
      summary: { meshCount: 1, vertexCount: 8, diagnosticCount: 1 },
      meshes: [{ componentId: 'part-a', vertexCount: 8, localBounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } }],
      diagnostics: [{ code: 'non-finite-vertex', severity: 'error', componentId: 'part-a' }],
    };

    await service.modifyProceduralObjectFromInstruction(
      'export function createModel(THREE) { return new THREE.Group(); }',
      [], {}, [], '', '修复模型', '独立 3D 模型', [], {}, geometryDiagnostics,
    );

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    const context = JSON.parse(request.messages[1].content);
    expect(context.currentGeometryDiagnostics).toEqual({ ...geometryDiagnostics, truncated: false });
    expect(request.messages[0].content).toContain('Bounds overlap is only a spatial clue');
  });

  it('streams a one-shot fast path selected by the model planner', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const generatedCode = 'export function createModel(THREE, params = {}) { return new THREE.Group(); }';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ strategy: 'single', generatedCode }) } }] }),
    });
    global.fetch = fetchMock as never;
    const events: any[] = [];

    await service.streamProceduralObjectBuild('一个简单的木箱', '物体', 'stylized', undefined, event => events.push(event));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.map(event => event.type)).toEqual(['stage', 'single', 'complete']);
    expect(events[1].result.generatedCode).toBe(generatedCode);
  });

  it('plans complex models and streams dependency-ordered component chunks', async () => {
    const service = createService({ VISION_API_KEY: 'test-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const plan = {
      version: 1, modelId: 'complex-1', name: 'Complex model',
      coordinateSystem: { upAxis: 'Y', units: 'scene' },
      components: [{ id: 'child', parentId: 'root', purpose: 'child part' }, { id: 'root', purpose: 'root part' }],
    };
    const source = 'export function createComponent(THREE, context = {}) { return new THREE.Group(); }';
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ strategy: 'components', plan }) } }] }) })
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: source } }] }) });
    global.fetch = fetchMock as never;
    const events: any[] = [];

    await service.streamProceduralObjectBuild('复杂模型', '物体', 'stylized', undefined, event => events.push(event));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events.filter(event => event.type === 'component-complete').map(event => event.componentId))
      .toEqual(['root', 'child']);
    expect(events[events.length - 1]).toMatchObject({ type: 'complete', modelId: 'complex-1' });
  });

});
