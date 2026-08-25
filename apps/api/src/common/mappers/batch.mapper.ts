import { ReagentBatchDto } from '@labtrack/shared';
import { Location, Reagent, ReagentBatch } from '../../prisma/client';

type BatchWithRelations = ReagentBatch & {
  reagent: Pick<Reagent, 'name'>;
  location: Pick<Location, 'name'>;
};

export function toBatchDto(batch: BatchWithRelations): ReagentBatchDto {
  return {
    id: batch.id,
    reagentId: batch.reagentId,
    reagentName: batch.reagent.name,
    lotNumber: batch.lotNumber,
    entryDate: batch.entryDate.toISOString(),
    expirationDate: batch.expirationDate
      ? batch.expirationDate.toISOString()
      : null,
    // Decimal is stringified rather than converted to a number: the whole point
    // of Decimal(12,4) is that it does not fit a JS number without loss.
    initialStock: batch.initialStock.toString(),
    currentStock: batch.currentStock.toString(),
    unit: batch.unit,
    locationId: batch.locationId,
    locationName: batch.location.name,
    active: batch.active,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}
