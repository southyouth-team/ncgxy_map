import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { RecognitionService } from './recognition.service';
import { ImageGenerationController } from './image-generation.controller';
import { ImageGenerationService } from './image-generation.service';

@Module({
  controllers: [AssetsController, ImageGenerationController],
  providers: [AssetsService, RecognitionService, ImageGenerationService, DevIdentityGuard],
})
export class AssetsModule {}
