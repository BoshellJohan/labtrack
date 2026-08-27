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
});
