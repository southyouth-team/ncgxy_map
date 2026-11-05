import {
  BadRequestException, Body, Controller, Get, Param, Post, Req, Res,
  StreamableFile, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { AssetsService, UploadedAsset } from './assets.service';

@ApiTags('campus-visual-assets')
@Controller('assets/visual-assets')
export class VisualAssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get('manifest')
  @ApiOperation({ summary: '获取已审核并正式入库的校园视觉资产清单' })
  getManifest() {
    return this.service.getVisualAssetManifest();
  }

  @Post('objects')
  @UseGuards(DevIdentityGuard)
  @ApiOperation({ summary: '保存完整结构化 3D 资产（组件树、材质和参数 Schema）' })
  saveObject(@Req() req: Request & { user: { id: string } }, @Body() input: Record<string, unknown>) {
    return this.service.saveObjectSculptAsset(req.user.id, input);
  }

  @Get('objects/:assetId')
  @UseGuards(DevIdentityGuard)
  @ApiOperation({ summary: '读取用户保存的完整结构化 3D 资产' })
  getObject(@Req() req: Request & { user: { id: string } }, @Param('assetId') assetId: string) {
    return this.service.getObjectSculptAsset(req.user.id, assetId);
  }

  @Get(':fileId/content')
  @ApiOperation({ summary: '读取已正式入库的校园视觉素材' })
  async getContent(@Param('fileId') fileId: string, @Res({ passthrough: true }) response: Response) {
    const asset = await this.service.getVisualAssetContent(fileId);
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', asset.size);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(asset.absolutePath));
  }

  @Post()
  @UseGuards(DevIdentityGuard)
  @ApiOperation({ summary: '审核通过后上传并自动登记校园视觉素材' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(
    @Req() req: Request & { user: { id: string } },
    @Body() metadata: Record<string, unknown>,
    @UploadedFile() file?: UploadedAsset,
  ) {
    if (!file) throw new BadRequestException('请上传素材文件，字段名为 file');
    return this.service.uploadVisualAsset(req.user.id, file, metadata);
  }
}
