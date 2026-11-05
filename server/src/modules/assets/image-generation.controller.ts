import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ImageGenerationService } from './image-generation.service';

@ApiTags('assets')
@Controller('assets/ai-image')
@UseGuards(DevIdentityGuard)
export class ImageGenerationController {
  constructor(private readonly service: ImageGenerationService) {}

  @Post('generate')
  @ApiOperation({ summary: '通过 OpenAI 兼容图片接口生成校园视觉素材' })
  generate(@Body('prompt') prompt: string) {
    return this.service.generate(prompt);
  }

  @Post('generate-object')
  @ApiOperation({ summary: '根据提示词直接生成受控 Three.js ObjectSculptSpec' })
  generateObject(
    @Body('prompt') prompt: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
  ) {
    return this.service.generateObjectFromPrompt(prompt, objectType, visualStyle);
  }
}
