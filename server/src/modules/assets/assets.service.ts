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

  constructor(private readonly dataSource: DataSource, config: ConfigService) {
    this.storageDir = resolve(config.get<string>('ASSET_STORAGE_DIR', './uploads'));
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
