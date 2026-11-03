import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ParseBigIntIdPipe } from '../../common/parse-bigint-id.pipe';
import { SaveSceneDto } from './dto/save-scene.dto';
import { SaveRpgMapDto } from './dto/save-rpg-map.dto';
import { SaveIndoorBuildingDto } from './dto/save-indoor-building.dto';
import { ScenesService } from './scenes.service';

@ApiTags('scenes')
@Controller('campuses/:campusId/maps/:mapId/scene')
@UseGuards(DevIdentityGuard)
export class ScenesController {
  constructor(private readonly service: ScenesService) {}

  @Get()
  @ApiOperation({ summary: '获取地图三维场景文档' })
  findOne(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
  ) {
    return this.service.findOne(req.user.id, campusId, mapId);
  }


  @Get('plan')
  @ApiOperation({ summary: '获取二维校园平面编辑文档' })
  findPlan(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
  ) {
    return this.service.findPlan(req.user.id, campusId, mapId);
  }

  @Put('plan')
  @ApiOperation({ summary: '保存二维校园平面编辑文档并执行版本冲突检测' })
  savePlan(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @Body() dto: SaveRpgMapDto,
  ) {
    return this.service.savePlan(req.user.id, campusId, mapId, dto.revision, dto.document);
  }

  @Get('indoor-buildings/:buildingId')
  @ApiOperation({ summary: '获取指定建筑室内布局及当前版本' })
  findIndoorBuilding(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @Param('buildingId') buildingId: string,
  ) {
    return this.service.findIndoorBuilding(req.user.id, campusId, mapId, buildingId);
  }

  @Put('indoor-buildings/:buildingId')
  @ApiOperation({ summary: '保存建筑室内布局并创建不可变版本快照' })
  saveIndoorBuilding(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @Param('buildingId') buildingId: string,
    @Body() dto: SaveIndoorBuildingDto,
  ) {
    return this.service.saveIndoorBuilding(req.user.id, campusId, mapId, buildingId, dto);
  }

  @Get('indoor-buildings/:buildingId/versions/:revision')
  @ApiOperation({ summary: '读取建筑室内布局指定历史版本快照' })
  findIndoorBuildingVersion(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @Param('buildingId') buildingId: string,
    @Param('revision', ParseBigIntIdPipe) revision: string,
  ) {
    return this.service.findIndoorBuildingVersion(req.user.id, campusId, mapId, buildingId, revision);
  }

  @Get('indoor-buildings/:buildingId/versions')
  @ApiOperation({ summary: '查询建筑室内布局历史版本' })
  findIndoorBuildingVersions(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @Param('buildingId') buildingId: string,
  ) {
    return this.service.findIndoorBuildingVersions(req.user.id, campusId, mapId, buildingId);
  }

  @Get('rpg')
  @ApiOperation({ summary: '获取二维 RPG 瓦片地图文档' })
  findRpgMap(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
  ) {
    return this.service.findRpgMap(req.user.id, campusId, mapId);
  }

  @Put('rpg')
  @ApiOperation({ summary: '保存二维 RPG 瓦片地图文档并执行版本冲突检测' })
  saveRpgMap(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @Body() dto: SaveRpgMapDto,
  ) {
    return this.service.saveRpgMap(req.user.id, campusId, mapId, dto.revision, dto.document);
  }

  @Put()
  @ApiOperation({ summary: '保存三维场景文档并校验 GIS Feature 关联及版本' })
  save(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @Body() dto: SaveSceneDto,
  ) {
    return this.service.save(req.user.id, campusId, mapId, dto);
  }
}
