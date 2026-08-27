import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';
import { normalizeForSearch } from '../common/text/normalize';

/**
 * Translates the simple filters into a Prisma `where`. Internal to this file:
 * callers only need `selectReagentIds` below.
 */
function buildReagentWhere(
  query: ListReagentsQueryDto,
): Prisma.ReagentWhereInput {
  const where: Prisma.ReagentWhereInput = {};

  if (!query.includeInactive) {
    where.active = true;
  }
  if (query.name) {
    // Both sides normalized: the column by Postgres, the term by us. `mode`
    // is gone because the column is already lowercased — asking for
    // case-insensitivity here would defeat the trigram index.
    where.nameNormalized = { contains: normalizeForSearch(query.name) };
  }
  if (query.casNumber) {
    where.casNumber = query.casNumber;
  }
  if (query.locationId) {
    // A reagent matches a location when any of its active batches sits there.
    where.batches = { some: { active: true, locationId: query.locationId } };
  }

  // Both of these ask about a reagent's *batches*, so they are `some` clauses
  // over active batches — a reagent qualifies when at least one batch does.
  // They are separate `some` clauses on purpose: combining them into one would
  // demand a single batch that is both expiring and low, which is a narrower
  // question than either filter asks.
  if (query.expiringBefore) {
    where.batches = {
      ...(where.batches ?? {}),
      some: {
        ...(where.batches?.some ?? {}),
        active: true,
        expirationDate: { not: null, lte: new Date(query.expiringBefore) },
      },
    };
  }
  if (query.lowStock) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        batches: {
          some: { active: true, currentStock: { lte: query.lowStock } },
        },
      },
    ];
  }

  return where;
}

export interface ReagentIdSelection {
  ids: string[];
  total: number;
}

/**
 * Resolves which reagent ids qualify for one page of `list()`, and how many
 * qualify in total.
 *
 * This owns the whole of step one — not just the `where`. Spec §6.2 adds a
 * filter that cannot be expressed as a `where` at all: "reagents whose
 * consumption exceeded X in a date range" is a HAVING over grouped
 * consumptions, and it will arrive as a raw-query strategy that returns ids
 * from `$queryRaw` instead of `findMany`. That strategy becomes a new branch
 * inside this function — its own `where`, `count`, ordering and paging — so
 * `list()`'s hydration step and the controller never need to change.
 *
 * `id` is a secondary sort key so the ordering here matches, row for row, the
 * ordering `list()` repeats when it hydrates these same ids: two reagents
 * that tie on `sortBy` would otherwise not be guaranteed the same tie-break
 * across two separately executed queries.
 */
export async function selectReagentIds(
  prisma: PrismaService,
  query: ListReagentsQueryDto,
): Promise<ReagentIdSelection> {
  const where = buildReagentWhere(query);

  // The count uses the same `where` as the page, and both run in the same
  // transaction, so the total can never disagree with the rows it counts.
  const [rows, total] = await prisma.$transaction([
    prisma.reagent.findMany({
      where,
      select: { id: true },
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
      skip: query.skip,
      take: query.pageSize,
    }),
    prisma.reagent.count({ where }),
  ]);

  return { ids: rows.map((row) => row.id), total };
}
