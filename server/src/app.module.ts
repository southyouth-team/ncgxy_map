import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampusesModule } from './modules/campuses/campuses.module';
import { FeaturesModule } from './modules/features/features.module';
import { HealthModule } from './modules/health/health.module';
import { LayersModule } from './modules/layers/layers.module';
import { MapsModule } from './modules/maps/maps.module';
import { AssetsModule } from './modules/assets/assets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
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
        retryAttempts: 5,
        retryDelay: 3000,
      }),
    }),
    HealthModule,
    CampusesModule,
    MapsModule,
    LayersModule,
    FeaturesModule,
    AssetsModule,
  ],
})
export class AppModule {}
