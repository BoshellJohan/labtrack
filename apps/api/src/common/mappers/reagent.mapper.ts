import { ReagentDto, Unit } from '@labtrack/shared';
import { Reagent, ReagentBatch } from '../../prisma/client';

type ReagentWithBatches = Reagent & { batches: ReagentBatch[] };

/**
 * Stock is reported per unit rather than as one number: a reagent may hold
 * batches measured in millilitres and litres at once, and adding those together
 * would invent a quantity nobody can act on.
 */
export function toReagentDto(reagent: ReagentWithBatches): ReagentDto {
  const totals = new Map<Unit, string>();
  for (const batch of reagent.batches) {
    if (!batch.active) continue;
    const previous = totals.get(batch.unit);
    const sum = previous
      ? batch.currentStock.add(previous)
      : batch.currentStock;
    totals.set(batch.unit, sum.toString());
  }

  return {
    id: reagent.id,
    name: reagent.name,
    casNumber: reagent.casNumber,
    reference: reagent.reference,
    description: reagent.description,
    dataSheetUrl: reagent.dataSheetUrl,
    active: reagent.active,
    createdAt: reagent.createdAt.toISOString(),
    updatedAt: reagent.updatedAt.toISOString(),
    stockByUnit: [...totals].map(([unit, total]) => ({ unit, total })),
    batchCount: reagent.batches.filter((batch) => batch.active).length,
  };
}
