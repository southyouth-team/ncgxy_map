import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ParseBigIntIdPipe } from '../../common/parse-bigint-id.pipe';
import { SaveSceneDto } from './dto/save-scene.dto';
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
