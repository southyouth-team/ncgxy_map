import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { BuildingDesignService } from './building-design.service';

@ApiTags('assets')
@Controller('assets/ai-image')
@UseGuards(DevIdentityGuard)
export class BuildingDesignController {
  constructor(private readonly service: BuildingDesignService) {}

  @Post('analyze-building')
  @ApiOperation({ summary: '识别建筑参考图并提取参数化 3D 建模参数' })
  analyze(@Body('imageDataUrl') imageDataUrl: string) {
    return this.service.analyzeReference(imageDataUrl);
  }
}
