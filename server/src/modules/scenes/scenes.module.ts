import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';

@Module({
  controllers: [ScenesController],
  providers: [ScenesService, DevIdentityGuard],
})
export class ScenesModule {}
