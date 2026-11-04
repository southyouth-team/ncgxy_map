import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  // Nest 默认 Express JSON parser 上限为 100 KiB；空间编辑文档包含完整 FeatureCollection，
  // 必须将请求体上限与 ScenesService 的 15 MiB 文档校验上限对齐。
  // 关闭 Nest 默认 parser 后显式注册，避免默认 parser 先行拦截请求。
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '16mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
  const config = app.get(ConfigService);

  app.setGlobalPrefix(config.get<string>('API_PREFIX', 'api/v1'), {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:5173')
      .split(',')
      .map((value) => value.trim()),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Campus Map API')
      .setDescription('Multi-campus map platform API')
      .setVersion('1.0')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  await app.listen(Number(config.get<string>('PORT', '3001')), '0.0.0.0');
}
void bootstrap();
