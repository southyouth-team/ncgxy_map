import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ParseBigIntIdPipe } from '../../common/parse-bigint-id.pipe';
import { CreateLayerDto } from './dto/create-layer.dto';
import { UpdateLayerDto } from './dto/update-layer.dto';
import { LayersService } from './layers.service';
@ApiTags('layers') @Controller('campuses/:campusId/maps/:mapId/layers') @UseGuards(DevIdentityGuard)
export class LayersController {
  constructor(private readonly service:LayersService) {}
  @Post() @ApiOperation({summary:'创建地图图层'})
  create(@Req() req:Request&{user:{id:string}},@Param('campusId',ParseBigIntIdPipe)c:string,@Param('mapId',ParseBigIntIdPipe)m:string,@Body()dto:CreateLayerDto) { return this.service.create(req.user.id,c,m,dto); }
  @Get() @ApiOperation({summary:'获取地图图层'})
  findAll(@Req() req:Request&{user:{id:string}},@Param('campusId',ParseIntPipe)c:number,@Param('mapId',ParseIntPipe)m:number) { return this.service.findAll(req.user.id,String(c),String(m)); }
  @Put(':layerId') @ApiOperation({summary:'更新地图图层'})
  update(@Req() req:Request&{user:{id:string}},@Param('campusId',ParseIntPipe)c:number,@Param('mapId',ParseIntPipe)m:number,@Param('layerId',ParseBigIntIdPipe)l:string,@Body()dto:UpdateLayerDto) { return this.service.update(req.user.id,String(c),String(m),l,dto); }
  @Delete(':layerId') @ApiOperation({summary:'删除地图图层'})
  remove(@Req() req:Request&{user:{id:string}},@Param('campusId',ParseIntPipe)c:number,@Param('mapId',ParseIntPipe)m:number,@Param('layerId',ParseIntPipe)l:number) { return this.service.remove(req.user.id,String(c),String(m),String(l)); }
}