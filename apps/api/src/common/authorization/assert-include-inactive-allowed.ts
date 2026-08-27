import { ForbiddenException } from '@nestjs/common';
import { Role } from '../../prisma/client';

/**
 * Spec §6.1 restricts `includeInactive` to ADMIN on every list endpoint that
 * exposes it (reagents, locations, a reagent's batches), and spec §6.3
 * applies the same rule to `includeVoided` on consumptions. Soft-delete is
 * this system's only delete, so this is the line between "deactivated"/
 * "voided" and "gone" for everyone but an administrator.
 *
 * The list handlers are otherwise open to any authenticated user, so this
 * cannot be a controller-level `@Roles` guard: it has to gate one parameter,
 * not the endpoint. Call it before the flag is honoured; a non-admin sending
 * `includeInactive=true` gets a 403 rather than the flag being silently
 * dropped, so the request fails loudly instead of returning a response that
 * quietly differs from what was asked for.
 */
export function assertIncludeInactiveAllowed(
  includeSoftDeleted: boolean | undefined,
  role: Role,
): void {
  if (includeSoftDeleted && role !== 'ADMIN') {
    throw new ForbiddenException(
      'Only an administrator may request inactive records',
    );
  }
}
