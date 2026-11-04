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
}
