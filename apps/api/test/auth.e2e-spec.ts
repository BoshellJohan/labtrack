import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponse, UserDto } from '@labtrack/shared';
import { createTestApp, resetDatabase } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

// The API must never leak the password hash. UserDto (the public shape)
// doesn't carry the field, so this asserts its absence explicitly.
interface LoginResponseWithPasswordHash extends LoginResponse {
  user: UserDto & { passwordHash?: string };
}

interface ErrorBody {
  code: string;
}

describe('Auth (e2e)', () => {
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
    await prisma.user.create({
      data: {
        username: 'ana',
        fullName: 'Ana Ruiz',
        passwordHash: await passwords.hash('initial-password'),
        role: 'USER',
        mustChangePassword: false,
      },
    });
  });

  function login(username: string, password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password });
  }

  it('logs in with valid credentials and returns a token', async () => {
    const response = await login('ana', 'initial-password').expect(201);
    const loginBody = body<LoginResponseWithPasswordHash>(response);
    expect(loginBody.accessToken).toEqual(expect.any(String));
    expect(loginBody.user.username).toBe('ana');
    expect(loginBody.user.passwordHash).toBeUndefined();
  });

  it('rejects invalid credentials with 401', async () => {
    await login('ana', 'wrong-password').expect(401);
  });

  it('rejects a request to /auth/me without a token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('returns the profile of the authenticated user', async () => {
    const { accessToken } = body<LoginResponse>(
      await login('ana', 'initial-password'),
    );
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(body<UserDto>(response).username).toBe('ana');
  });

  it('changes the password and clears mustChangePassword', async () => {
    await prisma.user.update({
      where: { username: 'ana' },
      data: { mustChangePassword: true },
    });
    const { accessToken } = body<LoginResponse>(
      await login('ana', 'initial-password'),
    );

    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'initial-password',
        newPassword: 'a-brand-new-password',
      })
      .expect(200);

    await login('ana', 'initial-password').expect(401);
    const response = await login('ana', 'a-brand-new-password').expect(201);
    expect(body<LoginResponse>(response).user.mustChangePassword).toBe(false);
  });

  it('rejects a password change with the wrong current password with a coded 400', async () => {
    const { accessToken } = body<LoginResponse>(
      await login('ana', 'initial-password'),
    );
    // 400 and not 401: a 401 means "your session is not valid" and the client
    // interceptor logs the user out on it, so a typo here must not end the
    // session.
    const response = await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'not-my-password',
        newPassword: 'a-brand-new-password',
      })
      .expect(400);

    expect(body<ErrorBody>(response).code).toBe('INVALID_CURRENT_PASSWORD');
  });

  it('keeps the session usable after a rejected password change', async () => {
    const { accessToken } = body<LoginResponse>(
      await login('ana', 'initial-password'),
    );
    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'not-my-password',
        newPassword: 'a-brand-new-password',
      })
      .expect(400);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('blocks other endpoints while the user must change the password', async () => {
    await prisma.user.update({
      where: { username: 'ana' },
      data: { mustChangePassword: true },
    });
    const { accessToken } = body<LoginResponse>(
      await login('ana', 'initial-password'),
    );

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('rejects a token belonging to a deactivated user', async () => {
    const { accessToken } = body<LoginResponse>(
      await login('ana', 'initial-password'),
    );
    await prisma.user.update({
      where: { username: 'ana' },
      data: { active: false },
    });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });
});
