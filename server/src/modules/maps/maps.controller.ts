import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ParseBigIntIdPipe } from '../../common/parse-bigint-id.pipe';
import { CreateMapDto } from './dto/create-map.dto';
import { UpdateMapConfigDto } from './dto/update-map-config.dto';
import { MapsService } from './maps.service';
@ApiTags('maps') @Controller('campuses/:campusId/maps') @UseGuards(DevIdentityGuard)
export class MapsController {
  constructor(private readonly service:MapsService) {}
  @Post() @ApiOperation({summary:'在学校下创建地图'})
  create(@Req() req:Request&{user:{id:string}},@Param('campusId',ParseBigIntIdPipe) campusId:string,@Body() dto:CreateMapDto) {
    return this.service.create(req.user.id,campusId,dto);
  }
  @Put(':mapId/config') @ApiOperation({summary:'更新地图坐标配置并校验版本'})
  updateConfig(@Req() req:Request&{user:{id:string}},@Param('campusId',ParseBigIntIdPipe) campusId:string,@Param('mapId',ParseBigIntIdPipe) mapId:string,@Body() dto:UpdateMapConfigDto) {
    return this.service.updateConfig(req.user.id,campusId,mapId,dto);
  }
  @Get() @ApiOperation({summary:'获取学校地图列表'})
  findAll(@Req() req:Request&{user:{id:string}},@Param('campusId',ParseBigIntIdPipe) campusId:string) {
    return this.service.findAll(req.user.id,campusId);
  }
}