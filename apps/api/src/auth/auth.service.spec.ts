import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

const activeUser = {
  id: 'user-1',
  username: 'ana',
  passwordHash: 'hashed',
  fullName: 'Ana Ruiz',
  role: 'USER' as const,
  mustChangePassword: false,
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  madeById: null,
};

function buildService(overrides: {
  user?: typeof activeUser | null;
  passwordMatches?: boolean;
}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(overrides.user ?? null),
      update: jest.fn(),
    },
  };
  const passwords = {
    verify: jest.fn().mockResolvedValue(overrides.passwordMatches ?? true),
    hash: jest.fn().mockResolvedValue('new-hash'),
  } as unknown as PasswordService;
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };

  const service = new AuthService(prisma as never, passwords, jwt as never);
  return { service, prisma, jwt };
}

describe('AuthService.login', () => {
  it('returns a token and the user profile on valid credentials', async () => {
    const { service, jwt } = buildService({ user: activeUser });

    const result = await service.login({ username: 'ana', password: 'right' });

    expect(result.accessToken).toBe('signed-token');
    expect(result.user).toEqual(
      expect.objectContaining({ id: 'user-1', username: 'ana', role: 'USER' }),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      username: 'ana',
      role: 'USER',
    });
  });

  it('never exposes the password hash', async () => {
    const { service } = buildService({ user: activeUser });
    const result = await service.login({ username: 'ana', password: 'right' });
    expect(JSON.stringify(result)).not.toContain('hashed');
  });

  it('rejects an unknown username', async () => {
    const { service } = buildService({ user: null });
    await expect(
      service.login({ username: 'ghost', password: 'x' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a wrong password', async () => {
    const { service } = buildService({
      user: activeUser,
      passwordMatches: false,
    });
    await expect(
      service.login({ username: 'ana', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a deactivated user', async () => {
    const { service } = buildService({
      user: { ...activeUser, active: false },
    });
    await expect(
      service.login({ username: 'ana', password: 'right' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.changePassword', () => {
  it('rejects a wrong current password with a coded bad request, not a 401', async () => {
    const { service } = buildService({
      user: activeUser,
      passwordMatches: false,
    });

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'wrong',
        newPassword: 'a-brand-new-password',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_CURRENT_PASSWORD',
      },
    });
  });

  it('stores the new hash and clears mustChangePassword', async () => {
    const { service, prisma } = buildService({
      user: activeUser,
      passwordMatches: true,
    });

    await service.changePassword('user-1', {
      currentPassword: 'initial-password',
      newPassword: 'a-brand-new-password',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-hash', mustChangePassword: false },
    });
  });
});
