import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { Response } from 'express';
import { createReadStream } from 'node:fs';
import type { UploadedAsset } from './assets.service';
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
  @Get(':templateId/files/:role')
  async getFile(@Param('templateId') id: string, @Param('role') role: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.service.getFile(id, role);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', file.size);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(file.absolutePath));
  }
  @Post(':templateId/files/:role')
  @UseGuards(DevIdentityGuard)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024, files: 1 } }))
  upload(@Param('templateId') id: string, @Param('role') role: string, @UploadedFile() file?: UploadedAsset) {
    if (!file) throw new BadRequestException('请上传 file 文件');
    return this.service.uploadFile(id, role, file);
  }
  @Patch(':templateId/approve')
  @UseGuards(DevIdentityGuard)
  @ApiOperation({ summary: '审核通过并发布独立建筑模板' })
  approve(@Param('templateId') id: string) { return this.service.approve(id); }
}
