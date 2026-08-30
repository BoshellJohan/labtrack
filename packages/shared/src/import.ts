import type { Unit } from './inventory';

// The template's headers, in order. Spanish because they are file content a
// laboratory technician reads in Excel, not interface copy — the same reason
// the export's headers live with its writer.
export const IMPORT_COLUMNS = [
  'Reactivo',
  'CAS',
  'Referencia',
  'Lote',
  'Fecha de entrada',
  'Fecha de vencimiento',
  'Cantidad',
  'Unidad',
  'Ubicación',
] as const;

/**
 * Lower than the export's 10.000 on purpose. Memory is part of it — an import
 * holds the rows twice, once parsed and once in the transaction — but the
 * binding reason is that nobody genuinely reviews a preview longer than this,
 * and a preview nobody reads is a confirmation nobody gave.
 */
export const IMPORT_ROW_LIMIT = 1000;

/** One row as it left the spreadsheet, before any resolution. */
export interface ImportRow {
  /** 1-based row number in the sheet, so an error can name where to look. */
  rowNumber: number;
  reagentName: string;
  casNumber: string;
  reference: string;
  lotNumber: string;
  entryDate: string;
  expirationDate: string;
  /** Read from the cell's text, never its numeric value. */
  quantity: string;
  unit: string;
  locationName: string;
}

/**
 * Codes, not sentences. §5.4 of the MVP spec settled this for the whole system:
 * the response carries a stable code and the client translates it, so raw
 * server text never reaches the interface. These issues are rendered straight
 * into the preview table, which makes this the one place in the import where
 * that rule is load-bearing rather than theoretical.
 */
export type RowIssueCode =
  | 'REQUIRED'
  | 'INVALID_CAS'
  | 'INVALID_QUANTITY'
  | 'INVALID_UNIT'
  | 'INVALID_DATE'
  | 'EXPIRATION_BEFORE_ENTRY'
  | 'TOO_LONG'
  | 'DUPLICATE_LOT'
  | 'LOCATION_NOT_FOUND';

export interface RowIssue {
  column: (typeof IMPORT_COLUMNS)[number];
  code: RowIssueCode;
  /**
   * What the client needs to render the message: the allowed units for
   * INVALID_UNIT, the other row numbers for DUPLICATE_LOT, the limit for
   * TOO_LONG. Primitive values only.
   */
  params?: Record<string, string | number | readonly string[]>;
}

export interface RowVerdict {
  row: ImportRow;
  issues: RowIssue[];
  /**
   * What this row will do to the reagent catalogue if the import proceeds.
   * `reuse` carries the name of the existing reagent so the user can see
   * which one — a typo that creates a near-duplicate is invisible in a list
   * of valid rows and obvious in this column.
   */
  reagent: { action: 'create' } | { action: 'reuse'; existingName: string } | null;
  unit: Unit | null;
  locationId: string | null;
}

export interface ImportPreview {
  verdicts: RowVerdict[];
  summary: {
    totalRows: number;
    invalidRows: number;
    reagentsToCreate: number;
    reagentsToReuse: number;
  };
}
