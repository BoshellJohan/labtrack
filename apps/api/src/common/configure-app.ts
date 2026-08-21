import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaExceptionFilter } from './filters/prisma-exception.filter';

/**
 * Applies the request-pipeline configuration shared by the running app
 * (`main.ts`) and the e2e test harness (`test/utils/test-app.ts`), so the
 * two cannot drift apart: the same `ValidationPipe` options and the same
 * global exception filters.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
}
