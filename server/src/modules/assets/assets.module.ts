import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { RecognitionService } from './recognition.service';
import { ImageGenerationController } from './image-generation.controller';
import { ImageGenerationService } from './image-generation.service';
import { VisualAssetsController } from './visual-assets.controller';
import { BuildingDesignController } from './building-design.controller';
import { BuildingDesignService } from './building-design.service';

@Module({
  controllers: [AssetsController, ImageGenerationController, VisualAssetsController, BuildingDesignController],
  providers: [AssetsService, RecognitionService, ImageGenerationService, BuildingDesignService, DevIdentityGuard],
})
export class AssetsModule {}
