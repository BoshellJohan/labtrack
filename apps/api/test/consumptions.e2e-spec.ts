import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConsumptionDto, PaginatedResponse } from '@labtrack/shared';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Consumptions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let batchId: string;
  let reagentId: string;

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
    reagentId = reagent.id;
  });

  async function seedConsumptions(): Promise<void> {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    // Inserted out of chronological order on purpose: a "newest first"
    // assertion against insertion order alone (no real `orderBy`) would pass
    // by accident if these went in sequentially.
    await prisma.consumption.create({
      data: {
        batchId,
        quantity: '1.0000',
        consumedAt: new Date('2026-08-02'),
        purpose: 'Segundo',
        madeById: admin.id,
      },
    });
    await prisma.consumption.create({
      data: {
        batchId,
        quantity: '1.0000',
        consumedAt: new Date('2026-08-03'),
        purpose: 'Tercero',
        madeById: admin.id,
      },
    });
    await prisma.consumption.create({
      data: {
        batchId,
        quantity: '1.0000',
        consumedAt: new Date('2026-08-01'),
        purpose: 'Primero',
        madeById: admin.id,
      },
    });
  }

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
    // This value is not itself discriminating: 100 - 0.3 happens to be exact
    // in IEEE-754 too. It's here because it's the number a human reads in the
    // report. The mechanism is proven by the test below instead: the
    // arithmetic is delegated to Postgres via `{ decrement: ... }` in
    // ConsumptionsService, never computed in Node.
    expect(batch.currentStock.toString()).toBe('99.7');
  });

  it('decrements with exact decimal precision, unlike a JS float subtraction', async () => {
    await prisma.reagentBatch.update({
      where: { id: batchId },
      data: { initialStock: '1.0000', currentStock: '1.0000' },
    });
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        batchId,
        quantity: '0.9999',
        consumedAt: '2026-08-01T10:00:00.000Z',
        purpose: 'Precisión decimal',
      })
      .expect(201);

    const batch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    // 1 - 0.9999 in binary floating point is 0.00009999999999998899, not
    // 0.0001. This assertion would fail against a Node-side subtraction, so
    // it actually pins the decrement happening in Postgres.
    expect(batch.currentStock.toString()).toBe('0.0001');
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

  it('returns consumptions newest first by default', async () => {
    await seedConsumptions();
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ConsumptionDto>>(response);
    expect(page.data.map((c) => c.purpose)).toEqual([
      'Tercero',
      'Segundo',
      'Primero',
    ]);
  });

  it('excludes voided consumptions from a normal listing', async () => {
    await seedConsumptions();
    const first = await prisma.consumption.findFirstOrThrow({
      where: { purpose: 'Primero' },
    });
    await prisma.consumption.update({
      where: { id: first.id },
      data: { active: false, voidReason: 'Error', voidedAt: new Date() },
    });

    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ConsumptionDto>>(response);
    expect(page.data.map((c) => c.purpose)).toEqual(['Tercero', 'Segundo']);
    expect(page.total).toBe(2);
  });

  it("hides a deactivated reagent's consumptions from a non-admin", async () => {
    await seedConsumptions();
    await prisma.reagent.update({
      where: { id: reagentId },
      data: { active: false },
    });

    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ConsumptionDto>>(response);
    expect(page.data).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(JSON.stringify(page)).not.toContain('Acetona');
  });

  it("hides a deactivated batch's consumptions from a non-admin", async () => {
    // The reagent-only case above pins `reagent: { active: true }` in the
    // batch filter, but would still pass if the sibling `active: true` on
    // the batch itself were dropped. Deactivating only the batch (leaving
    // the reagent active) isolates that half of the constraint.
    await seedConsumptions();
    await prisma.reagentBatch.update({
      where: { id: batchId },
      data: { active: false },
    });

    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ConsumptionDto>>(response);
    expect(page.data).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(JSON.stringify(page)).not.toContain('Acetona');
  });

  it('lets an admin see voided consumptions with includeVoided', async () => {
    await seedConsumptions();
    const first = await prisma.consumption.findFirstOrThrow({
      where: { purpose: 'Primero' },
    });
    await prisma.consumption.update({
      where: { id: first.id },
      data: { active: false, voidReason: 'Error', voidedAt: new Date() },
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .get('/consumptions?includeVoided=true')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(body<PaginatedResponse<ConsumptionDto>>(response).total).toBe(3);
  });

  it('refuses includeVoided for a non-admin', async () => {
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .get('/consumptions?includeVoided=true')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('filters by a date range on consumedAt', async () => {
    await seedConsumptions();
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get(
        '/consumptions?from=2026-08-02T00:00:00.000Z&to=2026-08-02T23:59:59.999Z',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ConsumptionDto>>(response);
    expect(page.data.map((c) => c.purpose)).toEqual(['Segundo']);
  });

  it('filters by a partial purpose, case-insensitively', async () => {
    await seedConsumptions();
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions?purpose=terc')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ConsumptionDto>>(response);
    expect(page.data.map((c) => c.purpose)).toEqual(['Tercero']);
  });

  it('filters by reagent across all of that reagent batches', async () => {
    await seedConsumptions();
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get(`/consumptions?reagentId=${reagentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(body<PaginatedResponse<ConsumptionDto>>(response).total).toBe(3);
  });

  it('rejects a sortBy value outside the whitelist', async () => {
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .get('/consumptions?sortBy=id')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns the quantity to the batch and records who voided it and why', async () => {
    const token = await tokenFor('ana');
    const created = body<ConsumptionDto>(
      await request(app.getHttpServer())
        .post('/consumptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          batchId,
          quantity: '0.3000',
          consumedAt: '2026-08-01T10:00:00.000Z',
          purpose: 'Prueba',
        })
        .expect(201),
    );

    const adminToken = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .patch(`/consumptions/${created.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voidReason: 'Registrado por error' })
      .expect(200);

    const dto = body<ConsumptionDto>(response);
    expect(dto.active).toBe(false);
    expect(dto.voidReason).toBe('Registrado por error');
    expect(dto.voidedByName).toBe('Admin');
    expect(dto.voidedAt).not.toBeNull();

    const batch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.currentStock.toString()).toBe('100');
  });

  it('refuses to void for a non-admin, and leaves the stock consumed', async () => {
    const token = await tokenFor('ana');
    const created = body<ConsumptionDto>(
      await request(app.getHttpServer())
        .post('/consumptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          batchId,
          quantity: '1',
          consumedAt: '2026-08-01T10:00:00.000Z',
          purpose: 'Prueba',
        })
        .expect(201),
    );

    await request(app.getHttpServer())
      .patch(`/consumptions/${created.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ voidReason: 'Quiero anularlo' })
      .expect(403);

    const batch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.currentStock.toString()).toBe('99');
  });

  it('requires a justification', async () => {
    const token = await tokenFor('ana');
    const created = body<ConsumptionDto>(
      await request(app.getHttpServer())
        .post('/consumptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          batchId,
          quantity: '1',
          consumedAt: '2026-08-01T10:00:00.000Z',
          purpose: 'Prueba',
        })
        .expect(201),
    );

    const adminToken = await tokenFor('admin');
    await request(app.getHttpServer())
      .patch(`/consumptions/${created.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voidReason: '   ' })
      .expect(400);
  });

  it('does not return the stock twice when voiding an already-voided consumption', async () => {
    const token = await tokenFor('ana');
    const created = body<ConsumptionDto>(
      await request(app.getHttpServer())
        .post('/consumptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          batchId,
          quantity: '5',
          consumedAt: '2026-08-01T10:00:00.000Z',
          purpose: 'Prueba',
        })
        .expect(201),
    );

    const adminToken = await tokenFor('admin');
    await request(app.getHttpServer())
      .patch(`/consumptions/${created.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voidReason: 'Primera anulación' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/consumptions/${created.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ voidReason: 'Segunda anulación' })
      .expect(400);

    const batch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.currentStock.toString()).toBe('100');
  });
});
