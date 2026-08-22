import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Users (e2e)', () => {
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
    await resetDatabase(prisma);
    const passwordHash = await passwords.hash('initial-password');
    await prisma.user.createMany({
      data: [
        { username: 'admin', fullName: 'Admin', passwordHash, role: 'ADMIN', mustChangePassword: false },
        { username: 'ana', fullName: 'Ana Ruiz', passwordHash, role: 'USER', mustChangePassword: false },
      ],
    });
  });

  async function tokenFor(username: string): Promise<string> {
    const { body } = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body.accessToken;
  }

  it('lets an admin list users with pagination metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/users?page=1&pageSize=1')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.total).toBe(2);
    expect(response.body.totalPages).toBe(2);
  });

  it('blocks a non-admin from listing users', async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .expect(403);
  });

  it('creates a user who must change the password on first login', async () => {
    const response = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ username: 'luis', fullName: 'Luis Paz', password: 'temporary1', role: 'USER' })
      .expect(201);

    expect(response.body.mustChangePassword).toBe(true);
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('rejects a duplicated username with 409', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ username: 'ana', fullName: 'Otra Ana', password: 'temporary1', role: 'USER' })
      .expect(409);
  });

  it('rejects unknown fields in the payload', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({
        username: 'luis',
        fullName: 'Luis Paz',
        password: 'temporary1',
        role: 'USER',
        madeById: 'forged-id',
      })
      .expect(400);
  });

  it('deactivates a user without deleting the row', async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });

    await request(app.getHttpServer())
      .patch(`/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(200);

    const stored = await prisma.user.findUnique({ where: { id: target.id } });
    expect(stored?.active).toBe(false);
  });

  it('exposes no DELETE route for users', async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });
    await request(app.getHttpServer())
      .delete(`/users/${target.id}`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(404);
  });
});
