import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateMapDto } from './dto/create-map.dto';
import { UpdateMapConfigDto } from './dto/update-map-config.dto';
@Injectable()
export class MapsService {
  constructor(private readonly db: DataSource) {}
  async create(userId:string,campusId:string,dto:CreateMapDto) {
    await this.requireRole(userId,campusId,['owner','admin','editor']);
    try {
      const rows=await this.db.query(
        `INSERT INTO campus_map (campus_id,slug,name,description,coordinate_system,coordinate_unit,canvas_width,canvas_height,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,campus_id,slug,name,description,coordinate_system,coordinate_unit,canvas_width,canvas_height,status,revision,created_at,updated_at`,
        [campusId,dto.slug,dto.name,dto.description??null,dto.coordinateSystem??'campus-local',dto.coordinateUnit??'pixel',dto.canvasWidth??640,dto.canvasHeight??480,userId]);
      return rows[0];
    } catch(error) { if(this.isUniqueViolation(error)) throw new ConflictException('该学校下的地图 slug 已存在'); throw error; }
  }
  async findAll(userId:string,campusId:string) {
    await this.requireRole(userId,campusId,['owner','admin','editor','viewer']);
    return this.db.query(
      `SELECT id,campus_id,slug,name,description,coordinate_system,coordinate_unit,canvas_width,canvas_height,coordinate_config,status,revision,published_version_id,created_at,updated_at
       FROM campus_map WHERE campus_id=$1 ORDER BY id`,[campusId]);
  }
  async updateConfig(userId:string,campusId:string,mapId:string,dto:UpdateMapConfigDto) {
    await this.requireRole(userId,campusId,['owner','admin','editor']);
    const result=await this.db.query(
      `UPDATE campus_map SET coordinate_config=$1::jsonb,revision=revision+1,updated_at=now()
       WHERE id=$2 AND campus_id=$3 AND revision=$4
       RETURNING id,campus_id,coordinate_config,revision,updated_at`,
      [JSON.stringify(dto.coordinateConfig??{}),mapId,campusId,dto.revision]);
    // 兼容 PostgreSQL 驱动返回 rows 或 [rows, rowCount] 的两种结果形态。
    const rows=Array.isArray(result?.[0]) ? result[0] : result;
    if(!rows.length) {
      const exists=await this.db.query('SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2',[mapId,campusId]);
      if(!exists.length) throw new NotFoundException('地图项目不存在');
      throw new ConflictException('地图配置版本冲突，请刷新后重试');
    }
    return rows[0];
  }
  private async requireRole(userId:string,campusId:string,allowed:string[]) {
    const rows=await this.db.query('SELECT role FROM campus_member WHERE campus_id=$1 AND user_id=$2',[campusId,userId]);
    if(!rows.length) throw new NotFoundException('学校不存在或无权访问');
    if(!allowed.includes(rows[0].role)) throw new ForbiddenException('当前角色无权执行此操作');
  }
  private isUniqueViolation(error:unknown) { return typeof error==='object'&&error!==null&&'code' in error&&error.code==='23505'; }
}