import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';

@Module({
  controllers: [MapsController],
  providers: [MapsService, DevIdentityGuard],
})
export class MapsModule {}
