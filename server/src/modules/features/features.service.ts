import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';

const GEOMETRY_TYPES = new Set(['Point','LineString','Polygon','MultiPolygon']);

@Injectable()
export class FeaturesService {
  constructor(private readonly dataSource: DataSource) {}

  async create(userId: string, campusId: string, mapId: string, dto: CreateFeatureDto) {
    await this.requireRole(userId,campusId,['owner','admin','editor']);
    await this.requireMap(campusId,mapId);
    await this.validateGeometry(dto.geometry);
    const layer = await this.dataSource.query(
      'SELECT id FROM campus_layer WHERE id=$1 AND campus_id=$2 AND map_id=$3',
      [dto.layerId,campusId,mapId],
    );
    if (!layer.length) throw new NotFoundException('目标图层不存在');
    try {
      const rows = await this.dataSource.query(
        `INSERT INTO campus_feature
          (campus_id,map_id,layer_id,feature_key,name,geometry,properties,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_GeomFromGeoJSON($6),0),$7::jsonb,$8,$8)
         RETURNING id,campus_id,map_id,layer_id,feature_key,name,ST_AsGeoJSON(geometry)::jsonb AS geometry,
                   properties,revision,created_at,updated_at`,
        [campusId,mapId,dto.layerId,dto.featureKey,dto.name ?? null,JSON.stringify(dto.geometry),JSON.stringify(dto.properties ?? {}),userId],
      );
      return rows[0];
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('该地图下的要素标识已存在');
      throw error;
    }
  }

  async findAll(userId: string, campusId: string, mapId: string) {
    await this.requireRole(userId,campusId,['owner','admin','editor','viewer']);
    await this.requireMap(campusId,mapId);
    return this.dataSource.query(
      `SELECT id,campus_id,map_id,layer_id,feature_key,name,ST_AsGeoJSON(geometry)::jsonb AS geometry,
              properties,revision,created_at,updated_at
       FROM campus_feature WHERE campus_id=$1 AND map_id=$2 ORDER BY id`,
      [campusId,mapId],
    );
  }

  async update(userId: string, campusId: string, mapId: string, featureId: string, dto: UpdateFeatureDto) {
    await this.requireRole(userId,campusId,['owner','admin','editor']);
    await this.requireMap(campusId,mapId);
    if (dto.geometry) await this.validateGeometry(dto.geometry);

    const result = await this.dataSource.query(
      `UPDATE campus_feature SET
         name=CASE WHEN $5::boolean THEN $6 ELSE name END,
         geometry=CASE WHEN $7::boolean THEN ST_SetSRID(ST_GeomFromGeoJSON($8),0) ELSE geometry END,
         properties=CASE WHEN $9::boolean THEN $10::jsonb ELSE properties END,
         revision=revision+1,updated_by=$4,updated_at=now()
       WHERE id=$1 AND campus_id=$2 AND map_id=$3 AND revision=$11
       RETURNING id,campus_id,map_id,layer_id,feature_key,name,ST_AsGeoJSON(geometry)::jsonb AS geometry,
                 properties,revision,created_at,updated_at`,
      [featureId,campusId,mapId,userId,dto.name !== undefined,dto.name ?? null,dto.geometry !== undefined,
       dto.geometry ? JSON.stringify(dto.geometry) : null,dto.properties !== undefined,
       dto.properties !== undefined ? JSON.stringify(dto.properties) : null,dto.revision],
    );
    // TypeORM QueryRunner 在不同驱动/返回模式下可能返回 rows 或 [rows, affected]。
    const rows = Array.isArray(result?.[0]) ? result[0] : result;
    if (rows.length) return rows[0];

    const exists = await this.dataSource.query(
      'SELECT revision FROM campus_feature WHERE id=$1 AND campus_id=$2 AND map_id=$3',
      [featureId,campusId,mapId],
    );
    if (!exists.length) throw new NotFoundException('地图要素不存在');
    throw new ConflictException({ message: '地图要素已被其他操作修改，请重新加载后再编辑', currentRevision: exists[0].revision });
  }

  async remove(userId: string, campusId: string, mapId: string, featureId: string, revision: number) {
    await this.requireRole(userId,campusId,['owner','admin','editor']);
    await this.requireMap(campusId,mapId);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new BadRequestException('revision 必须是正整数');
    const rows = await this.dataSource.query(
      'DELETE FROM campus_feature WHERE id=$1 AND campus_id=$2 AND map_id=$3 AND revision=$4 RETURNING id',
      [featureId,campusId,mapId,revision],
    );
    if (rows.length) return { id: rows[0].id, deleted: true };
    const exists = await this.dataSource.query(
      'SELECT revision FROM campus_feature WHERE id=$1 AND campus_id=$2 AND map_id=$3',
      [featureId,campusId,mapId],
    );
    if (!exists.length) throw new NotFoundException('地图要素不存在');
    throw new ConflictException({ message: '地图要素版本已变化，请重新加载后再删除', currentRevision: exists[0].revision });
  }

  private async validateGeometry(geometry: Record<string, unknown>) {
    if (!GEOMETRY_TYPES.has(String(geometry.type))) {
      throw new BadRequestException('geometry.type 仅支持 Point、LineString、Polygon、MultiPolygon');
    }
    if (!Array.isArray(geometry.coordinates)) {
      throw new BadRequestException('geometry.coordinates 必须是数组');
    }
    try {
      const rows = await this.dataSource.query(
        'SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1),0)) AS valid',
        [JSON.stringify(geometry)],
      );
      if (!rows[0]?.valid) throw new BadRequestException('空间几何无效或拓扑不合法');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('GeoJSON 几何格式不合法');
    }
  }

  private async requireMap(campusId: string, mapId: string) {
    const rows = await this.dataSource.query('SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2',[mapId,campusId]);
    if (!rows.length) throw new NotFoundException('地图项目不存在');
  }

  private async requireRole(userId: string, campusId: string, allowed: string[]) {
    const rows = await this.dataSource.query('SELECT role FROM campus_member WHERE campus_id=$1 AND user_id=$2',[campusId,userId]);
    if (!rows.length) throw new NotFoundException('学校不存在或无权访问');
    if (!allowed.includes(rows[0].role)) throw new ForbiddenException('当前角色无权执行此操作');
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
