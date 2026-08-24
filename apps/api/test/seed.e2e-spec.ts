import { PrismaClient } from '@prisma/client';
import { seedAdmin } from '../prisma/seed';

describe('seedAdmin', () => {
  const prisma = new PrismaClient();

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
