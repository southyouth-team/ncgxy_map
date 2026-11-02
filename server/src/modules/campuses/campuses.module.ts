import { Module } from '@nestjs/common';
import { DevIdentityGuard } from '../../common/dev-identity.guard';
import { CampusesController } from './campuses.controller';
import { CampusesService } from './campuses.service';

@Module({
  controllers: [CampusesController],
  providers: [CampusesService, DevIdentityGuard],
})
export class CampusesModule {}
