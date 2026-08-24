import { createTestApp } from './utils/test-app';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PrismaService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('connects to the database and reads the user table', async () => {
    await expect(prisma.user.count()).resolves.toBeGreaterThanOrEqual(0);
  });
});
