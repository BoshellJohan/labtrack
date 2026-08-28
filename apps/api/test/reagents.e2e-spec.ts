import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PaginatedResponse, ReagentDto } from '@labtrack/shared';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Reagents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let adminId: string;

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
    adminId = admin.id;
  });

  async function tokenFor(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body<{ accessToken: string }>(response).accessToken;
  }

  it('lets an admin create a reagent and records the actor', async () => {
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acetona', casNumber: '67-64-1' })
      .expect(201);

    const created = body<ReagentDto>(response);
    expect(created.name).toBe('Acetona');

    const stored = await prisma.reagent.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(stored.madeById).toBe(adminId);
  });

  it('blocks a non-admin from creating one, but lets them list', async () => {
    await request(app.getHttpServer())
      .post('/reagents')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .send({ name: 'Acetona', casNumber: '67-64-1' })
      .expect(403);

    await request(app.getHttpServer())
      .get('/reagents')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .expect(200);
  });

  it('rejects a malformed CAS number with 400', async () => {
    await request(app.getHttpServer())
      .post('/reagents')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ name: 'Acetona', casNumber: '1234' })
      .expect(400);
  });

  it('rejects a dataSheetUrl without a protocol with 400', async () => {
    await request(app.getHttpServer())
      .post('/reagents')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({
        name: 'Acetona',
        casNumber: '67-64-1',
        dataSheetUrl: 'ejemplo.com/ficha.pdf',
      })
      .expect(400);
  });

  it('finds a reagent by a partial, differently-cased name', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post('/reagents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acetona', casNumber: '67-64-1' })
      .expect(201);

    const listed = body<PaginatedResponse<ReagentDto>>(
      await request(app.getHttpServer())
        .get('/reagents?name=aceto')
        .set('Authorization', `Bearer ${token}`),
    );
    expect(listed.total).toBe(1);
    expect(listed.data[0].name).toBe('Acetona');
  });

  it('finds a reagent by an exact CAS number', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post('/reagents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acetona', casNumber: '67-64-1' })
      .expect(201);

    const listed = body<PaginatedResponse<ReagentDto>>(
      await request(app.getHttpServer())
        .get('/reagents?casNumber=67-64-1')
        .set('Authorization', `Bearer ${token}`),
    );
    expect(listed.total).toBe(1);
    expect(listed.data[0].casNumber).toBe('67-64-1');
  });

  it('keeps total and data.length coherent when paginating', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post('/reagents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acetona', casNumber: '67-64-1' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/reagents')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Etanol', casNumber: '64-17-5' })
      .expect(201);

    const listed = body<PaginatedResponse<ReagentDto>>(
      await request(app.getHttpServer())
        .get('/reagents?pageSize=1')
        .set('Authorization', `Bearer ${token}`),
    );
    expect(listed.total).toBe(2);
    expect(listed.data.length).toBe(1);
  });

  it('deactivating a reagent deactivates its active batches too', async () => {
    const token = await tokenFor('admin');
    const created = body<ReagentDto>(
      await request(app.getHttpServer())
        .post('/reagents')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acetona', casNumber: '67-64-1' }),
    );
    const location = await prisma.location.create({
      data: { name: 'Estante A', madeById: adminId },
    });
    const batch = await prisma.reagentBatch.create({
      data: {
        reagentId: created.id,
        lotNumber: 'L1',
        entryDate: new Date(),
        initialStock: '10',
        currentStock: '10',
        unit: 'ML',
        locationId: location.id,
        madeById: adminId,
      },
    });

    await request(app.getHttpServer())
      .patch(`/reagents/${created.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const storedReagent = await prisma.reagent.findUniqueOrThrow({
      where: { id: created.id },
    });
    const storedBatch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batch.id },
    });
    expect(storedReagent.active).toBe(false);
    expect(storedBatch.active).toBe(false);
  });

  it('groups stockByUnit by unit, summing within a unit but never across units', async () => {
    const token = await tokenFor('admin');
    const created = body<ReagentDto>(
      await request(app.getHttpServer())
        .post('/reagents')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acetona', casNumber: '67-64-1' }),
    );
    const location = await prisma.location.create({
      data: { name: 'Estante A', madeById: adminId },
    });
    // Two ML batches (500 + 250) must accumulate into one ML entry; the L
    // batch must stay separate rather than being folded into the total.
    await prisma.reagentBatch.createMany({
      data: [
        {
          reagentId: created.id,
          lotNumber: 'L1',
          entryDate: new Date(),
          initialStock: '500',
          currentStock: '500',
          unit: 'ML',
          locationId: location.id,
          madeById: adminId,
        },
        {
          reagentId: created.id,
          lotNumber: 'L2',
          entryDate: new Date(),
          initialStock: '250',
          currentStock: '250',
          unit: 'ML',
          locationId: location.id,
          madeById: adminId,
        },
        {
          reagentId: created.id,
          lotNumber: 'L3',
          entryDate: new Date(),
          initialStock: '2',
          currentStock: '2',
          unit: 'L',
          locationId: location.id,
          madeById: adminId,
        },
      ],
    });

    const fetched = body<ReagentDto>(
      await request(app.getHttpServer())
        .get(`/reagents/${created.id}`)
        .set('Authorization', `Bearer ${token}`),
    );
    expect(fetched.stockByUnit).toHaveLength(2);
    expect(fetched.stockByUnit).toEqual(
      expect.arrayContaining([
        { unit: 'ML', total: '750' },
        { unit: 'L', total: '2' },
      ]),
    );
  });

  it('blocks a non-admin from requesting includeInactive (spec §6.1: ADMIN only)', async () => {
    await request(app.getHttpServer())
      .get('/reagents?includeInactive=true')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .expect(403);
  });

  it('lets an admin request includeInactive', async () => {
    await request(app.getHttpServer())
      .get('/reagents?includeInactive=true')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(200);
  });

  it('exposes no DELETE route', async () => {
    await request(app.getHttpServer())
      .delete('/reagents/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(404);
  });

  it('finds an accented name when the search term has no accents', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    await prisma.reagent.create({
      data: {
        name: 'Ácido clorhídrico',
        casNumber: '7647-01-0',
        madeById: admin.id,
      },
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .get('/reagents?name=acido')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ReagentDto>>(response);
    expect(page.data.map((r) => r.name)).toEqual(['Ácido clorhídrico']);
  });

  it('still finds an unaccented name when the search term is accented', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    await prisma.reagent.create({
      data: { name: 'Acetona', casNumber: '67-64-1', madeById: admin.id },
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .get('/reagents?name=acetóna')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ReagentDto>>(response);
    expect(page.data.map((r) => r.name)).toEqual(['Acetona']);
  });

  it('finds a name containing ñ by its exact spelling, and also by the n-folded spelling', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    await prisma.reagent.create({
      data: {
        name: 'Estaño metálico',
        casNumber: '7440-31-5',
        madeById: admin.id,
      },
    });

    const token = await tokenFor('admin');

    const exact = body<PaginatedResponse<ReagentDto>>(
      await request(app.getHttpServer())
        .get('/reagents?name=estaño')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
    expect(exact.data.map((r) => r.name)).toEqual(['Estaño metálico']);

    const folded = body<PaginatedResponse<ReagentDto>>(
      await request(app.getHttpServer())
        .get('/reagents?name=estano')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
    expect(folded.data.map((r) => r.name)).toEqual(['Estaño metálico']);
  });

  it('filters to reagents holding a batch that expires before the given date', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.create({
      data: { name: 'Estante F', madeById: admin.id },
    });
    const soon = await prisma.reagent.create({
      data: { name: 'Caduca pronto', casNumber: '67-64-1', madeById: admin.id },
    });
    const later = await prisma.reagent.create({
      data: {
        name: 'Caduca tarde',
        casNumber: '7647-01-0',
        madeById: admin.id,
      },
    });
    await prisma.reagentBatch.createMany({
      data: [
        {
          reagentId: soon.id,
          locationId: location.id,
          lotNumber: 'S-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          expirationDate: new Date('2026-09-01T00:00:00.000Z'),
          initialStock: '10',
          currentStock: '10',
          unit: 'L',
          madeById: admin.id,
        },
        {
          reagentId: later.id,
          locationId: location.id,
          lotNumber: 'L-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          expirationDate: new Date('2027-09-01T00:00:00.000Z'),
          initialStock: '10',
          currentStock: '10',
          unit: 'L',
          madeById: admin.id,
        },
      ],
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .get('/reagents?expiringBefore=2026-12-31')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ReagentDto>>(response);
    expect(page.data.map((r) => r.name)).toEqual(['Caduca pronto']);
  });

  it('filters to reagents holding a batch at or below the given stock', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.create({
      data: { name: 'Estante G', madeById: admin.id },
    });
    const low = await prisma.reagent.create({
      data: { name: 'Queda poco', casNumber: '67-64-1', madeById: admin.id },
    });
    const plenty = await prisma.reagent.create({
      data: { name: 'Queda mucho', casNumber: '7647-01-0', madeById: admin.id },
    });
    await prisma.reagentBatch.createMany({
      data: [
        {
          reagentId: low.id,
          locationId: location.id,
          lotNumber: 'P-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          initialStock: '100',
          currentStock: '2.5000',
          unit: 'L',
          madeById: admin.id,
        },
        {
          reagentId: plenty.id,
          locationId: location.id,
          lotNumber: 'M-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          initialStock: '100',
          currentStock: '80.0000',
          unit: 'L',
          madeById: admin.id,
        },
      ],
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .get('/reagents?lowStock=5')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ReagentDto>>(response);
    expect(page.data.map((r) => r.name)).toEqual(['Queda poco']);
  });

  it('includes a reagent whose batch stock exactly equals the lowStock threshold', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.create({
      data: { name: 'Estante G2', madeById: admin.id },
    });
    const exact = await prisma.reagent.create({
      data: { name: 'Queda exacto', casNumber: '67-64-1', madeById: admin.id },
    });
    await prisma.reagentBatch.create({
      data: {
        reagentId: exact.id,
        locationId: location.id,
        lotNumber: 'X-1',
        entryDate: new Date('2026-01-01T00:00:00.000Z'),
        initialStock: '100',
        currentStock: '2.5000',
        unit: 'L',
        madeById: admin.id,
      },
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .get('/reagents?lowStock=2.5000')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ReagentDto>>(response);
    expect(page.data.map((r) => r.name)).toEqual(['Queda exacto']);
  });

  it('rejects a lowStock that is not a decimal string', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .get('/reagents?lowStock=mucho')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects minConsumed without a unit, because a quantity with no unit cannot be compared', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .get('/reagents?minConsumed=500')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects a minConsumedUnit outside the Unit enum', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .get('/reagents?minConsumed=500&minConsumedUnit=GALLON')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects a non-decimal minConsumed', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .get('/reagents?minConsumed=mucho&minConsumedUnit=ML')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('accepts a unit on its own, which simply narrows nothing', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .get('/reagents?minConsumedUnit=ML')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('rejects a consumedTo earlier than consumedFrom', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .get(
        '/reagents?minConsumed=500&minConsumedUnit=ML&consumedFrom=2026-06-01&consumedTo=2026-01-01',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('accepts a consumedTo on or after consumedFrom', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .get(
        '/reagents?minConsumed=500&minConsumedUnit=ML&consumedFrom=2026-01-01&consumedTo=2026-06-01',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('accepts a range whose bounds are the same instant, which is a legitimate single-day query', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .get(
        '/reagents?minConsumed=500&minConsumedUnit=ML&consumedFrom=2026-08-01T00:00:00.000Z&consumedTo=2026-08-01T00:00:00.000Z',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('combines lowStock with a name filter rather than replacing it', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.create({
      data: { name: 'Estante H', madeById: admin.id },
    });
    const match = await prisma.reagent.create({
      data: { name: 'Acetona', casNumber: '67-64-1', madeById: admin.id },
    });
    const otherLowStock = await prisma.reagent.create({
      data: { name: 'Etanol', casNumber: '64-17-5', madeById: admin.id },
    });
    await prisma.reagentBatch.createMany({
      data: [
        {
          reagentId: match.id,
          locationId: location.id,
          lotNumber: 'A-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          initialStock: '100',
          currentStock: '1.0000',
          unit: 'L',
          madeById: admin.id,
        },
        {
          reagentId: otherLowStock.id,
          locationId: location.id,
          lotNumber: 'E-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          initialStock: '100',
          currentStock: '1.0000',
          unit: 'L',
          madeById: admin.id,
        },
      ],
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .get('/reagents?lowStock=5&name=aceton')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = body<PaginatedResponse<ReagentDto>>(response);
    expect(page.data.map((r) => r.name)).toEqual(['Acetona']);
  });

  it('hides a deactivated reagent from a non-admin who knows its id', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const reagent = await prisma.reagent.create({
      data: {
        name: 'Retirado',
        casNumber: '67-64-1',
        madeById: admin.id,
        active: false,
      },
    });

    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .get(`/reagents/${reagent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('still shows a deactivated reagent to an admin', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const reagent = await prisma.reagent.create({
      data: {
        name: 'Retirado',
        casNumber: '67-64-1',
        madeById: admin.id,
        active: false,
      },
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .get(`/reagents/${reagent.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(body<ReagentDto>(response).active).toBe(false);
  });

  describe('consumption threshold filter', () => {
    // Acetona: an ML batch consumed 350 + 250 = 600 across two consumptions
    // (2026-08-01 and 2026-08-20). Etanol: an ML batch consumed only 100.
    // Metanol: an L batch consumed 900 — a different unit, so it must never
    // be summed together with an ML threshold.
    async function seedConsumptionFixture() {
      const admin = await prisma.user.findUniqueOrThrow({
        where: { username: 'admin' },
      });
      const location = await prisma.location.create({
        data: { name: 'Estante consumo', madeById: admin.id },
      });

      const acetona = await prisma.reagent.create({
        data: { name: 'Acetona', casNumber: '67-64-1', madeById: admin.id },
      });
      const etanol = await prisma.reagent.create({
        data: { name: 'Etanol', casNumber: '64-17-5', madeById: admin.id },
      });
      const metanol = await prisma.reagent.create({
        data: { name: 'Metanol', casNumber: '67-56-1', madeById: admin.id },
      });

      const acetonaBatch = await prisma.reagentBatch.create({
        data: {
          reagentId: acetona.id,
          locationId: location.id,
          lotNumber: 'A-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          initialStock: '1000',
          currentStock: '400',
          unit: 'ML',
          madeById: admin.id,
        },
      });
      const etanolBatch = await prisma.reagentBatch.create({
        data: {
          reagentId: etanol.id,
          locationId: location.id,
          lotNumber: 'E-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          initialStock: '1000',
          currentStock: '900',
          unit: 'ML',
          madeById: admin.id,
        },
      });
      const metanolBatch = await prisma.reagentBatch.create({
        data: {
          reagentId: metanol.id,
          locationId: location.id,
          lotNumber: 'M-1',
          entryDate: new Date('2026-01-01T00:00:00.000Z'),
          initialStock: '1000',
          currentStock: '100',
          unit: 'L',
          madeById: admin.id,
        },
      });

      const acetonaConsumptionEarly = await prisma.consumption.create({
        data: {
          batchId: acetonaBatch.id,
          consumedAt: new Date('2026-08-01T00:00:00.000Z'),
          quantity: '350',
          purpose: 'Práctica 1',
          madeById: admin.id,
        },
      });
      const acetonaConsumptionLate = await prisma.consumption.create({
        data: {
          batchId: acetonaBatch.id,
          consumedAt: new Date('2026-08-20T00:00:00.000Z'),
          quantity: '250',
          purpose: 'Práctica 2',
          madeById: admin.id,
        },
      });
      await prisma.consumption.create({
        data: {
          batchId: etanolBatch.id,
          consumedAt: new Date('2026-08-05T00:00:00.000Z'),
          quantity: '100',
          purpose: 'Práctica 3',
          madeById: admin.id,
        },
      });
      await prisma.consumption.create({
        data: {
          batchId: metanolBatch.id,
          consumedAt: new Date('2026-08-05T00:00:00.000Z'),
          quantity: '900',
          purpose: 'Práctica 4',
          madeById: admin.id,
        },
      });

      return {
        adminId: admin.id,
        acetonaConsumptionEarly,
        acetonaConsumptionLate,
      };
    }

    it('returns only reagents whose consumption in that unit exceeds the threshold', async () => {
      await seedConsumptionFixture();
      const token = await tokenFor('admin');
      const response = await request(app.getHttpServer())
        .get('/reagents?minConsumed=500&minConsumedUnit=ML')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const page = body<PaginatedResponse<ReagentDto>>(response);
      expect(page.data.map((r) => r.name)).toEqual(['Acetona']);
      expect(page.total).toBe(1);
    });

    it('never sums across units: 900 L does not satisfy a 500 mL threshold', async () => {
      await seedConsumptionFixture();
      const token = await tokenFor('admin');
      const response = await request(app.getHttpServer())
        .get('/reagents?minConsumed=500&minConsumedUnit=ML')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(
        body<PaginatedResponse<ReagentDto>>(response).data.map((r) => r.name),
      ).not.toContain('Metanol');
    });

    it('sums several consumptions of the same batch rather than taking the largest', async () => {
      // Acetona's 600 is 350 + 250. An implementation using MAX instead of SUM
      // would return nothing here, and an implementation taking only the first
      // consumption would too.
      await seedConsumptionFixture();
      const token = await tokenFor('admin');
      const response = await request(app.getHttpServer())
        .get('/reagents?minConsumed=500&minConsumedUnit=ML')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(
        body<PaginatedResponse<ReagentDto>>(response).data.map((r) => r.name),
      ).toEqual(['Acetona']);
    });

    it('bounds the sum by the date range, so consumptions outside it do not count', async () => {
      // Acetona's two consumptions are dated 2026-08-01 and 2026-08-20. A range
      // covering only August 1st leaves 350, below the threshold.
      await seedConsumptionFixture();
      const token = await tokenFor('admin');
      const response = await request(app.getHttpServer())
        .get(
          '/reagents?minConsumed=500&minConsumedUnit=ML' +
            '&consumedFrom=2026-08-01T00:00:00.000Z&consumedTo=2026-08-02T00:00:00.000Z',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(body<PaginatedResponse<ReagentDto>>(response).data).toEqual([]);
    });

    it('ignores voided consumptions', async () => {
      // Void one of Acetona's two consumptions, leaving 350 of 600.
      // A void returns stock; it must also stop counting toward this filter.
      const { adminId, acetonaConsumptionLate } =
        await seedConsumptionFixture();
      await prisma.consumption.update({
        where: { id: acetonaConsumptionLate.id },
        data: {
          active: false,
          voidReason: 'Registrado por error',
          voidedAt: new Date(),
          voidedById: adminId,
        },
      });

      const token = await tokenFor('admin');
      const response = await request(app.getHttpServer())
        .get('/reagents?minConsumed=500&minConsumedUnit=ML')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(body<PaginatedResponse<ReagentDto>>(response).data).toEqual([]);
    });

    it('composes with the simple filters instead of replacing them', async () => {
      // Acetona qualifies on consumption but the name filter excludes it.
      await seedConsumptionFixture();
      const token = await tokenFor('admin');
      const response = await request(app.getHttpServer())
        .get('/reagents?minConsumed=500&minConsumedUnit=ML&name=etan')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(body<PaginatedResponse<ReagentDto>>(response).data).toEqual([]);
    });

    it('returns an empty page when nothing qualifies, not the unfiltered list', async () => {
      await seedConsumptionFixture();
      const token = await tokenFor('admin');
      const response = await request(app.getHttpServer())
        .get('/reagents?minConsumed=99999&minConsumedUnit=ML')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const page = body<PaginatedResponse<ReagentDto>>(response);
      expect(page.data).toEqual([]);
      expect(page.total).toBe(0);
    });
  });
});
