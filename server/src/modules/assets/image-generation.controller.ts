import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
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


  @Post('modify-object')
  @ApiOperation({ summary: '根据选中部件或整体模型范围执行 AI 微调' })
  modifyObject(
    @Body('objectSculptSpec') objectSculptSpec: unknown,
    @Body('selectedNodeIds') selectedNodeIds: unknown,
    @Body('instruction') instruction: string,
  ) {
    return this.service.modifyObjectFromInstruction(objectSculptSpec, selectedNodeIds, instruction);
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

  @Post('generate-procedural-object')
  @ApiOperation({ summary: '生成可编辑的 Three.js 程序化模型源码（不执行生成代码）' })
  generateProceduralObject(
    @Body('prompt') prompt: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
    @Body('imageDataUrl') imageDataUrl: string,
  ) {
    return this.service.generateProceduralObjectFromPrompt(prompt, objectType, visualStyle, imageDataUrl);
  }


  @Post('generate-procedural-object-stream')
  @ApiOperation({ summary: '一次性生成完整 Three.js 模型并通过 NDJSON 推送阶段进度' })
  async streamProceduralObject(
    @Body('prompt') prompt: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
    @Body('imageDataUrl') imageDataUrl: string,
    @Res() response: Response,
  ) {
    response.status(200);
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();
    try {
      await this.service.streamProceduralObjectBuild(
        prompt, objectType, visualStyle, imageDataUrl,
        event => {
          if (!response.writableEnded && !response.destroyed) {
            response.write(JSON.stringify(event) + '\n');
          }
        },
      );
    } catch (error) {
      if (!response.writableEnded && !response.destroyed) {
        response.write(JSON.stringify({
          type: 'error',
          stage: 'server',
          message: error instanceof Error ? error.message : '完整模型生成失败',
        }) + '\n');
      }
    } finally {
      if (!response.writableEnded) response.end();
    }
  }

  @Post('inspect-procedural-object')
  @ApiOperation({ summary: '基于 Three.js 多视角渲染截图执行 AI 视觉质量检测' })
  inspectProceduralObject(
    @Body('prompt') prompt: string,
    @Body('objectType') objectType: string,
    @Body('referenceImageDataUrl') referenceImageDataUrl: string,
    @Body('screenshots') screenshots: unknown,
    @Body('geometryDiagnostics') geometryDiagnostics: unknown,
  ) {
    return this.service.inspectProceduralModelVisualQuality(
      prompt, objectType, referenceImageDataUrl, screenshots, geometryDiagnostics,
    );
  }

  @Post('repair-procedural-collisions')
  @ApiOperation({ summary: '根据运行时碰撞诊断定向补齐模型碰撞声明' })
  repairProceduralCollisions(
    @Body('source') source: string,
    @Body('parameters') parameters: unknown,
    @Body('parameterValues') parameterValues: unknown,
    @Body('parts') parts: unknown,
    @Body('modelCapabilityManifest') modelCapabilityManifest: unknown,
    @Body('collisionReport') collisionReport: unknown,
    @Body('objectType') objectType: string,
  ) {
    return this.service.repairProceduralModelCollisions(
      source, parameters, parameterValues, parts, modelCapabilityManifest, collisionReport, objectType,
    );
  }

  @Post('modify-procedural-object')
  @ApiOperation({ summary: '通过对话修改 Three.js 程序化模型、动态参数和部件结构' })
  modifyProceduralObject(
    @Body('source') source: string,
    @Body('parameters') parameters: unknown,
    @Body('parameterValues') parameterValues: unknown,
    @Body('parts') parts: unknown,
    @Body('selectedPartId') selectedPartId: string,
    @Body('instruction') instruction: string,
    @Body('objectType') objectType: string,
    @Body('environmentBindings') environmentBindings: unknown,
    @Body('modelCapabilityManifest') modelCapabilityManifest: unknown,
    @Body('geometryDiagnostics') geometryDiagnostics: unknown,
  ) {
    return this.service.modifyProceduralObjectFromInstruction(
      source, parameters, parameterValues, parts, selectedPartId, instruction, objectType, environmentBindings, modelCapabilityManifest, geometryDiagnostics,
    );
  }

  @Post('generate-object')
  @ApiOperation({ summary: '根据提示词直接生成受控 Three.js ObjectSculptSpec' })
  generateObject(
    @Body('prompt') prompt: string,
    @Body('objectType') objectType: string,
    @Body('visualStyle') visualStyle: string,
    @Body('generationProfile') generationProfile: string,
  ) {
    return this.service.generateObjectFromPrompt(prompt, objectType, visualStyle, true, undefined, generationProfile);
  }
}
