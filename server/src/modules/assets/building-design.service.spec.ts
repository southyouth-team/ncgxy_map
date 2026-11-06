import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BuildingDesignService } from './building-design.service';
import { createObjectModelParameterContractCases } from '../../shared/object-model-parameter-contract.fixtures';

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


  it('adds conversationally requested parameters only when they bind to existing model components', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'parameter-secret',
        VISION_MODEL: 'vision-test',
        VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    const current = {
      schemaVersion: '3.0', targetName: 'gate', category: 'architecture', objectType: '大门', visualStyle: 'stylized',
      materials: { stone: { color: '#c9b18a', roughness: 0.85, metalness: 0, opacity: 1 } },
      componentTree: [
        { id: 'gate', name: '门体', primitive: 'box', material: 'stone', dimensions: { width: 4, height: 5, depth: 1 }, transform: { position: [0,2.5,0], rotation: [0,0,0], scale: [1,1,1] } },
      ],
      parameterSchema: [],
    };
    const parameterSchema = [
      { id: 'gate-length', label: '门体长度', type: 'number', value: 4, min: 2, max: 12, step: 0.5, unit: 'm', targets: [{ nodeId: 'gate', property: 'dimensions.width', mode: 'set' }] },
      { id: 'gate-width', label: '门体宽度', type: 'number', value: 1, min: 0.5, max: 4, step: 0.1, unit: 'm', targets: [{ nodeId: 'gate', property: 'dimensions.depth', mode: 'set' }] },
      { id: 'gate-height', label: '门体高度', type: 'number', value: 5, min: 2, max: 12, step: 0.5, unit: 'm', targets: [{ nodeId: 'gate', property: 'dimensions.height', mode: 'set' }] },
    ];
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ parameterSchema }) } }] }),
    });
    global.fetch = fetchMock as never;
    const result = await service.addObjectParameters(current, '给大门增加长度、宽度和高度三个参数');
    expect(result.addedParameters).toHaveLength(3);
    expect(result.objectSculptSpec.parameterSchema.map((item: any) => item.id)).toEqual(['gate-length', 'gate-width', 'gate-height']);
    const systemPrompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(systemPrompt).toContain('不得虚构字段');
    expect(systemPrompt).toContain('禁止返回 JavaScript');
  });


  it('preserves tube, lathe, sweep and loft descriptors through parameter-design review', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'advanced-geometry-secret',
        VISION_MODEL: 'vision-test',
        VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    const current = {
      schemaVersion: '3.0', targetName: 'advanced-object', category: 'other', objectType: '组合模型', visualStyle: 'stylized',
      materials: { surface: { color: '#aaaaaa', roughness: 0.8, metalness: 0, opacity: 1 } },
      componentTree: [
        { id: 'root', kind: 'group', name: '主体' },
        { id: 'tube-part', parent: 'root', primitive: 'tube', material: 'surface',
          dimensions: { width: 2, height: 2, depth: 2 }, geometryDescriptor: {
            path: [[-0.4, 0, 0], [0, 0.2, 0], [0.4, 0.4, 0]], radius: 0.08, tubularSegments: 24, radialSegments: 8,
          } },
        { id: 'lathe-part', parent: 'root', primitive: 'lathe', material: 'surface',
          dimensions: { width: 2, height: 3, depth: 2 }, geometryDescriptor: {
            profile: [[0.1, -0.5], [0.3, -0.2], [0.2, 0.2], [0.1, 0.5]], segments: 24,
          } },
        { id: 'sweep-part', parent: 'root', primitive: 'sweep', material: 'surface',
          dimensions: { width: 2, height: 2, depth: 2 }, geometryDescriptor: {
            path: [[-0.4, 0, 0], [0, 0.1, 0], [0.4, 0.2, 0]],
            profile: [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]], steps: 24,
          } },
        { id: 'loft-part', parent: 'root', primitive: 'loft', material: 'surface',
          dimensions: { width: 2, height: 3, depth: 2 }, geometryDescriptor: {
            sections: [
              { height: -0.5, points: [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]] },
              { height: 0.5, points: [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]] },
            ],
          } },
      ],
      parameterSchema: [],
      operations: [],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ parameterSchema: [] }) } }] }),
    }) as never;

    const result = await service.addObjectParameters(current, '检查并保留当前几何结构');
    const nodes = new Map(result.objectSculptSpec.componentTree.map((node: any) => [node.id, node]));
    expect(nodes.get('tube-part').geometryDescriptor).toMatchObject({ radius: 0.08, tubularSegments: 24, radialSegments: 8, path: current.componentTree[1]?.geometryDescriptor?.path });
    expect(nodes.get('lathe-part').geometryDescriptor).toMatchObject({ segments: 24, profile: current.componentTree[2]?.geometryDescriptor?.profile });
    expect(nodes.get('sweep-part').geometryDescriptor).toMatchObject({ steps: 24, path: current.componentTree[3]?.geometryDescriptor?.path, profile: current.componentTree[3]?.geometryDescriptor?.profile });
    expect(nodes.get('loft-part').geometryDescriptor).toEqual(current.componentTree[4]?.geometryDescriptor);
  });


  it('adds a dynamic geometry descriptor parameter to ObjectModelSpec 3.0 without changing operations', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'v3-parameter-secret',
        VISION_MODEL: 'vision-test',
        VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    const current = {
      schemaVersion: '3.0',
      targetName: 'steel-frame',
      category: 'other',
      objectType: '钢结构',
      visualStyle: 'realistic',
      materials: { steel: { color: '#777777', roughness: 0.6, metalness: 0.7 } },
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'rib', parent: 'root', primitive: 'tube', material: 'steel',
          dimensions: { width: 1, height: 1, depth: 1 },
          geometryDescriptor: { path: [[0, -0.5, 0], [0, 0.5, 0]], radius: 0.08 } },
      ],
      parameterSchema: [],
      operations: [],
    };
    const parameterSchema = [{
      id: 'rib-radius', label: '钢丝管径', type: 'number', value: 0.08,
      min: 0.04, max: 0.12, step: 0.005,
      targets: [{ nodeId: 'rib', property: 'geometryDescriptor.radius', mode: 'set' }],
    }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ parameterSchema, unsupported: [] }) } }] }),
    }) as never;

    const result = await service.addObjectParameters(current, '增加钢丝管径调整参数');
    const resultSpec = result.objectSculptSpec as any;
    expect(resultSpec.schemaVersion).toBe('3.0');
    expect(resultSpec.parameterSchema).toEqual(parameterSchema);
    expect(resultSpec.operations).toEqual([]);
  });

  it('rejects conversational parameters that target components outside the current model', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'parameter-secret', VISION_MODEL: 'vision-test', VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    const current = {
      schemaVersion: '3.0', targetName: 'gate', category: 'architecture', objectType: '大门', visualStyle: 'stylized',
      materials: { stone: { color: '#c9b18a', roughness: 0.85, metalness: 0, opacity: 1 } },
      componentTree: [{ id: 'gate', name: '门体', primitive: 'box', material: 'stone', dimensions: { width: 4, height: 5, depth: 1 }, transform: { position: [0,2.5,0], rotation: [0,0,0], scale: [1,1,1] } }],
      parameterSchema: [],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ parameterSchema: [
        { id: 'room-count', label: '房间数', type: 'number', value: 12, min: 1, max: 100, targets: [{ nodeId: 'missing-room', property: 'visibility.visible', mode: 'visible-from', threshold: 1 }] },
      ] }) } }] }),
    }) as never;
    await expect(service.addObjectParameters(current, '增加房间数')).rejects.toThrow('参数目标无效');
  });

  it('enforces the shared parameter contract cases on the parameter-design entrypoint', async () => {
    for (const contract of createObjectModelParameterContractCases()) {
      const service = new BuildingDesignService({
        get: (key: string) => ({
          VISION_API_KEY: 'parameter-contract-secret',
          VISION_MODEL: 'vision-test',
          VISION_API_BASE_URL: 'http://vision.local/v1',
        } as Record<string, string>)[key],
      } as never);
      const current = { ...contract.spec, parameterSchema: [] };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ parameterSchema: contract.spec.parameterSchema }) } }] }),
      }) as never;
      if (contract.validator === 'accept') {
        const result = await service.addObjectParameters(current, '为部件添加参数');
        expect(result.objectSculptSpec.parameterSchema).toHaveLength(contract.spec.parameterSchema.length);
      } else {
        await expect(service.addObjectParameters(current, '为部件添加参数'))
          .rejects.toBeInstanceOf(ServiceUnavailableException);
      }
    }
  });

});
