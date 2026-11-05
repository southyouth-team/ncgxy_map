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

  @Post('repair-object')
  @ApiOperation({ summary: '根据 Runtime 校验反馈定向修复 ObjectSculptSpec' })
  repairObject(
    @Body('objectSculptSpec') objectSculptSpec: unknown,
    @Body('validationError') validationError: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
  ) {
    return this.service.repairObjectFromValidation(objectSculptSpec, validationError, objectType, visualStyle);
  }

  @Post('reconstruct-object')
  @ApiOperation({ summary: '根据真实参考图片与补充提示词重建 ObjectSculptSpec' })
  reconstructObject(
    @Body('imageDataUrl') imageDataUrl: string,
    @Body('prompt') prompt: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
  ) {
    return this.service.reconstructObjectFromImage(imageDataUrl, prompt, objectType, visualStyle);
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
