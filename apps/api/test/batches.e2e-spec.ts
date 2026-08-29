import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PaginatedResponse, ReagentBatchDto } from '@labtrack/shared';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Batches (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let reagentId: string;
  let locationId: string;

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
    reagentId = reagent.id;
    locationId = location.id;
  });

  async function tokenFor(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body<{ accessToken: string }>(response).accessToken;
  }

  function validBatch(overrides: Record<string, unknown> = {}) {
    return {
      lotNumber: 'L-1',
      entryDate: '2026-01-10',
      expirationDate: '2027-01-10',
      initialStock: '500.0000',
      unit: 'ML',
      locationId,
      ...overrides,
    };
  }

  it('creates a batch on an active reagent, with currentStock equal to initialStock', async () => {
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(validBatch())
      .expect(201);

    const created = body<ReagentBatchDto>(response);
    // Decimal's toString() drops trailing zeros (see inventory-schema.e2e-spec.ts),
    // so '500.0000' in the request becomes '500' on the way out.
    expect(created.initialStock).toBe('500');
    expect(created.currentStock).toBe('500');
  });

  it('rejects a currentStock sent in the body with 400', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(validBatch({ currentStock: '999.0000' }))
      .expect(400);
  });

  it('rejects a duplicated lotNumber on the same active reagent with 409', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(validBatch())
      .expect(201);

    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(validBatch())
      .expect(409);
  });

  it('accepts the same lotNumber again once the previous batch is deactivated', async () => {
    const token = await tokenFor('admin');
    const first = body<ReagentBatchDto>(
      await request(app.getHttpServer())
        .post(`/reagents/${reagentId}/batches`)
        .set('Authorization', `Bearer ${token}`)
        .send(validBatch()),
    );

    await request(app.getHttpServer())
      .patch(`/batches/${first.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(validBatch())
      .expect(201);
  });

  it('rejects an expirationDate earlier than entryDate with 400', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(
        validBatch({ entryDate: '2026-01-10', expirationDate: '2025-01-10' }),
      )
      .expect(400);
  });

  it('rejects a create with a null optional field, since there is nothing to clear yet', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(validBatch({ expirationDate: null }))
      .expect(400);
  });

  it('rejects an invalid unit with 400', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(validBatch({ unit: 'litros' }))
      .expect(400);
  });

  it('rejects initialStock sent as a number instead of a string with 400', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${token}`)
      .send(validBatch({ initialStock: 500 }))
      .expect(400);
  });

  it('blocks a non-admin from creating a batch, but lets them list', async () => {
    await request(app.getHttpServer())
      .post(`/reagents/${reagentId}/batches`)
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .send(validBatch())
      .expect(403);

    const listed = body<PaginatedResponse<ReagentBatchDto>>(
      await request(app.getHttpServer())
        .get(`/reagents/${reagentId}/batches`)
        .set('Authorization', `Bearer ${await tokenFor('ana')}`)
        .expect(200),
    );
    expect(listed.data).toEqual([]);
  });

  it('deactivating a batch does not delete the row', async () => {
    const token = await tokenFor('admin');
    const created = body<ReagentBatchDto>(
      await request(app.getHttpServer())
        .post(`/reagents/${reagentId}/batches`)
        .set('Authorization', `Bearer ${token}`)
        .send(validBatch()),
    );

    await request(app.getHttpServer())
      .patch(`/batches/${created.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const stored = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(stored.active).toBe(false);
  });

  it("blocks a non-admin from requesting includeInactive on a reagent's batches (spec §6.1: ADMIN only)", async () => {
    await request(app.getHttpServer())
      .get(`/reagents/${reagentId}/batches?includeInactive=true`)
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .expect(403);
  });

  it("lets an admin request includeInactive on a reagent's batches", async () => {
    await request(app.getHttpServer())
      .get(`/reagents/${reagentId}/batches?includeInactive=true`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(200);
  });

  it('exposes no DELETE route', async () => {
    await request(app.getHttpServer())
      .delete('/batches/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(404);
  });

  // Regression for a latent gap: listForReagent's visibility used to rely
  // entirely on Reagent.deactivate() cascading to its batches. Here the
  // reagent is deactivated by writing `active: false` straight through
  // Prisma, deliberately skipping that cascade, so the batch stays active.
  // If listForReagent ever stops checking the parent reagent itself, this
  // is the test that catches it.
  it('hides an active batch from a non-admin once its reagent is inactive, even if the batch itself was never deactivated', async () => {
    const token = await tokenFor('admin');
    const created = body<ReagentBatchDto>(
      await request(app.getHttpServer())
        .post(`/reagents/${reagentId}/batches`)
        .set('Authorization', `Bearer ${token}`)
        .send(validBatch()),
    );

    await prisma.reagent.update({
      where: { id: reagentId },
      data: { active: false },
    });

    const stillActiveBatch = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(stillActiveBatch.active).toBe(true);

    const listed = body<PaginatedResponse<ReagentBatchDto>>(
      await request(app.getHttpServer())
        .get(`/reagents/${reagentId}/batches`)
        .set('Authorization', `Bearer ${await tokenFor('ana')}`)
        .expect(200),
    );
    expect(listed.data).toEqual([]);
  });
});
