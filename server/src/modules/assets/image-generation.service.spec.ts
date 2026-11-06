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

  it('normalizes semantic material color aliases such as lattice_color', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const objectSculptSpec = {
      schemaVersion: '3.0',
      materials: { lattice: { color: '#8a623d', roughness: 0.8 } },
      componentTree: [
        { id: 'asset-root', kind: 'group' },
        { id: 'lattice-panel', parent: 'asset-root', primitive: 'box',
          dimensions: { width: 2, height: 1, depth: 0.1 }, material: 'lattice' },
      ],
      parameterSchema: [{
        id: 'lattice-color', label: '格栅颜色', type: 'color', value: '#aabbcc',
        targets: [{ nodeId: 'lattice-panel', property: 'lattice_color' }],
      }],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(objectSculptSpec) } }] }),
    }) as never;

    const result = await service.generateObjectFromPrompt('一个格栅物体', '格栅', 'stylized');
    expect(result.objectSculptSpec.parameterSchema[0].targets).toEqual([
      { nodeId: 'lattice-panel', property: 'material.color' },
    ]);
  });

  it('generates a prompt-based model with one connected component root', async () => {
    const service = createService({
      VISION_API_KEY: 'vision-key',
      VISION_API_BASE_URL: 'http://vision.local/v1',
      VISION_MODEL: 'vision-test',
    });
    const objectSculptSpec = {
      schemaVersion: '3.0',
      targetName: 'castle',
      materials: { stone: { color: '#c9b58d' } },
      componentTree: [
        { id: 'body', name: '主体', primitive: 'box', dimensions: { width: 8, height: 6, depth: 7 }, transform: { position: [0, 3, 0] }, material: 'stone' },
        { id: 'roof', name: '屋顶', parent: 'body', primitive: 'wedge', dimensions: { width: 9, height: 2, depth: 8 }, transform: { position: [0, 4, 0] }, material: 'stone' },
      ],
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...objectSculptSpec, materials: objectSculptSpec.materials }) } }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.generateObjectFromPrompt('一座完整的城堡', '城堡', 'anime-painted');
    const systemPrompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(systemPrompt).toContain('恰好只有一个根节点');
    expect(systemPrompt).toContain('相对直接 parent 的局部坐标');
    expect(systemPrompt).toContain('树木的枝干连接树干');
    expect(systemPrompt).toContain('车轮连接车轴/底盘');
    expect(systemPrompt).toContain('简单对象可以只有一个组件');
    expect(systemPrompt).toContain('tube、lathe、sweep、loft');
    expect(systemPrompt).toContain('operations');
    expect(systemPrompt).toContain('sourceRootId 指向 componentTree 中完整的 Group 子树');
    expect(systemPrompt).toContain('parameterSchema 必须根据本次对象真实结构动态声明');
    expect(systemPrompt).toContain('loft 使用 sections');
    expect(systemPrompt).toContain('geometryDescriptor.radius 必须是 0.01-10');
    expect(result.objectSculptSpec.componentTree[1].parent).toBe('body');
  });

  it('repairs an out-of-range tube radius during first-generation validation', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const invalidSpec = {
      schemaVersion: '3.0',
      materials: { steel: { color: '#777777' } },
      componentTree: [{
        id: 'lattice_rib_cw_2', primitive: 'tube',
        dimensions: { width: 2, height: 2, depth: 2 },
        geometryDescriptor: { path: [[0, -0.4, 0], [0, 0.4, 0]], radius: 12 },
      }],
    };
    const repairedSpec = {
      ...invalidSpec,
      componentTree: [{
        ...invalidSpec.componentTree[0],
        geometryDescriptor: { ...invalidSpec.componentTree[0].geometryDescriptor, radius: 0.08 },
      }],
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(invalidSpec) } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(repairedSpec) } }] }) });
    global.fetch = fetchMock as never;

    const result = await service.generateObjectFromPrompt('一个格栅结构', '格栅', 'stylized');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content).toContain('lattice_rib_cw_2.geometryDescriptor.radius');
    expect(result.objectSculptSpec.componentTree[0].geometryDescriptor.radius).toBe(0.08);
    expect(result.repair.strategy).toBe('targeted-structure-repair');
  });

  it('analyzes reference-image proportions and spatial relations before generating geometry', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_API_BASE_URL: 'http://vision.local/v1', VISION_MODEL: 'vision-test' });
    const analysis = {
      subject: '广州塔',
      silhouette: '高耸的双曲线收腰塔身，中部有环绕式观景结构',
      aspectRatio: { value: 0.22, confidence: 0.8 },
      verticalSections: [{ name: '塔身下段', heightRatio: 0.45 }, { name: '观景结构', heightRatio: 0.2 }, { name: '塔身上段', heightRatio: 0.35 }],
      components: [{ id: 'tower-shaft', position: '中心贯穿主体' }, { id: 'observation-pods', position: '中上部环绕塔身' }],
      spatialRelations: [{ type: 'surrounds', source: 'observation-pods', target: 'tower-shaft' }, { type: 'elevated', source: 'observation-pods', target: 'ground', support: 'tower-shaft' }],
      supports: ['塔身支撑中部观景结构'],
      groundContact: '塔基底部',
      uncertainties: [],
    };
    const spec = {
      schemaVersion: '3.0',
      materials: { steel: { color: '#777777' } },
      componentTree: [{ id: 'tower-root', kind: 'group', name: '广州塔主体' }],
    };
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(analysis) } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(spec) } }] }) });
    global.fetch = fetchMock as never;

    const result = await service.reconstructObjectFromImage(
      'data:image/png;base64,' + png.toString('base64'), '按参考图还原广州塔', '广州塔', 'realistic',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const analysisRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(analysisRequest.messages[1].content[1].type).toBe('image_url');
    const generationRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(generationRequest.messages[0].content).toContain('参考图片结构分析');
    expect(generationRequest.messages[0].content).toContain('观景结构');
    expect(generationRequest.messages[1].content[0].text).toContain('允许并保留图片中真实存在的悬空');
    expect(result.objectSculptSpec.componentTree[0].id).toBe('tower-root');
  });

  it('rejects duplicate component identity IDs before they can overwrite Map entries', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const duplicated = {
      schemaVersion: '3.0',
      materials: { stone: { color: '#c9b58d' } },
      componentTree: [
        { id: 'body', primitive: 'box', dimensions: { width: 2, height: 2, depth: 2 } },
        { id: 'body', parent: 'body', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(duplicated) } }] }),
    }) as never;
    await expect(service.generateObjectFromPrompt('一个物体', '物体', 'stylized'))
      .rejects.toThrow('组件 ID 无效或重复：body');
  });

  it('rejects prompt-generated models with disconnected component roots', async () => {
    const service = createService({
      VISION_API_KEY: 'vision-key',
      VISION_MODEL: 'vision-test',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: '3.0',
        materials: { stone: { color: '#c9b58d' } },
        componentTree: [
          { id: 'body', primitive: 'box' },
          { id: 'tower', primitive: 'cylinder' },
        ],
      }) } }] }),
    }) as never;
    await expect(service.generateObjectFromPrompt('城堡', '城堡', 'anime-painted'))
      .rejects.toThrow('只有一个主体根节点');
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

  it.each([
    {
      name: 'vehicle wheel grid',
      prompt: '一辆低多边形汽车，四个车轮按前后两轴分布',
      objectType: '汽车',
      spec: {
        schemaVersion: '3.0', targetName: 'vehicle',
        materials: { body: { color: '#d43b32', roughness: 0.65 }, rubber: { color: '#202124', roughness: 0.95 } },
        componentTree: [
          { id: 'car-root', kind: 'group', name: '汽车主体' },
          { id: 'body', parent: 'car-root', primitive: 'box', dimensions: { width: 4.2, height: 1.1, depth: 1.9 }, material: 'body' },
          { id: 'wheel-pair', kind: 'group', parent: 'car-root', name: '车轮组模板' },
          { id: 'wheel', parent: 'wheel-pair', primitive: 'cylinder', dimensions: { width: 0.7, height: 0.28, depth: 0.7 }, material: 'rubber', transform: { rotation: [1.5707963267948966, 0, 0] } },
        ],
        parameterSchema: [
          { id: 'axle-rows', type: 'number', value: 2, min: 1, max: 3, step: 1, targets: [] },
          { id: 'wheel-columns', type: 'number', value: 2, min: 1, max: 3, step: 1, targets: [] },
          { id: 'body-width', type: 'number', value: 4.2, min: 3, max: 5, targets: [{ nodeId: 'body', property: 'dimensions.width', mode: 'set' }] },
        ],
        generators: [{ id: 'wheel-grid', type: 'grid', templateRootId: 'wheel-pair', rowParameterId: 'axle-rows', columnParameterId: 'wheel-columns', spacingX: 2.6, spacingZ: 1.5, defaultRows: 2, defaultColumns: 2, maxRows: 3, maxColumns: 3 }],
      },
      expectedGenerator: { id: 'wheel-grid', type: 'grid', defaultRows: 2, defaultColumns: 2 },
      expectedParameters: ['axle-rows', 'wheel-columns', 'body-width'],
    },
    {
      name: 'furniture leg grid',
      prompt: '一张四条腿的木桌，桌面和桌腿结构清晰',
      objectType: '桌子',
      spec: {
        schemaVersion: '3.0', targetName: 'table',
        materials: { wood: { color: '#a66b3f', roughness: 0.82 } },
        componentTree: [
          { id: 'table-root', kind: 'group', name: '桌子主体' },
          { id: 'top', parent: 'table-root', primitive: 'box', dimensions: { width: 2.2, height: 0.16, depth: 1.4 }, material: 'wood', transform: { position: [0, 1.5, 0] } },
          { id: 'leg-pair', kind: 'group', parent: 'table-root', name: '桌腿模板' },
          { id: 'leg', parent: 'leg-pair', primitive: 'box', dimensions: { width: 0.12, height: 1.45, depth: 0.12 }, material: 'wood', transform: { position: [0, 0.72, 0] } },
        ],
        parameterSchema: [
          { id: 'leg-rows', type: 'number', value: 2, min: 1, max: 3, step: 1, targets: [] },
          { id: 'leg-columns', type: 'number', value: 2, min: 1, max: 3, step: 1, targets: [] },
          { id: 'table-width', type: 'number', value: 2.2, min: 1.5, max: 3, targets: [{ nodeId: 'top', property: 'dimensions.width', mode: 'set' }] },
        ],
        generators: [{ id: 'leg-grid', type: 'grid', templateRootId: 'leg-pair', rowParameterId: 'leg-rows', columnParameterId: 'leg-columns', spacingX: 1.8, spacingZ: 1, defaultRows: 2, defaultColumns: 2, maxRows: 3, maxColumns: 3 }],
      },
      expectedGenerator: { id: 'leg-grid', type: 'grid', defaultRows: 2, defaultColumns: 2 },
      expectedParameters: ['leg-rows', 'leg-columns', 'table-width'],
    },
  ])('passes $name provider output through the prompt-generation validator', async fixture => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(fixture.spec) } }] }),
    }) as never;

    const result = await service.generateObjectFromPrompt(fixture.prompt, fixture.objectType, 'low-poly');
    const spec = result.objectSculptSpec;
    expect(spec.componentTree.filter((node: { parent?: string }) => !node.parent)).toHaveLength(1);
    expect(spec.generators).toMatchObject([fixture.expectedGenerator]);
    expect(spec.parameterSchema.map((parameter: { id: string }) => parameter.id)).toEqual(fixture.expectedParameters);
    expect(spec.parameterSchema.find((parameter: { targets: Array<{ property: string }> }) => parameter.targets.length)?.targets[0].property).toBe('dimensions.width');
  });

});