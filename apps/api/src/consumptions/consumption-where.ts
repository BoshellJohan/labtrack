import { Prisma } from '../prisma/client';
import { ListConsumptionsQueryDto } from './dto/list-consumptions-query.dto';

/**
 * The single definition of what a consumption filter means.
 *
 * It lives here rather than inside `list()` because the export
 * (spec §4) needs exactly the same rules, and a second copy is how the two
 * drift. That is not hypothetical: the rule below hiding deactivated batches
 * and reagents from non-admins was missing from this endpoint entirely until
 * Phase 3's final review, after the same rule had been hardened in three
 * places where it could not actually be reached.
 */
export function buildConsumptionWhere(
  query: ListConsumptionsQueryDto,
  isAdmin: boolean,
): Prisma.ConsumptionWhereInput {
  const where: Prisma.ConsumptionWhereInput = {};

  if (!query.includeVoided) {
    where.active = true;
  }
  if (query.batchId) {
    where.batchId = query.batchId;
  }
  if (query.reagentId) {
    // A consumption belongs to a batch, and a batch to a reagent: filtering
    // by reagent means "any of that reagent's batches".
    where.batch = {
      reagentId: query.reagentId,
      // A non-admin must never read a deactivated reagent's or batch's
      // name, lot number or history through this endpoint: those are
      // "deleted" for them everywhere else (spec §6.1), and consumptions
      // otherwise carries them straight through with no filter of its own.
      ...(isAdmin ? {} : { active: true, reagent: { active: true } }),
    };
  } else if (!isAdmin) {
    where.batch = { active: true, reagent: { active: true } };
  }
  if (query.madeById) {
    where.madeById = query.madeById;
  }
  if (query.purpose) {
    where.purpose = { contains: query.purpose, mode: 'insensitive' };
  }
  if (query.from || query.to) {
    where.consumedAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }

  return where;
}
