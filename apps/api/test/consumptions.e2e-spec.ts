import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConsumptionDto } from '@labtrack/shared';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Consumptions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let batchId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    passwords = app.get(PasswordService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Consumption", "ReagentBatch", "Reagent", "Location", "User" RESTART IDENTITY CASCADE',
    );
    const passwordHash = await passwords.hash('initial-password');
    await prisma.user.createMany({
      data: [
        {
          username: 'admin',
          fullName: 'Admin',
          passwordHash,
          role: 'ADMIN',
          mustChangePassword: false,
        },
        {
          username: 'ana',
          fullName: 'Ana Ruiz',
          passwordHash,
          role: 'USER',
          mustChangePassword: false,
        },
      ],
    });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const reagent = await prisma.reagent.create({
      data: {
        name: 'Acetona',
        casNumber: '67-64-1',
        madeById: admin.id,
      },
    });
    const location = await prisma.location.create({
      data: { name: 'Estante A', madeById: admin.id },
    });
    const batch = await prisma.reagentBatch.create({
      data: {
        reagentId: reagent.id,
        locationId: location.id,
        lotNumber: 'L-1',
        entryDate: new Date('2026-01-10'),
        expirationDate: new Date('2027-01-10'),
        initialStock: '100.0000',
        currentStock: '100.0000',
        unit: 'ML',
        madeById: admin.id,
      },
    });
    batchId = batch.id;
  });

  async function tokenFor(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body<{ accessToken: string }>(response).accessToken;
  }

  it('records a consumption and decrements the batch in the same transaction', async () => {
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId,
        quantity: '0.3000',
        consumedAt: '2026-08-01T10:00:00.000Z',
        purpose: 'Práctica de titulación',
      })
      .expect(201);

    const dto = body<ConsumptionDto>(response);
    expect(dto.quantity).toBe('0.3');
    expect(dto.unit).toBe('ML');
    expect(dto.madeByName).toBe('Ana Ruiz');

    const batch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    // The database does the arithmetic, so this would fail against a Float
    // column: 100 - 0.3 in binary floating point is not exactly 99.7.
    expect(batch.currentStock.toString()).toBe('99.7');
  });

  it('rejects a quantity greater than the batch stock and leaves the stock untouched', async () => {
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId,
        quantity: '100.0001',
        consumedAt: '2026-08-01T10:00:00.000Z',
        purpose: 'Demasiado',
      })
      .expect(400);

    const batch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.currentStock.toString()).toBe('100');
    expect(await prisma.consumption.count()).toBe(0);
  });

  it('allows consuming exactly the remaining stock', async () => {
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId,
        quantity: '100.0000',
        consumedAt: '2026-08-01T10:00:00.000Z',
        purpose: 'Todo',
      })
      .expect(201);

    const batch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.currentStock.toString()).toBe('0');
  });

  it('refuses to consume from an inactive batch', async () => {
    await prisma.reagentBatch.update({
      where: { id: batchId },
      data: { active: false },
    });
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId,
        quantity: '1',
        consumedAt: '2026-08-01T10:00:00.000Z',
        purpose: 'Lote retirado',
      })
      .expect(400);
  });

  it('rejects a numeric quantity rather than coercing it to a string', async () => {
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId,
        quantity: 0.3,
        consumedAt: '2026-08-01T10:00:00.000Z',
        purpose: 'Número',
      })
      .expect(400);
  });

  it('rejects a blank purpose, because a consumption with no traceable reason is what this system exists to prevent', async () => {
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId,
        quantity: '1',
        consumedAt: '2026-08-01T10:00:00.000Z',
        purpose: '   ',
      })
      .expect(400);
  });
});
