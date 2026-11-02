import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';

@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService, DevIdentityGuard],
})
export class FeaturesModule {}
