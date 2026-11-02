import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('/health')
  @ApiOperation({ summary: '进程存活检查' })
  health() {
    return { code: 0, message: 'ok', data: this.healthService.health() };
  }

  @Get('/ready')
  @ApiOperation({ summary: '数据库与 PostGIS 就绪检查' })
  ready() {
    return this.healthService.ready();
  }
}
