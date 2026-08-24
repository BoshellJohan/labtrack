import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Env } from './config/env';
import { configureApp } from './common/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  const port = config.get('PORT', { infer: true });
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });

  app.enableCors({ origin: corsOrigin, credentials: false });
  configureApp(app);

  // Bound to 0.0.0.0 explicitly: container platforms route to the published
  // port on the container's external interface, and a process listening only on
  // a loopback address is unreachable from the proxy even though it started
  // cleanly.
  await app.listen(port, '0.0.0.0');

  // Logged because a platform that cannot reach the app reports a generic
  // gateway error, and the startup banner is the only place that can say which
  // port was actually used and where the CORS origin came from. Without this the
  // failure is indistinguishable from a crash.
  Logger.log(
    `Listening on 0.0.0.0:${port} · CORS origin ${corsOrigin}`,
    'Bootstrap',
  );
}

void bootstrap();
