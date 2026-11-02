import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { LayersController } from './layers.controller';
import { LayersService } from './layers.service';

@Module({
  controllers: [LayersController],
  providers: [LayersService, DevIdentityGuard],
})
export class LayersModule {}
