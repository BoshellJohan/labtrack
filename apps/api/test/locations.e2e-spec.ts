import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LocationDto, PaginatedResponse } from '@labtrack/shared';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Locations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;

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
  });

  async function tokenFor(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body<{ accessToken: string }>(response).accessToken;
  }

  it('lets an admin create a location and records the actor', async () => {
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Estante A', description: 'Pasillo 1' })
      .expect(201);

    const created = body<LocationDto>(response);
    expect(created.name).toBe('Estante A');

    const stored = await prisma.location.findUniqueOrThrow({
      where: { id: created.id },
    });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    expect(stored.madeById).toBe(admin.id);
  });

  it('blocks a non-admin from creating one', async () => {
    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .send({ name: 'Estante B' })
      .expect(403);
  });

  it('lets any authenticated user list them', async () => {
    await request(app.getHttpServer())
      .get('/locations')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .expect(200);
  });

  it('rejects a duplicated name with 409', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Estante A' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Estante A' })
      .expect(409);
  });

  it('rejects a forged madeById with 400', async () => {
    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ name: 'Estante C', madeById: 'forged-id' })
      .expect(400);
  });

  it('rejects a create with a null optional field, since there is nothing to clear yet', async () => {
    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ name: 'Estante C', description: null })
      .expect(400);
  });

  it('clears an optional field when it is sent as null', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.create({
      data: { name: 'Estante A', description: 'Pasillo 1', madeById: admin.id },
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .patch(`/locations/${location.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: null })
      .expect(200);

    expect(body<LocationDto>(response).description).toBeNull();
  });

  it('leaves an optional field untouched when it is omitted', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.create({
      data: { name: 'Estante A', description: 'Pasillo 1', madeById: admin.id },
    });

    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .patch(`/locations/${location.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Estante A renovado' })
      .expect(200);

    // This is the test that stops the fix from becoming a worse bug: if null
    // and undefined were collapsed, editing the name would wipe the description.
    expect(body<LocationDto>(response).description).toBe('Pasillo 1');
  });

  it('deactivates without deleting the row', async () => {
    const token = await tokenFor('admin');
    const created = body<LocationDto>(
      await request(app.getHttpServer())
        .post('/locations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Estante D' }),
    );

    await request(app.getHttpServer())
      .patch(`/locations/${created.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const stored = await prisma.location.findUnique({
      where: { id: created.id },
    });
    expect(stored?.active).toBe(false);
  });

  it('hides inactive locations from the default listing', async () => {
    const token = await tokenFor('admin');
    const created = body<LocationDto>(
      await request(app.getHttpServer())
        .post('/locations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Estante E' }),
    );
    await request(app.getHttpServer())
      .patch(`/locations/${created.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);

    const listed = body<PaginatedResponse<LocationDto>>(
      await request(app.getHttpServer())
        .get('/locations')
        .set('Authorization', `Bearer ${token}`),
    );
    expect(listed.total).toBe(0);

    const withInactive = body<PaginatedResponse<LocationDto>>(
      await request(app.getHttpServer())
        .get('/locations?includeInactive=true')
        .set('Authorization', `Bearer ${token}`),
    );
    expect(withInactive.total).toBe(1);
  });

  it('blocks a non-admin from requesting includeInactive (spec §6.1: ADMIN only)', async () => {
    await request(app.getHttpServer())
      .get('/locations?includeInactive=true')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .expect(403);
  });

  it('exposes no DELETE route', async () => {
    await request(app.getHttpServer())
      .delete('/locations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(404);
  });
});
