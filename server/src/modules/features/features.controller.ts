import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ParseBigIntIdPipe } from '../../common/parse-bigint-id.pipe';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';
import { FeaturesService } from './features.service';
@ApiTags('features') @Controller('campuses/:campusId/maps/:mapId/features') @UseGuards(DevIdentityGuard)
export class FeaturesController {
  constructor(private readonly service:FeaturesService) {}
  @Post() @ApiOperation({summary:'创建地图空间要素'})
  create(@Req()req:Request&{user:{id:string}},@Param('campusId',ParseBigIntIdPipe)c:string,@Param('mapId',ParseBigIntIdPipe)m:string,@Body()dto:CreateFeatureDto) { return this.service.create(req.user.id,c,m,dto); }
  @Get() @ApiOperation({summary:'获取地图空间要素'})
  findAll(@Req()req:Request&{user:{id:string}},@Param('campusId',ParseBigIntIdPipe)c:string,@Param('mapId',ParseBigIntIdPipe)m:string) { return this.service.findAll(req.user.id,c,m); }
  @Put(':featureId') @ApiOperation({summary:'按 revision 更新空间要素'})
  update(@Req()req:Request&{user:{id:string}},@Param('campusId',ParseIntPipe)c:number,@Param('mapId',ParseIntPipe)m:number,@Param('featureId',ParseBigIntIdPipe)f:string,@Body()dto:UpdateFeatureDto) { return this.service.update(req.user.id,String(c),String(m),f,dto); }
  @Delete(':featureId') @ApiOperation({summary:'按 revision 删除空间要素'})
  remove(@Req()req:Request&{user:{id:string}},@Param('campusId',ParseIntPipe)c:number,@Param('mapId',ParseIntPipe)m:number,@Param('featureId',ParseBigIntIdPipe)f:string,@Query('revision',ParseIntPipe)revision:number) { return this.service.remove(req.user.id,String(c),String(m),f,revision); }
}