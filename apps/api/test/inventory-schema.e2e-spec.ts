import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Inventory schema (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Consumption", "ReagentBatch", "Reagent", "Location", "User" RESTART IDENTITY CASCADE',
    );
    const user = await prisma.user.create({
      data: {
        username: 'admin',
        fullName: 'Admin',
        passwordHash: 'x',
        role: 'ADMIN',
        mustChangePassword: false,
      },
    });
    userId = user.id;
  });

  async function makeBatch(lotNumber: string, active = true) {
    const location = await prisma.location.upsert({
      where: { name: 'Estante A' },
      update: {},
      create: { name: 'Estante A', madeById: userId },
    });
    const reagent = await prisma.reagent.upsert({
      where: { id: 'fixed-reagent' },
      update: {},
      create: {
        id: 'fixed-reagent',
        name: 'Acetona',
        casNumber: '67-64-1',
        madeById: userId,
      },
    });
    return prisma.reagentBatch.create({
      data: {
        reagentId: reagent.id,
        locationId: location.id,
        lotNumber,
        entryDate: new Date('2026-01-10'),
        initialStock: '500.0000',
        currentStock: '500.0000',
        unit: 'ML',
        active,
        madeById: userId,
      },
    });
  }

  it('stores quantities without binary rounding error', async () => {
    const batch = await makeBatch('L-1');
    await prisma.reagentBatch.update({
      where: { id: batch.id },
      data: { currentStock: '0.1000' },
    });
    // 0.1 + 0.2 is the classic float trap: a double column would store
    // 0.30000000000000004. Let the database perform the addition via
    // Prisma's `increment`, so a Decimal(12,4) column is required to land
    // on exactly 0.3.
    const updated = await prisma.reagentBatch.update({
      where: { id: batch.id },
      data: { currentStock: { increment: '0.2' } },
    });
    expect(updated.currentStock.toString()).toBe('0.3');
  });

  it('rejects two active batches sharing a lot number for one reagent', async () => {
    await makeBatch('L-1');
    await expect(makeBatch('L-1')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows reusing a lot number once the previous batch is inactive', async () => {
    const first = await makeBatch('L-1');
    await prisma.reagentBatch.update({
      where: { id: first.id },
      data: { active: false },
    });
    await expect(makeBatch('L-1')).resolves.toBeDefined();
  });
});
