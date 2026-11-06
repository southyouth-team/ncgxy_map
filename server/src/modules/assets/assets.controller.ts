import {
  Controller, Get, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors,
  BadRequestException, StreamableFile, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ParseBigIntIdPipe } from '../../common/parse-bigint-id.pipe';
import { AssetsService, UploadedAsset } from './assets.service';
import { RecognitionService } from './recognition.service';

@ApiTags('assets')
@Controller('campuses/:campusId/maps/:mapId/assets')
@UseGuards(DevIdentityGuard)
export class AssetsController {
  constructor(private readonly service: AssetsService, private readonly recognition: RecognitionService) {}

  @Get()
  @ApiOperation({ summary: '获取地图底图资源列表' })
  findAll(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
  ) {
    return this.service.findAll(req.user.id, campusId, mapId);
  }

  @Post('base-map')
  @ApiOperation({ summary: '上传并持久化校园底图' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  async uploadBaseMap(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @UploadedFile() file?: UploadedAsset,
  ) {
    if (!file) throw new BadRequestException('请上传底图文件，字段名为 file');
    return this.service.uploadBaseMap(req.user.id, campusId, mapId, file);
  }

  @Post(':assetId/recognize')
  @ApiOperation({ summary: '调用视觉模型识别校园底图并返回待复核矢量要素' })
  recognize(@Req() req: Request & { user: { id: string } }, @Param('campusId', ParseBigIntIdPipe) campusId: string, @Param('mapId', ParseBigIntIdPipe) mapId: string, @Param('assetId') assetId: string) {
    return this.recognition.recognize(req.user.id, campusId, mapId, assetId);
  }

  @Get('recognition/:jobId')
  @ApiOperation({ summary: '查询校园底图 AI 识图任务状态与结果' })
  getRecognition(@Req() req: Request & { user: { id: string } }, @Param('campusId', ParseBigIntIdPipe) campusId: string, @Param('mapId', ParseBigIntIdPipe) mapId: string, @Param('jobId') jobId: string) {
    return this.recognition.getJob(req.user.id, campusId, mapId, jobId);
  }

  @Get(':assetId/content')
  @ApiOperation({ summary: '读取已上传的校园底图文件' })
  async getContent(
    @Req() req: Request & { user: { id: string } },
    @Param('campusId', ParseBigIntIdPipe) campusId: string,
    @Param('mapId', ParseBigIntIdPipe) mapId: string,
    @Param('assetId') assetId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const asset = await this.service.getBaseMap(req.user.id, campusId, mapId, assetId);
    response.setHeader('Content-Type', asset.mime_type);
    response.setHeader('Content-Length', asset.file_size);
    response.setHeader('Content-Disposition', 'inline; filename="base-map"');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(asset.absolute_path));
  }
}
