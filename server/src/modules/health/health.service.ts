import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  health() {
    return { service: 'ncgxy-campus-map-api', status: 'ok' };
  }

  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
      const rows = await this.dataSource.query(
        "SELECT extversion FROM pg_extension WHERE extname = 'postgis'",
      );
      if (!rows.length) {
        throw new Error('PostGIS extension is not installed');
      }
      return {
        code: 0,
        message: 'ready',
        data: { database: 'connected', postgis: rows[0].extversion },
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 50301,
        message: '数据库或 PostGIS 尚未就绪',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}
