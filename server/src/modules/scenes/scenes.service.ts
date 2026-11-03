import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SaveSceneDto } from './dto/save-scene.dto';
import { SaveIndoorBuildingDto } from './dto/save-indoor-building.dto';

const OBJECT_TYPES = new Set(['building','road','terrain','water','vegetation','facility']);

@Injectable()
export class ScenesService {
  constructor(private readonly db: DataSource) {}

  async findOne(userId: string, campusId: string, mapId: string) {
    await this.requireRole(userId, campusId, ['owner','admin','editor','viewer']);
    await this.requireMap(campusId, mapId);
    const rows = await this.db.query(
      `SELECT id,campus_id,map_id,schema_version,document,revision,created_at,updated_at
       FROM campus_scene WHERE campus_id=$1 AND map_id=$2`,
      [campusId,mapId],
    );
    if (!rows.length) return { campusId, mapId, schemaVersion: 2, revision: 0, document: null };
    return rows[0];
  }

  async save(userId: string, campusId: string, mapId: string, dto: SaveSceneDto) {
    await this.requireRole(userId, campusId, ['owner','admin','editor']);
    this.validateDocument(dto.document, mapId);

    return this.db.transaction(async (manager) => {
      const maps = await manager.query(
        'SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2 FOR UPDATE',
        [mapId,campusId],
      );
      if (!maps.length) throw new NotFoundException('地图项目不存在');

      const current = await manager.query(
        'SELECT id,revision FROM campus_scene WHERE campus_id=$1 AND map_id=$2 FOR UPDATE',
        [campusId,mapId],
      );
      const currentRevision = current.length ? Number(current[0].revision) : 0;
      if (currentRevision !== dto.revision) {
        throw new ConflictException({
          message: '三维场景版本冲突，请重新加载后再保存',
          currentRevision,
        });
      }

      const objects = dto.document.objects as Array<Record<string, unknown>>;
      const bindings = objects.map((object) => ({
        objectId: String(object.id),
        featureId: String(object.featureId),
        type: String(object.type),
      }));
      const featureIds = [...new Set(bindings.map((item) => item.featureId))];
      if (featureIds.length !== bindings.length) {
        throw new BadRequestException('一个 GIS Feature 只能关联一个主场景对象');
      }

      if (featureIds.length) {
        const features = await manager.query(
          `SELECT id::text AS id FROM campus_feature
           WHERE campus_id=$1 AND map_id=$2 AND id = ANY($3::bigint[])`,
          [campusId,mapId,featureIds],
        );
        const found = new Set(features.map((feature: { id: string }) => String(feature.id)));
        const missing = featureIds.filter((id) => !found.has(id));
        if (missing.length) {
          throw new BadRequestException({ message: '场景对象引用了不属于当前地图的 GIS Feature', featureIds: missing });
        }
      }

      const nextRevision = currentRevision + 1;
      const document = { ...dto.document, revision: nextRevision, mapId };
      let sceneId: string;
      if (current.length) {
        sceneId = String(current[0].id);
        await manager.query(
          `UPDATE campus_scene SET schema_version=$1,document=$2::jsonb,
             revision=$3,updated_by=$4,updated_at=now()
           WHERE id=$5`,
          [Number(dto.document.schemaVersion),JSON.stringify(document),nextRevision,userId,sceneId],
        );
      } else {
        const inserted = await manager.query(
          `INSERT INTO campus_scene
            (campus_id,map_id,schema_version,document,revision,created_by,updated_by)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$6) RETURNING id`,
          [campusId,mapId,Number(dto.document.schemaVersion),JSON.stringify(document),nextRevision,userId],
        );
        sceneId = String(inserted[0].id);
      }

      await manager.query('DELETE FROM campus_scene_feature WHERE scene_id=$1',[sceneId]);
      for (const binding of bindings) {
        await manager.query(
          `INSERT INTO campus_scene_feature
            (campus_id,map_id,scene_id,feature_id,scene_object_id,object_type)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [campusId,mapId,sceneId,binding.featureId,binding.objectId,binding.type],
        );
      }
      return { id: sceneId, campusId, mapId, schemaVersion: Number(dto.document.schemaVersion), revision: nextRevision, document };
    });
  }


  async findPlan(userId: string, campusId: string, mapId: string) {
    await this.requireRole(userId, campusId, ['owner','admin','editor','viewer']);
    await this.requireMap(campusId, mapId);
    const rows = await this.db.query(
      `SELECT id,campus_id,map_id,schema_version,document,revision,created_at,updated_at
       FROM campus_plan_document WHERE campus_id=$1 AND map_id=$2`,
      [campusId,mapId],
    );
    if (!rows.length) return { campusId, mapId, schemaVersion: 2, revision: 0, document: null };
    return rows[0];
  }

  async savePlan(userId: string, campusId: string, mapId: string, revision: number, document: Record<string, unknown>) {
    await this.requireRole(userId, campusId, ['owner','admin','editor']);
    this.validatePlanDocument(document, mapId);
    return this.db.transaction(async (manager) => {
      const maps = await manager.query(
        'SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2 FOR UPDATE',
        [mapId,campusId],
      );
      if (!maps.length) throw new NotFoundException('地图项目不存在');

      // referenceImage 仅允许引用当前 campus/map 下已登记的底图资产，防止跨地图引用或伪造 assetId。
      const referenceImage = document.referenceImage as Record<string, unknown> | null;
      if (referenceImage?.assetId) {
        const assets = await manager.query(
          `SELECT id FROM campus_asset
           WHERE id=$1 AND campus_id=$2 AND map_id=$3 AND asset_type='base-map'`,
          [String(referenceImage.assetId),campusId,mapId],
        );
        if (!assets.length) throw new BadRequestException('底图资源不存在或不属于当前地图');
      }

      const current = await manager.query(
        'SELECT id,revision FROM campus_plan_document WHERE campus_id=$1 AND map_id=$2 FOR UPDATE',
        [campusId,mapId],
      );
      const currentRevision = current.length ? Number(current[0].revision) : 0;
      if (currentRevision !== revision) {
        throw new ConflictException({ message: '二维平面编辑文档版本冲突，请重新加载后再保存', currentRevision });
      }
      const nextRevision = currentRevision + 1;
      const nextDocument = { ...document, revision: nextRevision, mapId };
      let id: string;
      if (current.length) {
        id = String(current[0].id);
        await manager.query(
          `UPDATE campus_plan_document SET schema_version=2,document=$1::jsonb,
           revision=$2,updated_by=$3,updated_at=now() WHERE id=$4`,
          [JSON.stringify(nextDocument),nextRevision,userId,id],
        );
      } else {
        const inserted = await manager.query(
          `INSERT INTO campus_plan_document
           (campus_id,map_id,schema_version,document,revision,created_by,updated_by)
           VALUES ($1,$2,2,$3::jsonb,$4,$5,$5) RETURNING id`,
          [campusId,mapId,JSON.stringify(nextDocument),nextRevision,userId],
        );
        id = String(inserted[0].id);
      }
      return { id, campusId, mapId, schemaVersion: 2, revision: nextRevision, document: nextDocument };
    });
  }

  private validatePlanDocument(document: Record<string, unknown>, mapId: string) {
    if (Number(document.schemaVersion) !== 2) throw new BadRequestException('仅支持 schemaVersion 2 的二维平面编辑文档');
    if (String(document.mapId) !== mapId) throw new BadRequestException('平面编辑文档 mapId 与请求地图不一致');
    if (document.coordinateSystem !== 'campus-plan-pixel') throw new BadRequestException('平面编辑文档坐标系无效');
    const collections = ['buildings', 'areas', 'roads', 'objects'];
    for (const key of collections) {
      const value = document[key];
      if (value !== undefined && !Array.isArray(value)) throw new BadRequestException(`${key} 必须是数组`);
      if (Array.isArray(value) && value.length > 20000) throw new BadRequestException(`${key} 数量超限`);
    }
    const calibration = document.calibration as Record<string, unknown> | null;
    if (calibration && (!Number.isFinite(Number(calibration.a)) || !Number.isFinite(Number(calibration.b)) ||
      !Number.isFinite(Number(calibration.tx)) || !Number.isFinite(Number(calibration.ty)))) {
      throw new BadRequestException('底图校准参数无效');
    }
    const referenceImage = document.referenceImage as Record<string, unknown> | null;
    if (referenceImage && (typeof referenceImage.assetId !== 'string' || referenceImage.assetId.trim().length === 0 || referenceImage.assetId.length > 128)) {
      throw new BadRequestException('持久化底图必须引用有效的地图资源 ID');
    }
  }

  async findIndoorBuilding(userId: string, campusId: string, mapId: string, buildingId: string) {
    await this.requireRole(userId, campusId, ['owner','admin','editor','viewer']);
    await this.requireMap(campusId, mapId);
    this.validateBuildingKey(buildingId);
    const rows = await this.db.query(
      `SELECT id,campus_id,map_id,building_key,schema_version,definition,revision,created_at,updated_at
       FROM campus_indoor_building_layout
       WHERE campus_id=$1 AND map_id=$2 AND building_key=$3`,
      [campusId,mapId,buildingId],
    );
    if (!rows.length) return { campusId, mapId, buildingId, schemaVersion: 1, revision: 0, definition: null };
    return rows[0];
  }

  async saveIndoorBuilding(
    userId: string,
    campusId: string,
    mapId: string,
    buildingId: string,
    dto: SaveIndoorBuildingDto,
  ) {
    await this.requireRole(userId, campusId, ['owner','admin','editor']);
    this.validateBuildingKey(buildingId);
    this.validateIndoorDefinition(dto.definition, buildingId);

    return this.db.transaction(async (manager) => {
      const maps = await manager.query(
        'SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2 FOR UPDATE',
        [mapId,campusId],
      );
      if (!maps.length) throw new NotFoundException('地图项目不存在');
      const current = await manager.query(
        `SELECT id,revision FROM campus_indoor_building_layout
         WHERE campus_id=$1 AND map_id=$2 AND building_key=$3 FOR UPDATE`,
        [campusId,mapId,buildingId],
      );
      const currentRevision = current.length ? Number(current[0].revision) : 0;
      if (currentRevision !== dto.revision) {
        throw new ConflictException({
          message: '建筑室内布局版本冲突，请重新加载后再保存',
          currentRevision,
        });
      }

      const nextRevision = currentRevision + 1;
      const definition = { ...dto.definition, id: buildingId, schemaVersion: 1 };
      let id: string;
      if (current.length) {
        id = String(current[0].id);
        await manager.query(
          `UPDATE campus_indoor_building_layout
           SET definition=$1::jsonb,revision=$2,updated_by=$3,updated_at=now()
           WHERE id=$4`,
          [JSON.stringify(definition),nextRevision,userId,id],
        );
      } else {
        const inserted = await manager.query(
          `INSERT INTO campus_indoor_building_layout
           (campus_id,map_id,building_key,schema_version,definition,revision,created_by,updated_by)
           VALUES ($1,$2,$3,1,$4::jsonb,$5,$6,$6) RETURNING id`,
          [campusId,mapId,buildingId,JSON.stringify(definition),nextRevision,userId],
        );
        id = String(inserted[0].id);
      }

      await manager.query(
        `INSERT INTO campus_indoor_building_layout_version
         (layout_id,revision,definition,created_by)
         VALUES ($1,$2,$3::jsonb,$4)`,
        [id,nextRevision,JSON.stringify(definition),userId],
      );
      return { id, campusId, mapId, buildingId, schemaVersion: 1, revision: nextRevision, definition };
    });
  }

  async findIndoorBuildingVersions(userId: string, campusId: string, mapId: string, buildingId: string) {
    await this.requireRole(userId, campusId, ['owner','admin','editor','viewer']);
    await this.requireMap(campusId, mapId);
    this.validateBuildingKey(buildingId);
    return this.db.query(
      `SELECT v.revision,v.created_by,v.created_at
       FROM campus_indoor_building_layout_version v
       JOIN campus_indoor_building_layout l ON l.id=v.layout_id
       WHERE l.campus_id=$1 AND l.map_id=$2 AND l.building_key=$3
       ORDER BY v.revision DESC LIMIT 100`,
      [campusId,mapId,buildingId],
    );
  }

  private validateBuildingKey(buildingId: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(buildingId)) {
      throw new BadRequestException('建筑 ID 格式无效');
    }
  }

  private validateIndoorDefinition(definition: Record<string, unknown>, buildingId: string) {
    if (String(definition.id || '') !== buildingId) {
      throw new BadRequestException('室内布局建筑 ID 与请求路径不一致');
    }
    if (!Number.isFinite(Number(definition.floorHeight)) || Number(definition.floorHeight) < 2.5 || Number(definition.floorHeight) > 10) {
      throw new BadRequestException('建筑层高必须在 2.5 至 10 之间');
    }
    const floors = definition.floors;
    if (!Array.isArray(floors) || floors.length < 1 || floors.length > 30) {
      throw new BadRequestException('建筑楼层数量必须在 1 至 30 之间');
    }
    if (Buffer.byteLength(JSON.stringify(definition), 'utf8') > 5 * 1024 * 1024) {
      throw new BadRequestException('建筑室内布局文档不能超过 5 MB');
    }
    const levels = new Set<number>();
    for (const floor of floors as Array<Record<string, unknown>>) {
      const level = Number(floor.level);
      const width = Number(floor.width);
      const depth = Number(floor.depth);
      if (!Number.isInteger(level) || level < 1 || level > 30 || levels.has(level)) {
        throw new BadRequestException('楼层编号无效或重复');
      }
      levels.add(level);
      if (!Number.isFinite(width) || !Number.isFinite(depth) || width < 4 || depth < 4 || width > 500 || depth > 500) {
        throw new BadRequestException(`楼层 ${level} 尺寸必须在 4 至 500 之间`);
      }
      for (const key of ['rooms', 'walls', 'doors']) {
        const value = floor[key];
        if (value !== undefined && (!Array.isArray(value) || value.length > 1000)) {
          throw new BadRequestException(`楼层 ${level} 的 ${key} 数据格式无效或数量超限`);
        }
      }
      if (floors.length > 1 && !floor.stairPoint) {
        throw new BadRequestException('多层建筑的每个楼层都必须配置楼梯连接点');
      }
      const stair = floor.stairPoint as Record<string, unknown> | undefined;
      if (stair && (!Number.isFinite(Number(stair.x)) || !Number.isFinite(Number(stair.z)))) {
        throw new BadRequestException(`楼层 ${level} 楼梯坐标无效`);
      }
    }
    const stairFloors = (floors as Array<Record<string, unknown>>).filter((floor) => floor.stairPoint) as Array<Record<string, any>>;
    if (stairFloors.length > 1) {
      const first = stairFloors[0].stairPoint;
      for (const floor of stairFloors.slice(1)) {
        const point = floor.stairPoint;
        if (Math.hypot(Number(point.x) - Number(first.x), Number(point.z) - Number(first.z)) > 0.25) {
          throw new BadRequestException(`楼层 ${floor.level} 的楼梯连接点未与其他楼层对齐`);
        }
      }
    }
  }

  async findRpgMap(userId: string, campusId: string, mapId: string) {
    await this.requireRole(userId, campusId, ['owner','admin','editor','viewer']);
    await this.requireMap(campusId, mapId);
    const rows = await this.db.query(
      `SELECT id,campus_id,map_id,schema_version,document,revision,created_at,updated_at
       FROM campus_rpg_map WHERE campus_id=$1 AND map_id=$2`,
      [campusId,mapId],
    );
    if (!rows.length) return { campusId, mapId, schemaVersion: 1, revision: 0, document: null };
    return rows[0];
  }

  async saveRpgMap(userId: string, campusId: string, mapId: string, revision: number, document: Record<string, unknown>) {
    await this.requireRole(userId, campusId, ['owner','admin','editor']);
    this.validateRpgDocument(document, mapId);
    return this.db.transaction(async (manager) => {
      const maps = await manager.query(
        'SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2 FOR UPDATE',
        [mapId,campusId],
      );
      if (!maps.length) throw new NotFoundException('地图项目不存在');
      const current = await manager.query(
        'SELECT id,revision FROM campus_rpg_map WHERE campus_id=$1 AND map_id=$2 FOR UPDATE',
        [campusId,mapId],
      );
      const currentRevision = current.length ? Number(current[0].revision) : 0;
      if (currentRevision !== revision) {
        throw new ConflictException({ message: '二维地图版本冲突，请重新加载后再保存', currentRevision });
      }
      const nextRevision = currentRevision + 1;
      const nextDocument = { ...document, revision: nextRevision, mapId };
      let id: string;
      if (current.length) {
        id = String(current[0].id);
        await manager.query(
          `UPDATE campus_rpg_map SET schema_version=1,document=$1::jsonb,
           revision=$2,updated_by=$3,updated_at=now() WHERE id=$4`,
          [JSON.stringify(nextDocument),nextRevision,userId,id],
        );
      } else {
        const inserted = await manager.query(
          `INSERT INTO campus_rpg_map
           (campus_id,map_id,schema_version,document,revision,created_by,updated_by)
           VALUES ($1,$2,1,$3::jsonb,$4,$5,$5) RETURNING id`,
          [campusId,mapId,JSON.stringify(nextDocument),nextRevision,userId],
        );
        id = String(inserted[0].id);
      }
      return { id, campusId, mapId, schemaVersion: 1, revision: nextRevision, document: nextDocument };
    });
  }

  private validateRpgDocument(document: Record<string, unknown>, mapId: string) {
    if (Number(document.schemaVersion) !== 1) throw new BadRequestException('仅支持 schemaVersion 1 的二维地图文档');
    if (String(document.mapId) !== mapId) throw new BadRequestException('二维地图文档 mapId 与请求地图不一致');
    const grid = document.grid as Record<string, unknown> | undefined;
    const width = Number(grid?.width);
    const height = Number(grid?.height);
    if (!Number.isInteger(width) || width < 1 || width > 512 || !Number.isInteger(height) || height < 1 || height > 512) {
      throw new BadRequestException('地图网格尺寸必须在 1 至 512 之间');
    }
    if (!Array.isArray(document.layers) || document.layers.length > 32) throw new BadRequestException('地图图层格式无效或数量超限');
    const layerIds = new Set<string>();
    for (const layer of document.layers as Array<Record<string, unknown>>) {
      const id = String(layer?.id || '');
      if (!id || layerIds.has(id)) throw new BadRequestException('图层 ID 缺失或重复');
      layerIds.add(id);
      if (layer.type !== 'tile') continue;
      const tiles = layer.tiles;
      if (!Array.isArray(tiles) || tiles.length !== height || tiles.some((row) => !Array.isArray(row) || row.length !== width)) {
        throw new BadRequestException(`图层 ${id} 的瓦片网格尺寸不匹配`);
      }
      for (const row of tiles as unknown[][]) {
        for (const tile of row) {
          if (tile !== null && (typeof tile !== 'string' || tile.length > 64)) throw new BadRequestException('瓦片 ID 格式无效');
        }
      }
    }
    if (!Array.isArray(document.objects) || document.objects.length > 20000) throw new BadRequestException('地图对象格式无效或数量超限');
    for (const object of document.objects as Array<Record<string, unknown>>) {
      if (!Number.isFinite(Number(object.x)) || !Number.isFinite(Number(object.y)) ||
          Number(object.x) < 0 || Number(object.y) < 0 || Number(object.x) >= width || Number(object.y) >= height) {
        throw new BadRequestException('装饰对象坐标超出地图范围');
      }
    }
  }

  private validateDocument(document: Record<string, unknown>, mapId: string) {
    if (Number(document.schemaVersion) !== 2) throw new BadRequestException('仅支持 schemaVersion 2 的三维场景文档');
    if (String(document.mapId) !== mapId) throw new BadRequestException('场景文档 mapId 与请求地图不一致');
    if (!Array.isArray(document.objects)) throw new BadRequestException('场景文档 objects 必须是数组');
    const objectIds = new Set<string>();
    for (const item of document.objects as Array<Record<string, unknown>>) {
      if (!item || typeof item !== 'object') throw new BadRequestException('场景对象格式无效');
      const id = String(item.id || '');
      const featureId = String(item.featureId || '');
      if (!id || objectIds.has(id)) throw new BadRequestException('场景对象 ID 缺失或重复');
      objectIds.add(id);
      if (!OBJECT_TYPES.has(String(item.type))) throw new BadRequestException(`不支持的场景对象类型：${item.type}`);
      if (!/^\d+$/.test(featureId)) throw new BadRequestException(`场景对象 ${id} 必须关联有效 GIS Feature ID`);
    }
  }

  private async requireMap(campusId: string, mapId: string) {
    const rows = await this.db.query('SELECT id FROM campus_map WHERE id=$1 AND campus_id=$2',[mapId,campusId]);
    if (!rows.length) throw new NotFoundException('地图项目不存在');
  }

  private async requireRole(userId: string, campusId: string, allowed: string[]) {
    const rows = await this.db.query('SELECT role FROM campus_member WHERE campus_id=$1 AND user_id=$2',[campusId,userId]);
    if (!rows.length) throw new NotFoundException('学校不存在或无权访问');
    if (!allowed.includes(rows[0].role)) throw new ForbiddenException('当前角色无权执行此操作');
  }
}
