import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { BuildingTemplatesService } from './building-templates.service';

@ApiTags('building-templates')
@Controller('assets/building-templates')
export class BuildingTemplatesController {
  constructor(private readonly service: BuildingTemplatesService) {}
  @Get()
  @ApiOperation({ summary: '获取独立建筑模板库' })
  list() { return this.service.list(); }
  @Get(':templateId')
  get(@Param('templateId') id: string) { return this.service.get(id); }
  @Post()
  @UseGuards(DevIdentityGuard)
  @ApiOperation({ summary: '创建独立建筑模板草稿，不关联校园 Feature' })
  create(@Body() body: Record<string, unknown>) { return this.service.create(body); }
  @Patch(':templateId/approve')
  @UseGuards(DevIdentityGuard)
  @ApiOperation({ summary: '审核通过并发布独立建筑模板' })
  approve(@Param('templateId') id: string) { return this.service.approve(id); }
}
