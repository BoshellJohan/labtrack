import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponse, PaginatedResponse, UserDto } from '@labtrack/shared';
import { createTestApp, resetDatabase } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

// The API must never leak the password hash. UserDto (the public shape)
// doesn't carry the field, so this asserts its absence explicitly.
type UserDtoWithPasswordHash = UserDto & { passwordHash?: string };

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
    return body<LoginResponse>(response).accessToken;
  }

  it('lets an admin list users with pagination metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/users?page=1&pageSize=1')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(200);

    const page = body<PaginatedResponse<UserDto>>(response);
    expect(page.data).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);
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
      .send({
        username: 'luis',
        fullName: 'Luis Paz',
        password: 'temporary1',
        role: 'USER',
      })
      .expect(201);

    const createdUser = body<UserDtoWithPasswordHash>(response);
    expect(createdUser.mustChangePassword).toBe(true);
    expect(createdUser.passwordHash).toBeUndefined();
  });

  it('rejects a duplicated username with 409', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({
        username: 'ana',
        fullName: 'Otra Ana',
        password: 'temporary1',
        role: 'USER',
      })
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

  it('renames a user through PATCH /users/:id', async () => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { username: 'ana' },
    });

    const response = await request(app.getHttpServer())
      .patch(`/users/${target.id}`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ fullName: 'Ana Maria Ruiz' })
      .expect(200);

    const renamedUser = body<UserDtoWithPasswordHash>(response);
    expect(renamedUser.fullName).toBe('Ana Maria Ruiz');
    expect(renamedUser.username).toBe('ana');
    expect(renamedUser.passwordHash).toBeUndefined();
  });

  it('refuses to let an admin demote their own account even with peers left', async () => {
    await prisma.user.create({
      data: {
        username: 'admin2',
        fullName: 'Admin Two',
        passwordHash: await passwords.hash('initial-password'),
        role: 'ADMIN',
        mustChangePassword: false,
      },
    });
    const actor = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });

    await request(app.getHttpServer())
      .patch(`/users/${actor.id}`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ role: 'USER' })
      .expect(400);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    expect(stored.role).toBe('ADMIN');
  });

  it('refuses to demote the only remaining administrator', async () => {
    // The seed-shaped fixture has a single ADMIN, so this request is both a
    // self-demotion and a last-admin demotion; either guard must refuse it.
    const actor = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });

    await request(app.getHttpServer())
      .patch(`/users/${actor.id}`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ role: 'USER' })
      .expect(400);

    expect(
      await prisma.user.count({ where: { role: 'ADMIN', active: true } }),
    ).toBe(1);
  });

  it('lets an admin demote a peer while another administrator remains', async () => {
    const other = await prisma.user.create({
      data: {
        username: 'admin2',
        fullName: 'Admin Two',
        passwordHash: await passwords.hash('initial-password'),
        role: 'ADMIN',
        mustChangePassword: false,
      },
    });

    await request(app.getHttpServer())
      .patch(`/users/${other.id}`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ role: 'USER' })
      .expect(200);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(stored.role).toBe('USER');
  });

  it('deactivates a user without deleting the row', async () => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { username: 'ana' },
    });

    await request(app.getHttpServer())
      .patch(`/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(200);

    const stored = await prisma.user.findUnique({ where: { id: target.id } });
    expect(stored?.active).toBe(false);
  });

  it('exposes no DELETE route for users', async () => {
    const target = await prisma.user.findUniqueOrThrow({
      where: { username: 'ana' },
    });
    await request(app.getHttpServer())
      .delete(`/users/${target.id}`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(404);
  });
});
