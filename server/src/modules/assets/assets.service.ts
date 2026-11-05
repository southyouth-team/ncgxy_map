import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export interface UploadedAsset {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const IMAGE_TYPES: Record<string, { mime: string; extension: string; signature: (buffer: Buffer) => boolean }> = {
  png: { mime: 'image/png', extension: '.png', signature: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  jpeg: { mime: 'image/jpeg', extension: '.jpg', signature: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', extension: '.webp', signature: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
};

@Injectable()
export class AssetsService {
  private readonly storageDir: string;
  private readonly visualManifestPath: string;

  constructor(private readonly dataSource: DataSource, config: ConfigService) {
    this.storageDir = resolve(config.get<string>('ASSET_STORAGE_DIR', './uploads'));
    this.visualManifestPath = resolve(this.storageDir, 'campus-visual-assets', 'manifest.json');
  }

  async findAll(userId: string, campusId: string, mapId: string) {
    await this.requireRole(userId, campusId, ['owner', 'admin', 'editor', 'viewer']);
    await this.requireMap(campusId, mapId);
    const rows = await this.dataSource.query(
      `SELECT id,original_name,mime_type,file_size,checksum_sha256,created_at
       FROM campus_asset WHERE campus_id=$1 AND map_id=$2 AND asset_type='base-map'
       ORDER BY created_at DESC,id DESC`,
      [campusId, mapId],
    );
    return rows.map((row: Record<string, unknown>) => ({
      ...row,
      contentPath: `/api/v1/campuses/${campusId}/maps/${mapId}/assets/${row.id}/content`,
    }));
  }

  async uploadBaseMap(userId: string, campusId: string, mapId: string, file: UploadedAsset) {
    await this.requireRole(userId, campusId, ['owner', 'admin', 'editor']);
    await this.requireMap(campusId, mapId);
    if (!file.buffer || file.size < 1 || file.size > 15 * 1024 * 1024) {
      throw new BadRequestException('底图文件不能为空且不能超过 15 MB');
    }
    const detected = Object.values(IMAGE_TYPES).find((type) => type.signature(file.buffer));
    if (!detected || file.mimetype !== detected.mime) {
      throw new BadRequestException('仅支持真实格式匹配的 PNG、JPG、WebP 图片');
    }

    const assetId = randomUUID();
    const objectKey = `${campusId}/${mapId}/${assetId}${detected.extension}`;
    const absolutePath = resolve(this.storageDir, objectKey);
    await mkdir(resolve(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: 'wx' });
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    try {
      const rows = await this.dataSource.query(
        `INSERT INTO campus_asset
          (campus_id,map_id,asset_type,storage_provider,object_key,original_name,mime_type,file_size,checksum_sha256,metadata,uploaded_by)
         VALUES ($1,$2,'base-map','local-filesystem',$3,$4,$5,$6,$7,$8::jsonb,$9)
         RETURNING id,campus_id,map_id,asset_type,storage_provider,object_key,original_name,mime_type,file_size,checksum_sha256,metadata,created_at`,
        [campusId, mapId, objectKey, basename(file.originalname).slice(0, 255), detected.mime, file.size, checksum,
          JSON.stringify({ source: 'uploaded-base-map' }), userId],
      );
      return { ...rows[0], contentPath: `/api/v1/campuses/${campusId}/maps/${mapId}/assets/${rows[0].id}/content` };
    } catch (error) {
      await rm(absolutePath, { force: true });
      throw error;
    }
  }

  async getBaseMap(userId: string, campusId: string, mapId: string, assetId: string) {
    await this.requireRole(userId, campusId, ['owner', 'admin', 'editor', 'viewer']);
    await this.requireMap(campusId, mapId);
    const rows = await this.dataSource.query(
      `SELECT id,object_key,mime_type,file_size FROM campus_asset
       WHERE id=$1 AND campus_id=$2 AND map_id=$3 AND asset_type='base-map' AND storage_provider='local-filesystem'`,
      [assetId, campusId, mapId],
    );
    if (!rows.length) throw new NotFoundException('底图资源不存在');
    const absolutePath = resolve(this.storageDir, rows[0].object_key);
    // 使用 relative 判断路径是否仍位于存储根目录内，兼容 Windows（\\）和 POSIX（/）。
    const relativePath = relative(this.storageDir, absolutePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new NotFoundException('底图资源路径无效');
    }
    try { await readFile(absolutePath, { flag: 'r' }).then(() => undefined); }
    catch { throw new NotFoundException('底图文件不存在，请检查存储卷'); }
    return { ...rows[0], absolute_path: absolutePath };
  }


    private visualManifestQueue: Promise<unknown> = Promise.resolve();

  async uploadVisualAsset(userId: string, file: UploadedAsset, metadata: Record<string, unknown>) {
    if (!userId) throw new BadRequestException('缺少上传用户身份');
    if (!file?.buffer || file.size < 1 || file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('素材文件不能为空且不能超过 20 MB');
    }
    const featureId = typeof metadata.featureId === 'string' ? metadata.featureId.trim() : '';
    const viewMode = metadata.viewMode;
    const sourceType = metadata.sourceType;
    const name = typeof metadata.name === 'string' ? metadata.name.trim().slice(0, 160) : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(featureId)) throw new BadRequestException('空间 Feature ID 格式无效');
    if (!['2.5d', '3d'].includes(String(viewMode))) throw new BadRequestException('素材视角必须是 2.5d 或 3d');
    if (!['ai_generated', 'manual_model', 'procedural', 'external'].includes(String(sourceType))) {
      throw new BadRequestException('素材来源类型无效');
    }
    if (!name) throw new BadRequestException('素材名称不能为空');

    const signatures = [
      { ext: '.png', mime: 'image/png', valid: (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
      { ext: '.jpg', mime: 'image/jpeg', valid: (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
      { ext: '.webp', mime: 'image/webp', valid: (b: Buffer) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
      { ext: '.glb', mime: 'model/gltf-binary', valid: (b: Buffer) => b.length >= 20 && b.toString('ascii', 0, 4) === 'glTF' && b.readUInt32LE(4) === 2 },
    ];
    const detected = signatures.find(item => item.valid(file.buffer));
    if (!detected || (viewMode === '2.5d' && detected.ext === '.glb') || (viewMode === '3d' && detected.ext !== '.glb')) {
      throw new BadRequestException('文件真实格式与所选视角不匹配；2.5D 仅支持 PNG/JPG/WebP，3D 仅支持 GLB');
    }

    const fileId = randomUUID();
    const objectKey = resolve(this.storageDir, 'campus-visual-assets', 'files', fileId + detected.ext);
    const root = resolve(this.storageDir, 'campus-visual-assets');
    const relativePath = relative(root, objectKey);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new BadRequestException('素材存储路径无效');
    }
    await mkdir(resolve(objectKey, '..'), { recursive: true });
    await writeFile(objectKey, file.buffer, { flag: 'wx' });
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const url = '/api/v1/assets/visual-assets/' + fileId + '/content';
    let buildingDesign: Record<string, unknown> | null = null;
    if (viewMode === '2.5d' && typeof metadata.buildingDesign === 'string' && metadata.buildingDesign.trim()) {
      let candidate: any;
      try { candidate = JSON.parse(metadata.buildingDesign); } catch { throw new BadRequestException('建筑结构参数 JSON 无效'); }
      const roofs = ['flat', 'pitched', 'span', 'glass'];
      const templates = ['街区楼 A', '街区楼 B', '庭院楼', '坡顶楼', '教学楼', '宿舍楼', '办公楼', '实验楼', '图书馆', '体育馆'];
      const walls = ['wallCream', 'wallPeach', 'wallMint', 'wall'];
      const read = (key: string, min: number, max: number) => {
        const value = Number(candidate?.[key]);
        if (!Number.isFinite(value)) throw new BadRequestException('建筑结构参数缺少有效字段：' + key);
        return Math.min(max, Math.max(min, value));
      };
      const floors = Math.round(read('floors', 1, 30));
      buildingDesign = {
        schemaVersion: 1,
        source: 'ai-vision-estimate',
        template: templates.includes(candidate?.template) ? candidate.template : '教学楼',
        floors,
        height: read('height', 1, 80),
        heightBasis: 'estimated-scene-units-not-surveyed',
        roofStyle: roofs.includes(candidate?.roofStyle) ? candidate.roofStyle : 'flat',
        roofRise: read('roofRise', 0, 3),
        windowDensity: read('windowDensity', 0.1, 3),
        windowWidth: read('windowWidth', 0.28, 2),
        windowHeight: read('windowHeight', 0.2, 2),
        doorWidth: read('doorWidth', 0.5, 3),
        wallPalette: walls.includes(candidate?.wallPalette) ? candidate.wallPalette : 'wallCream',
        confidence: read('confidence', 0, 1),
        evidence: Array.isArray(candidate?.evidence) ? candidate.evidence.filter((item: unknown) => typeof item === 'string').slice(0, 6).map((item: string) => item.slice(0, 180)) : [],
        limitations: Array.isArray(candidate?.limitations) ? candidate.limitations.filter((item: unknown) => typeof item === 'string').slice(0, 6).map((item: string) => item.slice(0, 180)) : [],
        reviewed: false,
      };
    }

    const manifest = await this.enqueueVisualManifestUpdate(async () => {
      const current = await this.readVisualManifest();
      const assetId = 'campus-' + featureId;
      let asset = current.assets.find((item: any) => item.assetId === assetId);
      if (!asset) {
        asset = {
          assetId,
          name,
          category: 'building',
          sourceType,
          status: 'ready',
          files: [],
          provenance: {
            provider: sourceType === 'ai_generated' ? String(metadata.generationModel || 'AI image generation') : sourceType,
            prompt: typeof metadata.prompt === 'string' ? metadata.prompt.slice(0, 12000) : '',
            createdAt: new Date().toISOString(),
            notes: '经素材工坊人工审核通过后由服务端自动入库',
          },
        };
        current.assets.push(asset);
      }
      if (buildingDesign) asset.buildingDesign = buildingDesign;
      asset.name = name;
      asset.sourceType = sourceType;
      asset.status = 'ready';
      asset.provenance = {
        ...(asset.provenance || {}),
        provider: sourceType === 'ai_generated' ? String(metadata.generationModel || 'AI image generation') : sourceType,
        prompt: typeof metadata.prompt === 'string' ? metadata.prompt.slice(0, 12000) : '',
        createdAt: new Date().toISOString(),
        notes: '经素材工坊人工审核通过后由服务端自动入库',
      };
      asset.files = (asset.files || []).filter((item: any) => item.viewMode !== viewMode || item.role !== 'primary');
      asset.files.push({
        viewMode,
        role: 'primary',
        mediaType: detected.ext === '.glb' ? 'glb' : 'image',
        format: detected.ext.slice(1),
        url,
        fileId,
        checksumSha256: checksum,
        sizeBytes: file.size,
      });
      const binding = current.bindings.find((item: any) => item.featureId === featureId);
      if (binding) binding.assetId = assetId;
      else current.bindings.push({ featureId, assetId });
      await this.writeVisualManifest(current);
      return current;
    });
    return { fileId, assetId: 'campus-' + featureId, url, checksumSha256: checksum, sizeBytes: file.size, manifest };
  }

  async saveObjectSculptAsset(userId: string, input: Record<string, unknown>) {
    if (!userId) throw new BadRequestException('缺少资产保存用户身份');
    const spec = input?.objectSculptSpec as Record<string, any> | undefined;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || spec.schemaVersion !== '2.0'
      || !Array.isArray(spec.componentTree) || spec.componentTree.length < 1 || spec.componentTree.length > 300
      || !spec.materials || typeof spec.materials !== 'object' || Array.isArray(spec.materials)) {
      throw new BadRequestException('ObjectSculptSpec 结构无效，无法保存');
    }
    const serialized = JSON.stringify(spec);
    if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) throw new BadRequestException('结构化资产数据不能超过 2 MB');
    const ids = new Set<string>();
    for (const node of spec.componentTree) {
      if (!node || typeof node.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(node.id) || ids.has(node.id)) throw new BadRequestException('资产组件 ID 无效或重复');
      ids.add(node.id);
    }
    const primitives = new Set(['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus']);
    const byId = new Map<string, any>(spec.componentTree.map((node: any) => [node.id, node] as [string, any]));
    for (const node of spec.componentTree) {
      if (node.parent && !ids.has(node.parent)) throw new BadRequestException('资产组件父节点不存在：' + node.id);
      const kind = node.kind || 'mesh';
      if (!['group', 'mesh'].includes(kind)) throw new BadRequestException('资产组件 kind 无效：' + node.id);
      if (kind === 'mesh') {
        if (!primitives.has(String(node.primitive || '').toLowerCase())) throw new BadRequestException('资产组件几何类型无效：' + node.id);
        if (!node.dimensions || ['width','height','depth'].some(key => !Number.isFinite(Number(node.dimensions[key])) || Number(node.dimensions[key]) < 0.02 || Number(node.dimensions[key]) > 100)) throw new BadRequestException('资产组件尺寸无效：' + node.id);
        if (typeof node.material !== 'string' || !Object.prototype.hasOwnProperty.call(spec.materials, node.material)) throw new BadRequestException('资产组件材质引用无效：' + node.id);
      }
      const visited = new Set([node.id]);
      let parent = node.parent;
      let depth = 1;
      while (parent) {
        if (visited.has(parent)) throw new BadRequestException('资产组件层级存在循环引用：' + node.id);
        visited.add(parent);
        if (++depth > 16) throw new BadRequestException('资产组件层级超过 16 层');
        parent = byId.get(parent)?.parent;
      }
    }
    if (spec.componentTree.filter((node: any) => !node.parent).length !== 1) throw new BadRequestException('结构化资产必须只有一个主体根节点');
    if (spec.parameterSchema !== undefined && (!Array.isArray(spec.parameterSchema) || spec.parameterSchema.length > 100)) throw new BadRequestException('资产参数 Schema 无效');
    const generators = spec.generators === undefined ? [] : spec.generators;
    if (!Array.isArray(generators) || generators.length > 30) throw new BadRequestException('资产结构生成器数量无效');
    const generatorIds = new Set<string>();
    const claimedTemplateNodeIds = new Set<string>();
    let estimatedExpandedCount = spec.componentTree.length;
    for (const generator of generators) {
      if (!generator || typeof generator !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(generator.id || '')
        || generatorIds.has(generator.id) || !['repeat','grid'].includes(generator.type) || !byId.has(generator.templateRootId)) {
        throw new BadRequestException('资产结构生成器定义无效');
      }
      generatorIds.add(generator.id);
      const subtree = spec.componentTree.filter((node: any) => {
        let current = node.id;
        while (current) {
          if (current === generator.templateRootId) return true;
          current = byId.get(current)?.parent;
        }
        return false;
      });
      if (!subtree.length) throw new BadRequestException('资产结构生成器模板子树为空：' + generator.id);
      for (const node of subtree) {
        if (claimedTemplateNodeIds.has(node.id)) throw new BadRequestException('暂不支持嵌套或重叠的资产结构生成器：' + generator.id);
        claimedTemplateNodeIds.add(node.id);
      }
      let maximumInstances = 0;
      if (generator.type === 'repeat') {
        if (!['x','y','z'].includes(generator.axis) || !Number.isFinite(generator.spacing) || Math.abs(generator.spacing) > 100
          || !Number.isInteger(generator.maxCount) || generator.maxCount < 1 || generator.maxCount > 100
          || !Number.isInteger(generator.defaultCount) || generator.defaultCount < 1 || generator.defaultCount > generator.maxCount
          || (generator.followers !== undefined && (!Array.isArray(generator.followers) || generator.followers.length > 30))) {
          throw new BadRequestException('资产 repeat 生成器定义无效：' + generator.id);
        }
        for (const follower of generator.followers || []) {
          if (!byId.has(follower?.nodeId) || !['x','y','z'].includes(follower.axis) || !Number.isFinite(Number(follower.offset ?? 0))
            || subtree.some((node: any) => node.id === follower.nodeId)) throw new BadRequestException('资产结构生成器跟随规则无效：' + generator.id);
        }
        const parameter = (spec.parameterSchema || []).find((item: any) => item.id === generator.countParameterId);
        if (!parameter || parameter.type !== 'number' || !Number.isInteger(parameter.min) || !Number.isInteger(parameter.max)
          || parameter.min < 1 || parameter.max > generator.maxCount || generator.defaultCount < parameter.min || generator.defaultCount > parameter.max) {
          throw new BadRequestException('资产结构生成器缺少有效的整数数量参数：' + generator.id);
        }
        maximumInstances = generator.maxCount;
      } else {
        if (![generator.spacingX,generator.spacingZ].every((value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100)
          || !Number.isInteger(generator.maxRows) || !Number.isInteger(generator.maxColumns)
          || !Number.isInteger(generator.defaultRows) || !Number.isInteger(generator.defaultColumns)
          || generator.defaultRows < 1 || generator.defaultColumns < 1 || generator.maxRows < generator.defaultRows
          || generator.maxColumns < generator.defaultColumns || generator.maxRows > 100 || generator.maxColumns > 100) {
          throw new BadRequestException('资产 grid 生成器行列或间距无效：' + generator.id);
        }
        if (generator.rowParameterId === generator.columnParameterId) throw new BadRequestException('资产 grid 生成器行列参数不能相同：' + generator.id);
        const gridParameters: Array<[string, number, number]> = [
          [generator.rowParameterId, generator.maxRows, generator.defaultRows],
          [generator.columnParameterId, generator.maxColumns, generator.defaultColumns],
        ];
        for (const [parameterId, maxValue, defaultValue] of gridParameters) {
          const parameter = (spec.parameterSchema || []).find((item: any) => item.id === parameterId);
          if (!parameter || parameter.type !== 'number' || !Number.isInteger(parameter.min) || !Number.isInteger(parameter.max)
            || parameter.min < 1 || parameter.max > maxValue || defaultValue < parameter.min || defaultValue > parameter.max) {
            throw new BadRequestException('资产 grid 生成器缺少有效的行列参数：' + generator.id);
          }
        }
        maximumInstances = generator.maxRows * generator.maxColumns;
      }
      estimatedExpandedCount += subtree.length * (maximumInstances - 1);
      if (estimatedExpandedCount > 300) throw new BadRequestException('资产结构生成器最大展开数量超过 300：' + generator.id);
    }

    const constraints = spec.constraints === undefined ? [] : spec.constraints;
    if (!Array.isArray(constraints) || constraints.length > 60) throw new BadRequestException('资产结构约束数量无效');
    const generatorIdSet = new Set(generators.map((item: any) => item.id));
    const claimedConstraintTargets = new Set<string>();
    const templateNodeIds = new Set<string>();
    for (const generator of generators) {
      for (const node of spec.componentTree) {
        let current = node.id;
        while (current) {
          if (current === generator.templateRootId) { templateNodeIds.add(node.id); break; }
          current = byId.get(current)?.parent;
        }
      }
    }
    const constraintIds = new Set<string>();
    for (const constraint of constraints) {
      if (!constraint || typeof constraint !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(constraint.id || '')
        || constraintIds.has(constraint.id) || !['follow','span','attach','adjacency'].includes(constraint.type)) {
        throw new BadRequestException('资产结构约束 ID 或类型无效');
      }
      constraintIds.add(constraint.id);
      if (constraint.type === 'attach' || constraint.type === 'adjacency') {
        const sourceNode = byId.get(constraint.sourceNodeId), targetNode = byId.get(constraint.targetNodeId);
        if (!sourceNode || !targetNode || sourceNode.id === targetNode.id || templateNodeIds.has(sourceNode.id) || templateNodeIds.has(targetNode.id)) {
          throw new BadRequestException('资产组件连接关系引用无效：' + constraint.id);
        }
        if (constraint.type === 'attach') {
          if ((sourceNode.kind || 'mesh') !== 'mesh' || (targetNode.kind || 'mesh') !== 'mesh'
            || sourceNode.parent !== targetNode.parent || !['x','y','z'].includes(constraint.axis)
            || ![-1,1].includes(Number(constraint.sourceSide)) || ![-1,1].includes(Number(constraint.targetSide))
            || !Number.isFinite(Number(constraint.offset ?? 0)) || Math.abs(Number(constraint.offset ?? 0)) > 100) {
            throw new BadRequestException('资产 attach 必须连接同一父级下的 Mesh 面：' + constraint.id);
          }
        } else if (!['adjacent','connects'].includes(constraint.relation)) {
          throw new BadRequestException('资产 adjacency 关系类型无效：' + constraint.id);
        }
        continue;
      }
      if (!generatorIdSet.has(constraint.sourceGeneratorId) || !ids.has(constraint.targetNodeId)
        || templateNodeIds.has(constraint.targetNodeId) || !['x','y','z'].includes(constraint.axis)) {
        throw new BadRequestException('资产结构约束引用无效');
      }
      const targetNode = byId.get(constraint.targetNodeId);
      if (constraint.type === 'span' && (!['dimensions.width','dimensions.height','dimensions.depth'].includes(constraint.property) || targetNode?.kind === 'group')) {
        throw new BadRequestException('资产 span 约束目标属性无效：' + constraint.id);
      }
      if (constraint.type === 'follow' && constraint.property !== undefined) throw new BadRequestException('资产 follow 约束不能声明 property：' + constraint.id);
      const sourceGenerator = generators.find((item: any) => item.id === constraint.sourceGeneratorId);
      const expectedAxis = ({ 'dimensions.width': 'x', 'dimensions.height': 'y', 'dimensions.depth': 'z' } as Record<string, string>)[constraint.property];
      if (!['rows','columns','repeat'].includes(constraint.measure || 'repeat')
        || (sourceGenerator?.type === 'grid' && !['rows','columns'].includes(constraint.measure))
        || (sourceGenerator?.type === 'repeat' && constraint.measure !== 'repeat')
        || (constraint.type === 'span' && expectedAxis !== constraint.axis)
        || !Number.isFinite(Number(constraint.factor ?? 1)) || Math.abs(Number(constraint.factor ?? 1)) > 10
        || !Number.isFinite(Number(constraint.offset ?? 0)) || Math.abs(Number(constraint.offset ?? 0)) > 100) {
        throw new BadRequestException('资产结构约束计算规则无效：' + constraint.id);
      }
      const targetKey = constraint.targetNodeId + ':' + constraint.type + ':' + (constraint.property || constraint.axis);
      if (claimedConstraintTargets.has(targetKey)) throw new BadRequestException('资产结构约束重复管理同一目标：' + constraint.id);
      claimedConstraintTargets.add(targetKey);
    }

    const attachmentGraph = new Map<string, Set<string>>();
    for (const constraint of constraints) if (constraint.type === 'attach') {
      const sources = attachmentGraph.get(constraint.targetNodeId) || new Set<string>();
      sources.add(constraint.sourceNodeId);
      attachmentGraph.set(constraint.targetNodeId, sources);
    }
    const visitingAttachments = new Set<string>(), visitedAttachments = new Set<string>();
    const visitAttachment = (nodeId: string) => {
      if (visitingAttachments.has(nodeId)) throw new BadRequestException('资产 attach 关系存在循环依赖：' + nodeId);
      if (visitedAttachments.has(nodeId)) return;
      visitingAttachments.add(nodeId);
      for (const sourceId of attachmentGraph.get(nodeId) || []) visitAttachment(sourceId);
      visitingAttachments.delete(nodeId);
      visitedAttachments.add(nodeId);
    };
    for (const nodeId of attachmentGraph.keys()) visitAttachment(nodeId);

    const assetId = randomUUID();
    const directory = resolve(this.storageDir, 'campus-visual-assets', 'objects');
    await mkdir(directory, { recursive: true });
    const absolutePath = resolve(directory, assetId + '.json');
    const temporaryPath = absolutePath + '.tmp';
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
    const { rename } = await import('node:fs/promises');
    await rename(temporaryPath, absolutePath);
    const record = {
      assetId,
      name: String(input.name || spec.targetName || '未命名 3D 资产').slice(0, 160),
      category: String(spec.category || input.category || 'other').slice(0, 80),
      objectType: String(spec.objectType || input.objectType || spec.targetName || '3D 资产').slice(0, 120),
      format: 'object-sculpt-json',
      filePath: 'objects/' + assetId + '.json',
      checksumSha256: createHash('sha256').update(serialized).digest('hex'),
      sizeBytes: Buffer.byteLength(serialized, 'utf8'),
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.enqueueVisualManifestUpdate(async () => {
        const manifest = await this.readVisualManifest();
        manifest.objects = Array.isArray(manifest.objects) ? manifest.objects : [];
        manifest.objects.push(record);
        await this.writeVisualManifest(manifest);
      });
    } catch (error) {
      await rm(absolutePath, { force: true });
      throw error;
    }
    return { ...record, spec };
  }

  async getObjectSculptAsset(userId: string, assetId: string) {
    if (!userId) throw new BadRequestException('缺少资产读取用户身份');
    if (!/^[a-f0-9-]{36}$/i.test(assetId)) throw new NotFoundException('结构化资产不存在');
    const manifest = await this.readVisualManifest();
    const record = (manifest.objects || []).find((item: any) => item.assetId === assetId);
    if (!record) throw new NotFoundException('结构化资产不存在');
    if (record.createdBy !== userId) throw new ForbiddenException('无权读取该结构化资产');
    const root = resolve(this.storageDir, 'campus-visual-assets');
    const absolutePath = resolve(root, record.filePath);
    const relativePath = relative(root, absolutePath);
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) throw new NotFoundException('结构化资产路径无效');
    try {
      const content = await readFile(absolutePath, 'utf8');
      const spec = JSON.parse(content);
      if (createHash('sha256').update(content).digest('hex') !== record.checksumSha256) throw new NotFoundException('结构化资产校验失败');
      return { ...record, spec };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException('结构化资产文件不存在或内容损坏');
    }
  }

  async getVisualAssetManifest() {
    return this.readVisualManifest();
  }

  async getVisualAssetContent(fileId: string) {
    if (!/^[a-f0-9-]{36}$/i.test(fileId)) throw new NotFoundException('素材文件不存在');
    const manifest = await this.readVisualManifest();
    const file = manifest.assets.flatMap((asset: any) => asset.files || []).find((item: any) => item.fileId === fileId);
    if (!file) throw new NotFoundException('素材文件不存在');
    const extension = String(file.format || '').toLowerCase();
    const allowed = ['png', 'jpg', 'jpeg', 'webp', 'glb'];
    if (!allowed.includes(extension)) throw new NotFoundException('素材格式无效');
    const absolutePath = resolve(this.storageDir, 'campus-visual-assets', 'files', fileId + (extension === 'jpeg' ? '.jpg' : '.' + extension));
    try {
      await readFile(absolutePath, { flag: 'r' });
    } catch {
      throw new NotFoundException('素材文件不存在，请检查服务器持久化存储卷');
    }
    const mimeType = extension === 'glb' ? 'model/gltf-binary' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';
    return { absolutePath, mimeType, size: Number(file.sizeBytes || 0) };
  }

  private async enqueueVisualManifestUpdate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.visualManifestQueue.then(operation, operation);
    this.visualManifestQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async readVisualManifest() {
    try {
      const content = await readFile(this.visualManifestPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.assets) || !Array.isArray(parsed.bindings)) {
        throw new Error('校园视觉资产清单结构无效');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return {
        schemaVersion: 1,
        idStrategy: 'stable-spatial-feature-id',
        assetRoots: ['/assets/campus/', '/models/buildings/', '/api/v1/assets/visual-assets/'],
        viewModes: ['2.5d', '3d', 'shared'],
        sourceTypes: ['ai_generated', 'manual_model', 'procedural', 'external'],
        statuses: ['draft', 'review', 'ready', 'archived'],
        assets: [],
        objects: [],
        bindings: [],
      };
    }
  }

  private async writeVisualManifest(manifest: Record<string, any>) {
    const directory = resolve(this.storageDir, 'campus-visual-assets');
    await mkdir(directory, { recursive: true });
    const temporaryPath = this.visualManifestPath + '.tmp';
    await writeFile(temporaryPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8' });
    const { rename } = await import('node:fs/promises');
    await rename(temporaryPath, this.visualManifestPath);
  }

  private async requireMap(campusId: string, mapId: string) {
    const rows = await this.dataSource.query('SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2', [mapId, campusId]);
    if (!rows.length) throw new NotFoundException('地图项目不存在');
  }

  private async requireRole(userId: string, campusId: string, allowed: string[]) {
    const rows = await this.dataSource.query('SELECT role FROM campus_member WHERE campus_id=$1 AND user_id=$2', [campusId, userId]);
    if (!rows.length) throw new NotFoundException('学校不存在或无权访问');
    if (!allowed.includes(rows[0].role)) throw new ForbiddenException('当前角色无权执行此操作');
  }
}
