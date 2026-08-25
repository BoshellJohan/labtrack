import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/common/configure-app';
import { assertTestDatabase } from './assert-test-database';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
}

export async function createTestApp(): Promise<TestContext> {
  assertTestDatabase(process.env.DATABASE_URL);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma };
}

// Every e2e suite truncates this shared User table, so suites cannot run
// in parallel workers. Serialization is enforced by `maxWorkers: 1` in
// test/jest-e2e.json; removing it reintroduces nondeterministic races
// between one suite's truncate and another's inserts.
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "User" RESTART IDENTITY CASCADE',
  );
}
