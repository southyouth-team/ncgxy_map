import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ParseBigIntIdPipe } from '../../common/parse-bigint-id.pipe';
import { SaveSceneDto } from './dto/save-scene.dto';
import { SaveRpgMapDto } from './dto/save-rpg-map.dto';
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
