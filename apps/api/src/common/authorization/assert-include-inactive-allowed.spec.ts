import { ForbiddenException } from '@nestjs/common';
import { assertIncludeInactiveAllowed } from './assert-include-inactive-allowed';

describe('assertIncludeInactiveAllowed', () => {
  it('throws Forbidden when a non-admin requests includeInactive', () => {
    expect(() => assertIncludeInactiveAllowed(true, 'USER')).toThrow(
      ForbiddenException,
    );
  });

  it('allows an admin to request includeInactive', () => {
    expect(() => assertIncludeInactiveAllowed(true, 'ADMIN')).not.toThrow();
  });

  it('allows a non-admin when includeInactive is not set', () => {
    expect(() => assertIncludeInactiveAllowed(undefined, 'USER')).not.toThrow();
    expect(() => assertIncludeInactiveAllowed(false, 'USER')).not.toThrow();
  });
});
