// Kept in the same order as the Unit enum in apps/api/prisma/schema.prisma.
// isUnit() below is what makes a drift between the two visible: the API's
// ValidationPipe rejects anything this list does not contain.
export const UNITS = ['G', 'MG', 'KG', 'ML', 'L', 'UNIT'] as const;

export type Unit = (typeof UNITS)[number];

export function isUnit(value: string): value is Unit {
  return (UNITS as readonly string[]).includes(value);
}

export interface LocationDto {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReagentDto {
  id: string;
  name: string;
  casNumber: string;
  reference: string | null;
  description: string | null;
  dataSheetUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Sum of currentStock across active batches, grouped by unit. */
  stockByUnit: { unit: Unit; total: string }[];
  batchCount: number;
}

export interface ReagentBatchDto {
  id: string;
  reagentId: string;
  reagentName: string;
  lotNumber: string;
  entryDate: string;
  expirationDate: string | null;
  initialStock: string;
  currentStock: string;
  unit: Unit;
  locationId: string;
  locationName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocationRequest {
  name: string;
  description?: string;
}

// `undefined` (omitted) means "leave unchanged"; `null` means "clear it".
// The two are deliberately distinct: collapsing them would make every field
// a PATCH omits clear itself.
export interface UpdateLocationRequest {
  name?: string;
  description?: string | null;
}

export interface CreateReagentRequest {
  name: string;
  casNumber: string;
  reference?: string;
  description?: string;
  dataSheetUrl?: string;
}

// `undefined` (omitted) means "leave unchanged"; `null` means "clear it".
// The two are deliberately distinct: collapsing them would make every field
// a PATCH omits clear itself.
export interface UpdateReagentRequest {
  name?: string;
  casNumber?: string;
  reference?: string | null;
  description?: string | null;
  dataSheetUrl?: string | null;
}

export interface CreateBatchRequest {
  lotNumber: string;
  entryDate: string;
  expirationDate?: string;
  initialStock: string;
  unit: Unit;
  locationId: string;
}

export interface UpdateBatchRequest {
  expirationDate?: string;
  locationId?: string;
}
