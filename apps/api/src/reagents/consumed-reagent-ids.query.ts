import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

/**
 * Spec §6.2: "reagents whose consumption exceeded X, with or without a date
 * range". This is a HAVING over grouped consumptions, which Prisma's query API
 * cannot express over a nested relation — hence the one hand-written query in
 * this codebase.
 *
 * It answers only the aggregation question. The simple filters (name, CAS,
 * location, expiry, low stock, includeInactive) stay in `buildReagentWhere`
 * and are applied by the caller, so they keep a single definition and cannot
 * drift between two languages.
 *
 * The unit is part of the grouping, not incidental: a reagent may hold
 * millilitres and litres at once, and summing across them would produce a
 * number that corresponds to no physical quantity. See the spec amendment in
 * the Phase 4 plan.
 *
 * Returns `null` when the filter does not apply, which is different from `[]`:
 * `[]` means the filter applied and nothing qualified, and must yield an empty
 * page rather than the unfiltered list.
 */
export async function selectConsumedReagentIds(
  prisma: PrismaService,
  query: ListReagentsQueryDto,
): Promise<string[] | null> {
  if (!query.minConsumed || !query.minConsumedUnit) {
    return null;
  }

  const from = query.consumedFrom ? new Date(query.consumedFrom) : null;
  const to = query.consumedTo ? new Date(query.consumedTo) : null;

  // Every value below is a binding. Prisma's tagged template turns each `${}`
  // into a placeholder and sends the value separately; none of them is ever
  // concatenated into the SQL text.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT r.id
    FROM   "Reagent" r
    JOIN   "ReagentBatch" b
      ON   b."reagentId" = r.id AND b.active AND b.unit = ${query.minConsumedUnit}::"Unit"
    JOIN   "Consumption" c
      ON   c."batchId" = b.id AND c.active
    WHERE  r.active
      AND  (${from}::timestamptz IS NULL OR c."consumedAt" >= ${from}::timestamptz)
      AND  (${to}::timestamptz   IS NULL OR c."consumedAt" <= ${to}::timestamptz)
    GROUP BY r.id
    HAVING SUM(c.quantity) > ${new Prisma.Decimal(query.minConsumed)}
  `;

  return rows.map((row) => row.id);
}
