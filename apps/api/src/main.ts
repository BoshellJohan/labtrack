import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Env } from './config/env';
import { configureApp } from './common/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }),
    credentials: false,
  });
  configureApp(app);

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
