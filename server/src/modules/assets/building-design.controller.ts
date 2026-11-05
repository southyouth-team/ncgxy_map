import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { BuildingDesignService } from './building-design.service';

@ApiTags('assets')
@Controller('assets/ai-image')
@UseGuards(DevIdentityGuard)
export class BuildingDesignController {
  constructor(private readonly service: BuildingDesignService) {}

  @Post('approve-reference')
  @ApiOperation({ summary: '用户确认建筑参考图预览并签发一次性识别凭证' })
  approve(@Body('imageDataUrl') imageDataUrl: string) {
    return this.service.approveReference(imageDataUrl);
  }

  @Post('analyze-building')
  @ApiOperation({ summary: '识别建筑参考图并提取参数化 3D 建模参数' })
  analyze(@Body('imageDataUrl') imageDataUrl: string, @Body('approvalToken') approvalToken: string, @Body('prompt') prompt?: string) {
    return this.service.analyzeReference(imageDataUrl, approvalToken, prompt);
  }

  @Post('analyze-scene')
  @ApiOperation({ summary: '识别已确认的通用场景资产参考图并提取分类结构参数' })
  analyzeScene(
    @Body('category') category: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
    @Body('imageDataUrl') imageDataUrl: string,
    @Body('approvalToken') approvalToken: string,
    @Body('prompt') prompt?: string,
  ) {
    return this.service.analyzeSceneReference(category, objectType, visualStyle, imageDataUrl, approvalToken, prompt);
  }

}
