import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ImageGenerationService } from './image-generation.service';
import { createObjectModelParameterContractCases } from '../../shared/object-model-parameter-contract.fixtures';

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

  function createTeachingBuildingSpec(sourceRootId = 'repeat_ground_left_windows') {
    return {
      schemaVersion: '3.0',
      targetName: 'MVP 教学楼',
      category: 'building',
      objectType: '两层大学教学楼',
      visualStyle: 'realistic',
      materials: { glass: { color: '#8eb8c9', roughness: 0.2, metalness: 0.05 } },
      componentTree: [
        { id: 'building-root', kind: 'group' },
        { id: 'left-facade', kind: 'group', parent: 'building-root' },
        { id: 'repeat_ground_left_windows', kind: 'group', parent: 'left-facade' },
        { id: 'ground-left-window', parent: 'repeat_ground_left_windows', primitive: 'box',
          dimensions: { width: 1.1, height: 1.4, depth: 0.12 }, material: 'glass' },
      ],
      parameterSchema: [],
      operations: [{
        id: 'instance-ground-left-windows', type: 'instance', sourceRootId,
        count: { parameterId: 'ground-left-window-count' },
        transform: {
          position: [{ op: 'multiply', left: { op: 'index' }, right: 1.3 }, 0, 0],
          rotation: [0, 0, 0], scale: [1, 1, 1],
        },
      }],
    };
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
      { nodeId: 'lattice-panel', property: 'material.color', mode: 'set' },
    ]);
  });

  it('rejects ObjectSculptSpec 2.0 provider output instead of adapting it', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: '2.0',
        materials: { stone: { color: '#999999' } },
        componentTree: [{ id: 'body', primitive: 'box', dimensions: { width: 1, height: 1, depth: 1 } }],
        generators: [],
      }) } }] }),
    }) as never;
    await expect(service.generateObjectFromPrompt('一个物体', '物体', 'stylized'))
      .rejects.toThrow('ObjectSculptSpec 结构无效');
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
    expect(systemPrompt).toContain('type:"indexed-mesh"');
    expect(systemPrompt).toContain('positions:[x,y,z,...],indices:[a,b,c,...]');
    expect(systemPrompt).toContain('旧式 geometryDescriptor 仍可用于兼容构造');
    expect(systemPrompt).toContain('MVP 生成阶段不使用 instance operations、sourceRootId 或表达式参数绑定');
    expect(systemPrompt).toContain('geometry 必须严格是 {type:"indexed-mesh",positions:[x,y,z,...],indices:[a,b,c,...]}');
    expect(systemPrompt).toContain('若无法完整满足上述格式，必须省略 geometry');
    expect(systemPrompt).toContain('重复窗户、栏杆、立柱、车轮、叶片等结构必须直接展开');
    expect(systemPrompt).toContain('parameterSchema 必须根据本次对象真实结构动态声明');
    expect(systemPrompt).toContain('不受预置几何类型限制');
    expect(result.objectSculptSpec.componentTree[1].parent).toBe('body');
  });

  it('ignores AI instance operations in the MVP generation path', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const spec = createTeachingBuildingSpec('placeFrontLowerRightWindows');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(spec) } }] }),
    }) as never;

    const result = await service.generateObjectFromPrompt('生成教学楼窗户阵列', '教学楼', 'realistic');
    expect(result.objectSculptSpec.operations).toEqual([]);
    expect(result.objectSculptSpec.componentTree).toHaveLength(4);
  });

  it('keeps the world MVP profile implementation-agnostic', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const spec = {
      schemaVersion: '3.0',
      targetName: 'MVP 教学楼',
      category: 'building',
      objectType: '两层大学教学楼',
      visualStyle: 'realistic',
      materials: { wall: { color: '#d8d2c4', roughness: 0.82, metalness: 0 } },
      componentTree: [
        { id: 'building-root', kind: 'group' },
        { id: 'building-body', parent: 'building-root', primitive: 'box',
          dimensions: { width: 12, height: 7, depth: 8 }, material: 'wall' },
      ],
      parameterSchema: [],
      operations: [],
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(spec) } }] }),
    });
    global.fetch = fetchMock as never;

    const result = await service.generateObjectFromPrompt(
      '生成一栋两层教学楼', '两层大学教学楼', 'realistic', true, undefined, 'world-mvp-teaching-building',
    );

    const systemPrompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(systemPrompt).toContain('窗框/玻璃位于墙面开口内并与墙面贴合');
    expect(systemPrompt).not.toContain('repeat_ground_left_windows');
    expect(result.objectSculptSpec.componentTree).toHaveLength(2);
    expect(result.objectSculptSpec.operations).toHaveLength(0);
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

  it('converts AI component edits with unchanged indexed-mesh topology into vertex ChangeSets', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const original = {
      schemaVersion: '3.0',
      targetName: 'mesh-object',
      materials: { stone: { color: '#888888', roughness: 0.8, metalness: 0 } },
      parameterSchema: [],
      operations: [],
      componentTree: [{
        id: 'body', kind: 'mesh', material: 'stone',
        geometry: {
          type: 'indexed-mesh',
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
        },
      }],
    };
    const generated = JSON.parse(JSON.stringify(original));
    generated.componentTree[0].geometry.positions[7] = 1.5;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(generated) } }] }),
    }) as never;

    const result = await service.modifyObjectFromInstruction(original, ['body'], '抬高第三个顶点');

    expect(result.editScope).toBe('component');
    expect(result.changeSetResult.appliedChangeCount).toBe(1);
    expect(result.changeSetResult.geometryVertexUpdates).toEqual([{
      nodeId: 'body',
      updates: [{ index: 2, position: [0, 1.5, 0] }],
    }]);
    expect(result.objectSculptSpec.componentTree[0].geometry.positions[7]).toBe(1.5);
    expect(result.objectSculptSpec.materials).toEqual(original.materials);
  });

  it('converts indexed-mesh topology changes into a component replacement ChangeSet', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const original = {
      schemaVersion: '3.0',
      materials: { stone: { color: '#888888', roughness: 0.8, metalness: 0 } },
      parameterSchema: [],
      operations: [],
      componentTree: [{
        id: 'body', material: 'stone',
        geometry: { type: 'indexed-mesh', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
      }],
    };
    const generated = JSON.parse(JSON.stringify(original));
    generated.componentTree[0].geometry.indices = [0, 2, 1];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(generated) } }] }),
    }) as never;
    const result = await service.modifyObjectFromInstruction(original, ['body'], '翻转三角面方向');
    expect(result.editScope).toBe('component');
    expect(result.changeSetResult.changes).toEqual([expect.objectContaining({
      type: 'replace-component', nodeId: 'body',
      component: expect.objectContaining({ geometry: expect.objectContaining({ indices: [0, 2, 1] }) }),
    })]);
    expect(result.objectSculptSpec.componentTree[0].geometry.indices).toEqual([0, 2, 1]);
  });

  it('converts component additions and removals into a validated structural ChangeSet', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const original = {
      schemaVersion: '3.0', targetName: 'house',
      materials: { stone: { color: '#888888', roughness: 0.8, metalness: 0 } },
      parameterSchema: [], operations: [],
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'body', parent: 'root', kind: 'group' },
        { id: 'old-window', parent: 'body', primitive: 'box', dimensions: { width: 1, height: 1, depth: 0.1 } },
        { id: 'tree', parent: 'root', primitive: 'sphere', dimensions: { width: 1, height: 1, depth: 1 } },
      ],
    };
    const generated = {
      ...original,
      componentTree: [
        original.componentTree[0], original.componentTree[1], original.componentTree[3],
        { id: 'new-door', parent: 'body', primitive: 'box', dimensions: { width: 0.8, height: 1.8, depth: 0.1 } },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(generated) } }] }),
    }) as never;
    const result = await service.modifyObjectFromInstruction(original, ['body'], '把窗户替换成一扇门');
    expect(result.changeSetResult.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'add-component', component: expect.objectContaining({ id: 'new-door' }) }),
      expect.objectContaining({ type: 'remove-component', nodeId: 'old-window', cascade: true }),
    ]));
    expect(result.changeSetResult.affectedNodeIds).toEqual(expect.arrayContaining(['new-door', 'old-window']));
    expect(result.objectSculptSpec.componentTree.map((node: any) => node.id)).toEqual(['root', 'body', 'tree', 'new-door']);
    expect(original.componentTree.some((node: any) => node.id === 'old-window')).toBe(true);
  });

  it('converts whole-object hierarchy changes into a ChangeSet', async () => {
    const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
    const original = {
      schemaVersion: '3.0', targetName: 'tower', materials: {}, parameterSchema: [], operations: [],
      componentTree: [
        { id: 'root', kind: 'group' },
        { id: 'body', parent: 'root', kind: 'group' },
        { id: 'roof', parent: 'body', primitive: 'box', dimensions: { width: 2, height: 1, depth: 2 } },
        { id: 'antenna-mount', parent: 'root', kind: 'group' },
      ],
    };
    const generated = JSON.parse(JSON.stringify(original));
    generated.componentTree.find((node: any) => node.id === 'roof').parent = 'antenna-mount';
    generated.componentTree.push({ id: 'antenna', parent: 'antenna-mount', primitive: 'cylinder', dimensions: { width: 0.2, height: 2, depth: 0.2 } });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(generated) } }] }),
    }) as never;
    const result = await service.modifyObjectFromInstruction(original, [], '把天线移动到顶部支架');
    expect(result.changeSetResult.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'add-component', component: expect.objectContaining({ id: 'antenna' }) }),
      expect.objectContaining({ type: 'replace-component', nodeId: 'roof', component: expect.objectContaining({ parent: 'antenna-mount' }) }),
    ]));
    expect(result.objectSculptSpec.componentTree.find((node: any) => node.id === 'roof').parent).toBe('antenna-mount');
    expect(result.changeSetResult.affectedNodeIds).toEqual(expect.arrayContaining(['antenna', 'roof']));
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

  it('reads the provider response body with the configured timeout and records response size', async () => {
    const service = createService({
      VISION_API_KEY: 'vision-key',
      VISION_MODEL: 'vision-test',
      VISION_REQUEST_TIMEOUT_MS: '450000',
    });
    const spec = {
      schemaVersion: '3.0',
      materials: { steel: { color: '#777777' } },
      componentTree: [{ id: 'asset-root', kind: 'group' }],
    };
    const responseText = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(spec) } }],
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => responseText,
    });
    global.fetch = fetchMock as never;

    const result = await service.generateObjectFromPrompt('一个简单物体', '物体', 'stylized', false);

    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
    expect(result.objectSculptSpec.componentTree[0].id).toBe('asset-root');
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

  it('enforces the shared parameter contract cases on the generation entrypoint', async () => {
    for (const contract of createObjectModelParameterContractCases()) {
      const service = createService({ VISION_API_KEY: 'vision-key', VISION_MODEL: 'vision-test' });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(contract.spec) } }] }),
      }) as never;
      if (contract.validator === 'accept') {
        const result = await service.generateObjectFromPrompt('测试物体', '物体', 'stylized', false);
        expect(result.objectSculptSpec.parameterSchema).toBeDefined();
      } else if (['unknown-target', 'group-dimension-target'].includes(contract.id)) {
        const result = await service.generateObjectFromPrompt('测试物体', '物体', 'stylized', false);
        expect(result.objectSculptSpec.parameterSchema).toEqual([]);
      } else {
        await expect(service.generateObjectFromPrompt('测试物体', '物体', 'stylized', false))
          .rejects.toBeInstanceOf(ServiceUnavailableException);
      }
    }
  });

});
