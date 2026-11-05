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


  it('reconstructs a confirmed castle reference into a signed hierarchical ObjectSculptSpec', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'sculpt-secret',
        VISION_MODEL: 'vision-test',
        VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    const componentTree = [
      { id: 'keep', name: '主城楼', role: 'main-massing', primitive: 'box', dimensions: { width: 7, height: 5, depth: 5 }, transform: { position: [0, 2.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'stone' },
      { id: 'west-tower', name: '西侧塔楼', role: 'tower', parent: 'keep', primitive: 'cylinder', dimensions: { width: 2, height: 7, depth: 2 }, transform: { position: [-2.8, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'stone' },
      { id: 'west-roof', name: '西塔尖顶', role: 'tower-roof', parent: 'west-tower', primitive: 'cone', dimensions: { width: 2.8, height: 2.2, depth: 2.8 }, transform: { position: [0, 4.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'roof' },
      { id: 'east-tower', name: '东侧塔楼', role: 'tower', parent: 'keep', primitive: 'cylinder', dimensions: { width: 2, height: 7, depth: 2 }, transform: { position: [2.8, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'stone' },
      { id: 'east-roof', name: '东塔尖顶', role: 'tower-roof', parent: 'east-tower', primitive: 'cone', dimensions: { width: 2.8, height: 2.2, depth: 2.8 }, transform: { position: [0, 4.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'roof' },
      { id: 'main-roof', name: '主楼屋顶', role: 'main-roof', parent: 'keep', primitive: 'cone', dimensions: { width: 7.8, height: 2, depth: 5.8 }, transform: { position: [0, 3.4, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'roof' },
      { id: 'gate', name: '入口', role: 'entrance', parent: 'keep', primitive: 'box', dimensions: { width: 1.6, height: 2.4, depth: 0.35 }, transform: { position: [0, -0.6, 2.55], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'dark' },
      { id: 'window-a', name: '左窗', role: 'window', parent: 'keep', primitive: 'box', dimensions: { width: 0.6, height: 1, depth: 0.1 }, transform: { position: [-1.4, 1.2, 2.55], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'glass' },
      { id: 'window-b', name: '右窗', role: 'window', parent: 'keep', primitive: 'box', dimensions: { width: 0.6, height: 1, depth: 0.1 }, transform: { position: [1.4, 1.2, 2.55], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'glass' },
      { id: 'flag-pole', name: '旗杆', role: 'decoration', parent: 'keep', primitive: 'cylinder', dimensions: { width: 0.08, height: 1.8, depth: 0.08 }, transform: { position: [0, 5.8, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'dark' },
      { id: 'west-battlement', name: '西侧城垛', role: 'battlement', parent: 'keep', primitive: 'box', dimensions: { width: 2, height: 0.5, depth: 0.5 }, transform: { position: [-2.4, 5.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'stone' },
      { id: 'east-battlement', name: '东侧城垛', role: 'battlement', parent: 'keep', primitive: 'box', dimensions: { width: 2, height: 0.5, depth: 0.5 }, transform: { position: [2.4, 5.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: 'stone' },
    ];
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: '2.0', targetName: 'anime-painted-castle',
        materials: {
          stone: { color: '#ead9ad', roughness: 0.9 },
          roof: { color: '#b84b3d', roughness: 0.78 },
          dark: { color: '#493b37', roughness: 0.8 },
          glass: { color: '#79b8c4', roughness: 0.25, metalness: 0.08 },
        },
        componentTree, confidence: 0.86, evidence: ['双侧塔楼', '红色尖顶'], limitations: ['背面结构不可见'],
      }) } }] }),
    });
    global.fetch = fetchMock as never;
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    const result = await service.reconstructObjectReference('building', '城堡', 'anime-painted', imageDataUrl, approval.approvalToken, '保留双塔和红色尖顶');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const systemPrompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(systemPrompt).toContain('城堡');
    expect(systemPrompt).toContain('必须只有一个根节点');
    expect(systemPrompt).toContain('相对直接 parent 的局部坐标');
    expect(result.design.objectSculptSpec.componentTree).toHaveLength(12);
    expect(result.design.objectSculptSpec.componentTree.filter((node: any) => !node.parent)).toHaveLength(1);
    expect(result.design.objectSculptSpec.componentTree.find((node: any) => node.id === 'west-roof').parent).toBe('west-tower');
    expect(result.design.objectSculptSpec.materials.roof.color).toBe('#b84b3d');
    expect(result.design.reviewed).toBe(false);
    expect(service.consumeDesignToken(result.designToken, result.design)).toBe(true);
  });

  it('validates and preserves bounded polygon outline coordinates', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'sculpt-secret', VISION_MODEL: 'vision-test',
      } as Record<string, string>)[key],
    } as never);
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    const polygonNode = {
      id: 'gable-outline', primitive: 'polygon',
      dimensions: { width: 4, height: 3, depth: 0.6 },
      geometryDescriptor: { points: [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]] },
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        componentTree: [polygonNode], materials: { stone: { color: '#aaaaaa' } },
      }) } }] }),
    }) as never;
    const result = await service.reconstructObjectReference('facility', '三角景观构件', 'anime-painted', imageDataUrl, approval.approvalToken);
    expect(result.design.objectSculptSpec.componentTree[0].geometryDescriptor.points).toEqual(polygonNode.geometryDescriptor.points);

    const invalid = structuredClone(polygonNode);
    invalid.geometryDescriptor.points[0][0] = 2;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        componentTree: [invalid], materials: { stone: { color: '#aaaaaa' } },
      }) } }] }),
    }) as never;
    await expect(service.reconstructObjectReference('facility', '三角景观构件', 'anime-painted', imageDataUrl, approval.approvalToken))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects malformed ObjectSculptSpec parent references and cycles', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'sculpt-secret', VISION_MODEL: 'vision-test',
      } as Record<string, string>)[key],
    } as never);
    const invalidTrees = [
      [{ id: 'root', primitive: 'box', dimensions: {}, transform: {}, material: 'default', parent: 'missing' }],
      [
        { id: 'a', primitive: 'box', dimensions: {}, transform: {}, material: 'default', parent: 'b' },
        { id: 'b', primitive: 'box', dimensions: {}, transform: {}, material: 'default', parent: 'a' },
      ],
      [
        { id: 'root-a', primitive: 'box', dimensions: {}, transform: {}, material: 'default' },
        { id: 'root-b', primitive: 'box', dimensions: {}, transform: {}, material: 'default' },
      ],
    ];
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    for (const componentTree of invalidTrees) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ componentTree, materials: { default: { color: '#aaaaaa' } } }) } }] }),
      }) as never;
      await expect(service.reconstructObjectReference('facility', '长椅', 'anime-painted', imageDataUrl, approval.approvalToken))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
    }
  });


  it('revalidates edited ObjectSculptSpec and issues a new credential bound to the reviewed tree', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({
        VISION_API_KEY: 'sculpt-review-secret', VISION_MODEL: 'vision-test',
        VISION_API_BASE_URL: 'http://vision.local/v1',
      } as Record<string, string>)[key],
    } as never);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        targetName: 'test-building',
        materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0, opacity: 1 } },
        componentTree: Array.from({ length: 6 }, (_, index) => ({
          id: 'part-' + index, name: '主体部件 ' + index, role: index === 0 ? 'main-massing' : 'attached-part', primitive: 'box',
          ...(index > 0 ? { parent: 'part-0' } : {}),
          dimensions: { width: 8, height: 6, depth: 7 },
          transform: { position: [index === 0 ? 0 : (index - 1) * 0.2, index === 0 ? 3 : 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          material: 'wall',
        })),
      }) } }] }),
    }) as never;
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    const identified = await service.reconstructObjectReference('building', '教学楼', 'stylized', imageDataUrl, approval.approvalToken);
    const edited = structuredClone(identified.design.objectSculptSpec);
    edited.componentTree[0].dimensions.width = 9.5;
    edited.materials.wall.color = '#aa8866';

    const reviewed = service.reviewObjectDesign(identified.design, identified.designToken, edited);
    expect(reviewed.design.reviewed).toBe(true);
    expect(reviewed.design.objectSculptSpec.componentTree[0].dimensions.width).toBe(9.5);
    expect(reviewed.design.objectSculptSpec.materials.wall.color).toBe('#aa8866');
    edited.componentTree[0].hidden = true;
    edited.componentTree[1].locked = true;
    const flagsReviewed = service.reviewObjectDesign(identified.design, identified.designToken, edited);
    expect(flagsReviewed.design.objectSculptSpec.componentTree[0]).toMatchObject({ hidden: true, locked: false });
    expect(flagsReviewed.design.objectSculptSpec.componentTree[1]).toMatchObject({ hidden: false, locked: true });
    expect(service.consumeDesignToken(reviewed.designToken, reviewed.design)).toBe(true);
    expect(service.consumeDesignToken(identified.designToken, reviewed.design)).toBe(false);
    expect(service.consumeDesignToken(reviewed.designToken, identified.design)).toBe(false);

    const invalidDimension = structuredClone(edited);
    invalidDimension.componentTree[0].dimensions.width = 1000;
    expect(() => service.reviewObjectDesign(identified.design, identified.designToken, invalidDimension)).toThrow('超出允许范围');

    const invalidHierarchy = structuredClone(edited);
    invalidHierarchy.componentTree[0].parent = 'missing';
    expect(() => service.reviewObjectDesign(identified.design, identified.designToken, invalidHierarchy)).toThrow('父节点不存在');

    const invalidMaterial = structuredClone(edited);
    invalidMaterial.materials.wall.opacity = 0;
    expect(() => service.reviewObjectDesign(identified.design, identified.designToken, invalidMaterial)).toThrow('opacity');

    const invalidToken = structuredClone(identified.design);
    invalidToken.objectType = '被篡改';
    expect(() => service.reviewObjectDesign(invalidToken, identified.designToken, edited)).toThrow('凭证无效');
  });


  it('lets AI infer an open-ended object category and declare asset-specific linked parameters', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({ VISION_API_KEY: 'open-secret', VISION_MODEL: 'vision-test', VISION_API_BASE_URL: 'http://vision.local/v1' } as Record<string, string>)[key],
    } as never);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        category: 'interior', objectType: 'classroom', targetName: 'storybook-classroom',
        materials: { wall: { color: '#e7d2a5', roughness: 0.8, metalness: 0, opacity: 1 } },
        componentTree: [{ id: 'room', primitive: 'box', material: 'wall', dimensions: { width: 8, height: 4, depth: 7 }, transform: { position: [0,2,0] } }],
        parameterSchema: [{ id: 'room-height', label: '教室高度', type: 'number', value: 4, min: 3, max: 8, step: 0.1, unit: 'm', targets: [{ nodeId: 'room', property: 'dimensions.height', mode: 'set' }] }],
      }) } }] }),
    }) as never;
    const imageDataUrl = 'data:image/png;base64,' + png.toString('base64');
    const approval = service.approveReference(imageDataUrl);
    const result = await service.reconstructObjectReference('auto', '', 'storybook', imageDataUrl, approval.approvalToken);
    expect(result.design.objectSculptSpec).toMatchObject({
      category: 'interior', objectType: 'classroom',
      parameterSchema: [{ id: 'room-height', value: 4, targets: [{ nodeId: 'room', property: 'dimensions.height', mode: 'set' }] }],
    });
    const systemPrompt = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).messages[0].content;
    expect(systemPrompt).toContain('不要依赖固定物体类别清单');
  });

  it('applies AI local edits only to the selected component subtree', async () => {
    const service = new BuildingDesignService({
      get: (key: string) => ({ VISION_API_KEY: 'local-edit-secret', VISION_MODEL: 'vision-test', VISION_API_BASE_URL: 'http://vision.local/v1' } as Record<string, string>)[key],
    } as never);
    const current = {
      schemaVersion: '2.0', targetName: 'building', category: 'building', objectType: 'building', visualStyle: 'stylized',
      materials: { wall: { color: '#cccccc', roughness: 0.8, metalness: 0, opacity: 1 }, glass: { color: '#77aabb', roughness: 0.2, metalness: 0, opacity: 1 } },
      componentTree: [
        { id: 'body', name: '主体', primitive: 'box', material: 'wall', dimensions: { width: 8, height: 8, depth: 6 }, transform: { position: [0,4,0], rotation: [0,0,0], scale: [1,1,1] } },
        { id: 'window', name: '窗户', parent: 'body', primitive: 'box', material: 'glass', dimensions: { width: 1, height: 1.5, depth: 0.1 }, transform: { position: [0,1,3], rotation: [0,0,0], scale: [1,1,1] } },
      ],
      parameterSchema: [],
    };
    const updated: any = structuredClone(current);
    updated.componentTree[1].primitive = 'arch';
    updated.componentTree[1].geometryDescriptor = { inset: 0.12 };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ objectSculptSpec: updated }) } }] }),
    }) as never;
    const result = await service.modifyObjectDesign(current, ['window'], '把选中的窗户改成拱形');
    expect(result.objectSculptSpec.componentTree.find((node: any) => node.id === 'window')?.primitive).toBe('arch');
    expect(result.objectSculptSpec.componentTree.find((node: any) => node.id === 'body')).toMatchObject(current.componentTree[0]);
    const illegal = structuredClone(updated);
    illegal.componentTree[0].dimensions.width = 10;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ objectSculptSpec: illegal }) } }] }),
    }) as never;
    await expect(service.modifyObjectDesign(current, ['window'], '改变窗户')).rejects.toThrow('修改了未选中的组件');
  });

});
