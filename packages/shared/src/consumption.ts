import type { Unit } from './inventory';

// Whitelisted because `sortBy` reaches Prisma's `orderBy` as a key. Spec §5.3
// requires the whitelist per module for exactly that reason.
export const CONSUMPTION_SORT_COLUMNS = ['consumedAt', 'quantity'] as const;

export type ConsumptionSortColumn = (typeof CONSUMPTION_SORT_COLUMNS)[number];

export function isConsumptionSortColumn(
  value: string,
): value is ConsumptionSortColumn {
  return (CONSUMPTION_SORT_COLUMNS as readonly string[]).includes(value);
}

export interface ConsumptionDto {
  id: string;
  batchId: string;
  lotNumber: string;
  reagentId: string;
  reagentName: string;
  /** Decimal(12,4) as a string: a JS number loses precision. */
  quantity: string;
  /** The unit of the batch this was drawn from; consumption never converts. */
  unit: Unit;
  consumedAt: string;
  purpose: string;
  active: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  madeByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConsumptionRequest {
  batchId: string;
  quantity: string;
  consumedAt: string;
  purpose: string;
}

export interface VoidConsumptionRequest {
  voidReason: string;
}

export interface ConsumptionFilters {
  reagentId?: string;
  batchId?: string;
  madeById?: string;
  purpose?: string;
  from?: string;
  to?: string;
  includeVoided?: boolean;
}
