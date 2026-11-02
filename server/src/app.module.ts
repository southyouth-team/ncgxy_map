import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './modules/health/health.module';

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
    // 当前仓库中的学校、地图、图层和要素 HTTP 模块尚未完整落盘。
    // 先只注册已具备完整 Controller/Module 的健康检查，避免启动时引用不存在模块。
    HealthModule,
  ],
})
export class AppModule {}
