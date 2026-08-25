import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

const payload = { sub: 'user-1', username: 'ana', role: 'USER' as const };

function buildStrategy(user: unknown) {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  const config = {
    get: jest.fn().mockReturnValue('a-secret-long-enough-for-signing'),
  };
  return new JwtStrategy(config as never, prisma as never);
}

describe('JwtStrategy.validate', () => {
  it('returns the authenticated user for an active account', async () => {
    const strategy = buildStrategy({
      id: 'user-1',
      username: 'ana',
      role: 'USER',
      mustChangePassword: false,
      active: true,
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'user-1',
      username: 'ana',
      role: 'USER',
      mustChangePassword: false,
    });
  });

  it('rejects a token whose user was deactivated', async () => {
    const strategy = buildStrategy({
      id: 'user-1',
      username: 'ana',
      role: 'USER',
      mustChangePassword: false,
      active: false,
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token whose user no longer exists', async () => {
    const strategy = buildStrategy(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
