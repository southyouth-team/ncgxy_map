import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { CampusesModule } from './modules/campuses/campuses.module';
import { FeaturesModule } from './modules/features/features.module';
import { HealthModule } from './modules/health/health.module';
import { LayersModule } from './modules/layers/layers.module';
import { MapsModule } from './modules/maps/maps.module';
import { AssetsModule } from './modules/assets/assets.module';
import { ScenesModule } from './modules/scenes/scenes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        // 开发环境启动时自动补齐尚未执行的版本化迁移；生产环境必须由发布流程显式执行。
        const migrationsRun = config.get<string>(
          'DB_MIGRATIONS_RUN',
          nodeEnv === 'production' ? 'false' : 'true',
        ) === 'true';

        return {
          type: 'postgres' as const,
          host: config.get<string>('DB_HOST', '127.0.0.1'),
          port: Number(config.get<string>('DB_PORT', '5432')),
          username: config.get<string>('DB_USER', 'postgres'),
          password: config.get<string>('DB_PASSWORD', ''),
          database: config.get<string>('DB_NAME', 'ncgxy_campus_map'),
          ssl: config.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: true } : false,
          logging: config.get<string>('DB_LOGGING') === 'true',
          autoLoadEntities: true,
          synchronize: false,
          migrations: [join(__dirname, 'database/migrations/*{.ts,.js}')],
          migrationsRun,
          retryAttempts: 5,
          retryDelay: 3000,
        };
      },
    }),
    HealthModule,
    CampusesModule,
    MapsModule,
    LayersModule,
    FeaturesModule,
    AssetsModule,
    ScenesModule,
  ],
})
export class AppModule {}
