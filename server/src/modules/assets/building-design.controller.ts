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
  @ApiOperation({ summary: '用户确认场景资产参考图预览并签发一次性识别凭证' })
  approve(@Body('imageDataUrl') imageDataUrl: string) {
    return this.service.approveReference(imageDataUrl);
  }

  @Post('reconstruct-object')
  @ApiOperation({ summary: '从已确认参考图生成受约束的 ObjectSculptSpec 组件树' })
  reconstructObject(
    @Body('category') category: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
    @Body('imageDataUrl') imageDataUrl: string,
    @Body('approvalToken') approvalToken: string,
    @Body('prompt') prompt?: string,
  ) {
    return this.service.reconstructObjectReference(category, objectType, visualStyle, imageDataUrl, approvalToken, prompt);
  }

  @Post('review-object-design')
  @ApiOperation({ summary: '审核编辑后的 ObjectSculptSpec 组件树并签发最终发布凭证' })
  reviewObjectDesign(
    @Body('design') design: Record<string, unknown>,
    @Body('designToken') designToken: string,
    @Body('objectSculptSpec') objectSculptSpec: Record<string, unknown>,
  ) {
    return this.service.reviewObjectDesign(design, designToken, objectSculptSpec);
  }

  @Post('modify-object')
  @ApiOperation({ summary: '对选中组件执行受约束的 AI 局部修改' })
  modifyObject(
    @Body('objectSculptSpec') objectSculptSpec: Record<string, unknown>,
    @Body('selectedNodeIds') selectedNodeIds: string[],
    @Body('instruction') instruction: string,
  ) {
    return this.service.modifyObjectDesign(objectSculptSpec, selectedNodeIds, instruction);
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

  @Post('review-scene')
  @ApiOperation({ summary: '审核并编辑通用场景结构参数，签发最终模板发布凭证' })
  reviewScene(
    @Body('category') category: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
    @Body('design') design: Record<string, unknown>,
    @Body('designToken') designToken: string,
    @Body('geometry') geometry: Record<string, unknown>,
  ) {
    return this.service.reviewSceneDesign(category, objectType, visualStyle, design, designToken, geometry);
  }

}
