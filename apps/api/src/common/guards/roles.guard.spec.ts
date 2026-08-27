import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function contextFor(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(roles),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no role is required', () => {
    expect(
      guardRequiring(undefined).canActivate(contextFor({ role: 'USER' })),
    ).toBe(true);
  });

  it('allows a user whose role is required', () => {
    expect(
      guardRequiring(['ADMIN']).canActivate(contextFor({ role: 'ADMIN' })),
    ).toBe(true);
  });

  it('blocks a user whose role is not required', () => {
    expect(() =>
      guardRequiring(['ADMIN']).canActivate(contextFor({ role: 'USER' })),
    ).toThrow(ForbiddenException);
  });
});
