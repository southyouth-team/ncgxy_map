import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { validateObjectModelSpecV3 } from '../../shared/object-model-spec-v3';


function assertStableSweepPath(path: number[][], label: string, ErrorType: new (message?: string) => Error) {
  const maxTurnRadians = Math.PI * (150 / 180);
  for (let index = 1; index < path.length - 1; index += 1) {
    const incoming = [path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1], path[index][2] - path[index - 1][2]];
    const outgoing = [path[index + 1][0] - path[index][0], path[index + 1][1] - path[index][1], path[index + 1][2] - path[index][2]];
    const incomingLength = Math.hypot(...incoming);
    const outgoingLength = Math.hypot(...outgoing);
    const dot = incoming.reduce((sum, value, axis) => sum + value * outgoing[axis], 0);
    const turnRadians = Math.acos(Math.max(-1, Math.min(1, dot / (incomingLength * outgoingLength))));
    if (turnRadians > maxTurnRadians) throw new ErrorType(label + ' 存在超过 150° 的急转弯，可能导致扫掠截面翻转或自相交');
  }
}

function assertSimpleAssetProfile(points: number[][], label: string, ErrorType: new (message?: string) => Error) {
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a: number[], b: number[], p: number[]) => Math.abs(cross(a, b, p)) < 0.000001
    && p[0] >= Math.min(a[0], b[0]) - 0.000001 && p[0] <= Math.max(a[0], b[0]) + 0.000001
    && p[1] >= Math.min(a[1], b[1]) - 0.000001 && p[1] <= Math.max(a[1], b[1]) + 0.000001;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    if (Math.hypot(points[i][0] - next[0], points[i][1] - next[1]) < 0.0001) throw new ErrorType(label + ' 存在重复或零长度边');
    area += points[i][0] * next[1] - next[0] * points[i][1];
  }
  if (Math.abs(area) < 0.0001) throw new ErrorType(label + ' 轮廓面积不能为零');
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i || j === (i + 1) % points.length || i === (j + 1) % points.length) continue;
      const d = points[j], e = points[(j + 1) % points.length];
      const abC = cross(a, b, d), abD = cross(a, b, e), cdA = cross(d, e, a), cdB = cross(d, e, b);
      const proper = ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
        && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
      const touching = (Math.abs(abC) < 0.000001 && onSegment(a, b, d))
        || (Math.abs(abD) < 0.000001 && onSegment(a, b, e))
        || (Math.abs(cdA) < 0.000001 && onSegment(d, e, a))
        || (Math.abs(cdB) < 0.000001 && onSegment(d, e, b));
      if (proper || touching) throw new ErrorType(label + ' 存在自相交边');
    }
  }
}

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
    try { validateObjectModelSpecV3(spec); } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'ObjectModelSpec 3.0 校验失败');
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || spec.schemaVersion !== '3.0'
      || Object.prototype.hasOwnProperty.call(spec, 'generators') || Object.prototype.hasOwnProperty.call(spec, 'constraints')
      || !Array.isArray(spec.componentTree) || spec.componentTree.length < 1 || spec.componentTree.length > 300
      || !spec.materials || typeof spec.materials !== 'object' || Array.isArray(spec.materials)) {
      throw new BadRequestException('ObjectModelSpec 3.0 结构无效，无法保存');
    }
    const serialized = JSON.stringify(spec);
    if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) throw new BadRequestException('结构化资产数据不能超过 2 MB');
    const ids = new Set<string>();
    for (const node of spec.componentTree) {
      if (!node || typeof node.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(node.id) || ids.has(node.id)) throw new BadRequestException('资产组件 ID 无效或重复');
      ids.add(node.id);
    }
    const primitives = new Set(['box','cuboid','polygon','wedge','arch','cylinder','cone','sphere','ellipsoid','torus','tube','lathe','sweep','loft']);
    const byId = new Map<string, any>(spec.componentTree.map((node: any) => [node.id, node] as [string, any]));
    for (const node of spec.componentTree) {
      if (node.parent && !ids.has(node.parent)) throw new BadRequestException('资产组件父节点不存在：' + node.id);
      const kind = node.kind || 'mesh';
      if (!['group', 'mesh'].includes(kind)) throw new BadRequestException('资产组件 kind 无效：' + node.id);
      if (kind === 'mesh') {
        if (!primitives.has(String(node.primitive || '').toLowerCase())) throw new BadRequestException('资产组件几何类型无效：' + node.id);
        if (!node.dimensions || ['width','height','depth'].some(key => !Number.isFinite(Number(node.dimensions[key])) || Number(node.dimensions[key]) < 0.02 || Number(node.dimensions[key]) > 100)) throw new BadRequestException('资产组件尺寸无效：' + node.id);
        if (typeof node.material !== 'string' || !Object.prototype.hasOwnProperty.call(spec.materials, node.material)) throw new BadRequestException('资产组件材质引用无效：' + node.id);
        if (String(node.primitive).toLowerCase() === 'tube') {
          const path = node.geometryDescriptor?.path;
          if (!Array.isArray(path) || path.length < 2 || path.length > 32
            || path.some((point: any) => !Array.isArray(point) || point.length !== 3
              || point.some((value: unknown) => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5))) {
            throw new BadRequestException('资产 tube 路径必须包含 2 到 32 个有效三维归一化坐标点：' + node.id);
          }
          const radius = Number(node.geometryDescriptor?.radius ?? 0.08);
          const tubularSegments = Number(node.geometryDescriptor?.tubularSegments ?? 32);
          const radialSegments = Number(node.geometryDescriptor?.radialSegments ?? 8);
          if (!Number.isFinite(radius) || radius < 0.01 || radius > 10
            || !Number.isInteger(tubularSegments) || tubularSegments < 3 || tubularSegments > 128
            || !Number.isInteger(radialSegments) || radialSegments < 3 || radialSegments > 24
            || (node.geometryDescriptor?.closed !== undefined && typeof node.geometryDescriptor.closed !== 'boolean')) {
            throw new BadRequestException('资产 tube 几何参数无效：' + node.id);
          }
        }
        if (String(node.primitive).toLowerCase() === 'lathe') {
          const profile = node.geometryDescriptor?.profile;
          if (!Array.isArray(profile) || profile.length < 2 || profile.length > 32
            || profile.some((point: any) => !Array.isArray(point) || point.length !== 2
              || !Number.isFinite(Number(point[0])) || Number(point[0]) < 0 || Number(point[0]) > 0.5
              || !Number.isFinite(Number(point[1])) || Number(point[1]) < -0.5 || Number(point[1]) > 0.5)
            || profile.every((point: number[], index: number) => index === 0
              || (Math.abs(Number(point[0]) - Number(profile[index - 1][0])) < 0.0001
                && Math.abs(Number(point[1]) - Number(profile[index - 1][1])) < 0.0001))) {
            throw new BadRequestException('资产 lathe profile 必须包含 2 到 32 个有效的 [半径,高度] 归一化截面点：' + node.id);
          }
        }
        if (String(node.primitive).toLowerCase() === 'sweep') {
          if (node.geometryDescriptor?.closed === true) throw new BadRequestException('资产 sweep 暂不支持闭合路径：' + node.id);
          const path = node.geometryDescriptor?.path;
          const profile = node.geometryDescriptor?.profile;
          if (!Array.isArray(path) || path.length < 2 || path.length > 32
            || path.some((point: any) => !Array.isArray(point) || point.length !== 3
              || point.some((value: unknown) => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5))) {
            throw new BadRequestException('资产 sweep path 必须包含 2 到 32 个有效三维归一化坐标点：' + node.id);
          }
          if (path.some((point: any, index: number) => index > 0
            && Math.hypot(Number(point[0]) - Number(path[index - 1][0]), Number(point[1]) - Number(path[index - 1][1]), Number(point[2]) - Number(path[index - 1][2])) < 0.0001)) {
            throw new BadRequestException('资产 sweep path 不能包含重复或零长度路径段：' + node.id);
          }
          assertStableSweepPath(path.map((point: any[]) => point.map(Number)), '资产 sweep path：' + node.id, BadRequestException);
          if (!Array.isArray(profile) || profile.length < 3 || profile.length > 24
            || profile.some((point: any) => !Array.isArray(point) || point.length !== 2
              || point.some((value: unknown) => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5))) {
            throw new BadRequestException('资产 sweep profile 必须包含 3 到 24 个有效二维归一化坐标点：' + node.id);
          }
          assertSimpleAssetProfile(profile.map((point: any) => [Number(point[0]), Number(point[1])]), '资产 sweep profile', BadRequestException);
          const steps = Number(node.geometryDescriptor?.steps ?? 32);
          if (!Number.isInteger(steps) || steps < 3 || steps > 128) {
            throw new BadRequestException('资产 sweep steps 参数无效：' + node.id);
          }
        }
        if (String(node.primitive).toLowerCase() === 'loft') {
          const sections = node.geometryDescriptor?.sections;
          if (!Array.isArray(sections) || sections.length < 2 || sections.length > 12) {
            throw new BadRequestException('资产 loft 必须包含 2 到 12 个截面：' + node.id);
          }
          const pointCount = Array.isArray(sections[0]?.points) ? sections[0].points.length : 0;
          let previousHeight = -Infinity;
          let contourOrientation = 0;
          if (pointCount < 3 || pointCount > 24
            || sections.some((section: any) => {
              const invalid = !section || typeof section !== 'object'
                || !Number.isFinite(Number(section.height)) || Number(section.height) < -0.5 || Number(section.height) > 0.5
                || Number(section.height) <= previousHeight + 0.0001
                || !Array.isArray(section.points) || section.points.length !== pointCount
                || section.points.some((point: any) => !Array.isArray(point) || point.length !== 2
                  || point.some((value: unknown) => !Number.isFinite(Number(value)) || Number(value) < -0.5 || Number(value) > 0.5));
              if (!invalid) {
                const profile = section.points.map((point: any) => [Number(point[0]), Number(point[1])]);
                assertSimpleAssetProfile(profile, '资产 loft section', BadRequestException);
                const signedArea = profile.reduce((sum: number, point: number[], index: number) => {
                  const next = profile[(index + 1) % profile.length];
                  return sum + point[0] * next[1] - next[0] * point[1];
                }, 0);
                const orientation = Math.sign(signedArea);
                if (contourOrientation && orientation !== contourOrientation) {
                  throw new BadRequestException('资产 loft 截面必须保持一致的轮廓绕序：' + node.id);
                }
                contourOrientation = orientation;
                previousHeight = Number(section.height);
              }
              return invalid;
            })) {
            throw new BadRequestException('资产 loft 截面高度必须严格递增，且每个截面包含相同数量的有效轮廓点：' + node.id);
          }
        }
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
      const operations = spec.operations === undefined ? [] : spec.operations;
      if (!Array.isArray(operations) || operations.length > 40) throw new BadRequestException('资产 operations 数量无效');
      const operationIds = new Set<string>(), operationRoots = new Set<string>(), claimedSourceNodes = new Set<string>();
      const parameterById = new Map<string, any>((spec.parameterSchema || []).map((item: any) => [item.id, item]));
      let expandedCount = spec.componentTree.length;
      const validateExpression = (expression: any, depth = 0): void => {
        if (depth > 16) throw new BadRequestException('资产空间表达式嵌套层级超限');
        if (typeof expression === 'number') {
          if (!Number.isFinite(expression) || Math.abs(expression) > 10000) throw new BadRequestException('资产空间表达式常量无效');
          return;
        }
        if (!expression || typeof expression !== 'object' || Array.isArray(expression)) throw new BadRequestException('资产空间表达式格式无效');
        if (expression.op === 'constant') {
          if (!Number.isFinite(Number(expression.value)) || Math.abs(Number(expression.value)) > 10000) throw new BadRequestException('资产空间表达式常量无效');
        } else if (expression.op === 'index' || expression.op === 'count') {
          return;
        } else if (expression.op === 'parameter') {
          if (typeof expression.id !== 'string' || parameterById.get(expression.id)?.type !== 'number') {
            throw new BadRequestException('资产空间表达式只能引用已声明的数值参数');
          }
        } else if (['add','subtract','multiply','divide'].includes(expression.op)) {
          validateExpression(expression.left, depth + 1);
          validateExpression(expression.right, depth + 1);
        } else if (['sin','cos','negate'].includes(expression.op)) {
          validateExpression(expression.value, depth + 1);
        } else {
          throw new BadRequestException('资产空间表达式运算不受支持：' + String(expression.op));
        }
      };
      const subtreeFor = (rootId: string) => spec.componentTree.filter((node: any) => {
        let current = node;
        while (current) {
          if (current.id === rootId) return true;
          current = current.parent ? byId.get(current.parent) : null;
        }
        return false;
      });
      for (const operation of operations) {
        if (!operation || typeof operation !== 'object'
          || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(operation.id || '')
          || operationIds.has(operation.id) || operation.type !== 'instance') {
          throw new BadRequestException('资产 instance operation 定义无效');
        }
        operationIds.add(operation.id);
        const root = byId.get(operation.sourceRootId);
        if (!root || (root.kind || 'mesh') !== 'group' || operationRoots.has(root.id)) {
          throw new BadRequestException('资产 instance 源节点必须是唯一 Group：' + operation.id);
        }
        operationRoots.add(root.id);
        const subtree = subtreeFor(root.id);
        for (const node of subtree) {
          if (claimedSourceNodes.has(node.id)) throw new BadRequestException('资产 instance 源子树不能重叠：' + operation.id);
          claimedSourceNodes.add(node.id);
        }
        const countParameter = parameterById.get(operation.count?.parameterId);
        if (!countParameter || countParameter.type !== 'number' || !Number.isInteger(countParameter.value)
          || !Number.isInteger(countParameter.min) || !Number.isInteger(countParameter.max)
          || countParameter.min < 1 || countParameter.max > 100 || countParameter.value < countParameter.min || countParameter.value > countParameter.max) {
          throw new BadRequestException('资产 instance 必须绑定 1-100 范围内的整数数量参数：' + operation.id);
        }
        expandedCount += subtree.length * (countParameter.max - 1);
        if (expandedCount > 300) throw new BadRequestException('资产 operations 最大展开组件数量超过 300：' + operation.id);
        const transform = operation.transform || {};
        for (const key of ['position','rotation','scale']) {
          const vector = transform[key] ?? (key === 'scale' ? [1,1,1] : [0,0,0]);
          if (!Array.isArray(vector) || vector.length !== 3) throw new BadRequestException('资产 instance transform.' + key + ' 必须是三维表达式数组：' + operation.id);
          vector.forEach((value: any) => validateExpression(value));
        }
      }

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
      try { validateObjectModelSpecV3(spec); } catch {
        throw new NotFoundException('结构化资产不是有效的 ObjectModelSpec 3.0');
      }
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
