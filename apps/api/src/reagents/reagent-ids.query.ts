import { Prisma } from '../prisma/client';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

/**
 * Translates the simple filters into a Prisma `where`.
 *
 * This is deliberately separate from the service: spec §6.2 adds a filter that
 * cannot be expressed as a `where` at all — "reagents whose consumption exceeded
 * X in a date range" is a HAVING over grouped consumptions, and it will arrive
 * as a second strategy that returns ids from a raw query. Keeping id selection
 * apart from hydration means that arrives as a new branch here rather than as a
 * rewrite of list().
 */
export function buildReagentWhere(
  query: ListReagentsQueryDto,
): Prisma.ReagentWhereInput {
  const where: Prisma.ReagentWhereInput = {};

  if (!query.includeInactive) {
    where.active = true;
  }
  if (query.name) {
    where.name = { contains: query.name, mode: 'insensitive' };
  }
  if (query.casNumber) {
    where.casNumber = query.casNumber;
  }
  if (query.locationId) {
    // A reagent matches a location when any of its active batches sits there.
    where.batches = { some: { active: true, locationId: query.locationId } };
  }

  return where;
}
