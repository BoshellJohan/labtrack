import { ConsumptionDto } from '@labtrack/shared';
import { Consumption, Reagent, ReagentBatch, User } from '../../prisma/client';

export type ConsumptionWithRelations = Consumption & {
  batch: Pick<ReagentBatch, 'lotNumber' | 'unit' | 'reagentId'> & {
    reagent: Pick<Reagent, 'name'>;
  };
  madeBy: Pick<User, 'fullName'>;
  voidedBy: Pick<User, 'fullName'> | null;
};

export function toConsumptionDto(
  consumption: ConsumptionWithRelations,
): ConsumptionDto {
  return {
    id: consumption.id,
    batchId: consumption.batchId,
    lotNumber: consumption.batch.lotNumber,
    reagentId: consumption.batch.reagentId,
    reagentName: consumption.batch.reagent.name,
    // Stringified, not converted: Decimal(12,4) is used precisely because it
    // does not fit a JS number without loss.
    quantity: consumption.quantity.toString(),
    unit: consumption.batch.unit,
    consumedAt: consumption.consumedAt.toISOString(),
    purpose: consumption.purpose,
    active: consumption.active,
    // The void reason lives on the row itself (spec §4.4), so explaining a
    // disappearance never needs a join to an audit table.
    voidReason: consumption.voidReason,
    voidedAt: consumption.voidedAt ? consumption.voidedAt.toISOString() : null,
    voidedByName: consumption.voidedBy ? consumption.voidedBy.fullName : null,
    madeByName: consumption.madeBy.fullName,
    createdAt: consumption.createdAt.toISOString(),
    updatedAt: consumption.updatedAt.toISOString(),
  };
}
