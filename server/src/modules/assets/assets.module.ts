import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { RecognitionService } from './recognition.service';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, RecognitionService, DevIdentityGuard],
})
export class AssetsModule {}
