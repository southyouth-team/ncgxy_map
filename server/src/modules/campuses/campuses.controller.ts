import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { CampusesService } from './campuses.service';
import { CreateCampusDto } from './dto/create-campus.dto';
@ApiTags('campuses') @Controller('campuses') @UseGuards(DevIdentityGuard)
export class CampusesController {
  constructor(private readonly service: CampusesService) {}
  @Post() @ApiOperation({ summary: '创建学校并将当前用户设为 owner' })
  create(@Req() req: Request & {user:{id:string}}, @Body() dto: CreateCampusDto) { return this.service.create(req.user.id,dto); }
  @Get() @ApiOperation({ summary: '查询当前用户可访问的学校' })
  findAll(@Req() req: Request & {user:{id:string}}) { return this.service.findAll(req.user.id); }
}