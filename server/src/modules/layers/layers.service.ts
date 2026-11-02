import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateLayerDto } from './dto/create-layer.dto';
import { UpdateLayerDto } from './dto/update-layer.dto';

@Injectable()
export class LayersService {
  constructor(private readonly dataSource: DataSource) {}

  async create(userId: string, campusId: string, mapId: string, dto: CreateLayerDto) {
    await this.requireRole(userId,campusId,['owner','admin','editor']);
    const map = await this.dataSource.query('SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2',[mapId,campusId]);
    if (!map.length) throw new NotFoundException('地图项目不存在');
    try {
      const rows = await this.dataSource.query(
        `INSERT INTO campus_layer (campus_id,map_id,layer_key,name,feature_type,visible,locked)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,campus_id,map_id,layer_key,name,feature_type,sort_order,visible,locked,style,created_at,updated_at`,
        [campusId,mapId,dto.key,dto.name,dto.featureType,dto.visible ?? true,dto.locked ?? false],
      );
      return rows[0];
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('该地图下的图层标识已存在');
      throw error;
    }
  }

  async findAll(userId: string, campusId: string, mapId: string) {
    await this.requireRole(userId,campusId,['owner','admin','editor','viewer']);
    await this.requireMap(campusId,mapId);
    return this.dataSource.query(
      `SELECT id,campus_id,map_id,layer_key,name,feature_type,sort_order,visible,locked,style,created_at,updated_at
       FROM campus_layer WHERE campus_id=$1 AND map_id=$2 ORDER BY sort_order,id`,
      [campusId,mapId],
    );
  }

  async update(userId: string, campusId: string, mapId: string, layerId: string, dto: UpdateLayerDto) {
    await this.requireRole(userId,campusId,['owner','admin','editor']);
    await this.requireMap(campusId,mapId);
    const rows = await this.dataSource.query(
      `UPDATE campus_layer SET name=COALESCE($4,name),feature_type=COALESCE($5,feature_type),
         visible=COALESCE($6,visible),locked=COALESCE($7,locked),updated_at=now()
       WHERE id=$1 AND campus_id=$2 AND map_id=$3
       RETURNING id,campus_id,map_id,layer_key,name,feature_type,sort_order,visible,locked,style,created_at,updated_at`,
      [layerId,campusId,mapId,dto.name,dto.featureType,dto.visible,dto.locked],
    );
    if (!rows.length) throw new NotFoundException('图层不存在');
    return rows[0];
  }

  async remove(userId: string, campusId: string, mapId: string, layerId: string) {
    await this.requireRole(userId,campusId,['owner','admin','editor']);
    await this.requireMap(campusId,mapId);
    const rows = await this.dataSource.query(
      `DELETE FROM campus_layer l WHERE l.id=$1 AND l.campus_id=$2 AND l.map_id=$3
       AND NOT EXISTS (SELECT 1 FROM campus_feature f WHERE f.layer_id=l.id) RETURNING l.id`,
      [layerId,campusId,mapId],
    );
    if (rows.length) return { id: rows[0].id, deleted: true };
    const existing = await this.dataSource.query('SELECT id FROM campus_layer WHERE id=$1 AND campus_id=$2 AND map_id=$3',[layerId,campusId,mapId]);
    if (!existing.length) throw new NotFoundException('图层不存在');
    throw new ConflictException('该图层仍包含地图要素，请先迁移或删除要素后再删除图层');
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
