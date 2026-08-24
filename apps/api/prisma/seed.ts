import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import * as bcrypt from 'bcrypt';

// This script runs standalone via `prisma db seed` (ts-node), outside the
// Nest DI container, so it cannot import PasswordService from src/ without
// dragging in the whole module graph. The cost factor is duplicated here on
// purpose — keep it in sync with SALT_ROUNDS in src/auth/password.service.ts.
const SALT_ROUNDS = 12;

export async function seedAdmin(
  prisma: PrismaClient,
  env: { username: string; password: string },
): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { username: env.username },
  });
  if (existing) {
    return;
  }

  await prisma.user.create({
    data: {
      username: env.username,
      fullName: 'Administrador',
      passwordHash: await bcrypt.hash(env.password, SALT_ROUNDS),
      role: 'ADMIN',
      mustChangePassword: true,
    },
  });
}

async function main(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD are required to seed',
    );
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed');
  }

  // Prisma 7 connects through a driver adapter, so the seed builds its own
  // rather than sharing the application's PrismaService — this script runs
  // outside the Nest container on purpose.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seedAdmin(prisma, { username, password });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
