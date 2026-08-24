import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/client';
import { seedAdmin } from '../prisma/seed';

describe('seedAdmin', () => {
  // Prisma 7 requires a driver adapter. This suite builds its own client rather
  // than going through createTestApp, because it exercises the standalone seed.
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "User" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the admin with a forced password change', async () => {
    await seedAdmin(prisma, { username: 'admin', password: 'seed-password' });

    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    expect(admin.role).toBe('ADMIN');
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.passwordHash).not.toBe('seed-password');
  });

  it('is idempotent and does not overwrite an existing password', async () => {
    await seedAdmin(prisma, { username: 'admin', password: 'seed-password' });
    const first = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });

    await seedAdmin(prisma, {
      username: 'admin',
      password: 'a-different-password',
    });

    const second = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    expect(await prisma.user.count()).toBe(1);
    expect(second.passwordHash).toBe(first.passwordHash);
  });
});
