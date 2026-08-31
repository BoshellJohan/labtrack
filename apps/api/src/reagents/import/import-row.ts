import { ImportRow, RowIssue, UNITS, isUnit } from '@labtrack/shared';
import {
  isValidCasNumber,
  normalizeCasNumber,
} from '../../common/validation/cas-number';
import { normalizeForSearch } from '../../common/text/normalize';

const QUANTITY_SHAPE = /^\d{1,8}(\.\d{1,4})?$/;

/**
 * Validates the shape of a single row: required fields, formats, and the
 * date ordering. No database lookups here — this is what both the preview
 * and the confirm endpoints call, so they can never disagree about what a
 * row's shape allows.
 */
export function validateRowShape(row: ImportRow): RowIssue[] {
  const issues: RowIssue[] = [];

  if (!row.reagentName.trim()) {
    issues.push({ column: 'Reactivo', code: 'REQUIRED' });
  }

  if (!normalizeCasNumber(row.casNumber)) {
    issues.push({ column: 'CAS', code: 'REQUIRED' });
  } else if (!isValidCasNumber(normalizeCasNumber(row.casNumber))) {
    issues.push({ column: 'CAS', code: 'INVALID_CAS' });
  }

  if (!row.lotNumber.trim()) {
    issues.push({ column: 'Lote', code: 'REQUIRED' });
  }

  if (!row.entryDate.trim()) {
    issues.push({ column: 'Fecha de entrada', code: 'REQUIRED' });
  } else if (Number.isNaN(Date.parse(row.entryDate))) {
    issues.push({ column: 'Fecha de entrada', code: 'INVALID_DATE' });
  }

  if (
    row.expirationDate.trim() &&
    Number.isNaN(Date.parse(row.expirationDate))
  ) {
    issues.push({ column: 'Fecha de vencimiento', code: 'INVALID_DATE' });
  } else if (
    row.expirationDate.trim() &&
    row.entryDate.trim() &&
    !Number.isNaN(Date.parse(row.entryDate)) &&
    Date.parse(row.expirationDate) <= Date.parse(row.entryDate)
  ) {
    issues.push({
      column: 'Fecha de vencimiento',
      code: 'EXPIRATION_BEFORE_ENTRY',
    });
  }

  if (!row.quantity.trim()) {
    issues.push({ column: 'Cantidad', code: 'REQUIRED' });
  } else if (!QUANTITY_SHAPE.test(row.quantity.trim())) {
    issues.push({ column: 'Cantidad', code: 'INVALID_QUANTITY' });
  }

  if (!row.unit.trim()) {
    issues.push({ column: 'Unidad', code: 'REQUIRED' });
  } else if (!isUnit(row.unit.trim().toUpperCase())) {
    issues.push({
      column: 'Unidad',
      code: 'INVALID_UNIT',
      params: { allowed: UNITS },
    });
  }

  if (!row.locationName.trim()) {
    issues.push({ column: 'Ubicación', code: 'REQUIRED' });
  }

  return issues;
}

/**
 * Keyed with `normalizeForSearch` on the name — the same function
 * `import.service.ts` uses to resolve reagent identity (see
 * `reagentIdentityKey`) — so this collision check and that resolution can
 * never disagree about what counts as "the same reagent". They disagreed
 * once already: this used to lowercase the name instead, which missed
 * `Acetona` / `Acetóna` as duplicates even though the resolver treats them
 * as one reagent, and the two rows would only collide once written, against
 * the database's partial unique index, well past the point the preview
 * promised to catch it.
 *
 * The CAS number is only trimmed, not lowercased, for the same reason:
 * `import.service.ts` never lowercases it either (a CAS is digits and
 * hyphens, so case never legitimately differs), and keeping both sides
 * identical here removes any question of whether the difference is
 * meaningful.
 */
function lotKey(row: ImportRow): string {
  return `${normalizeForSearch(row.reagentName.trim())}|${normalizeCasNumber(row.casNumber)}|${row.lotNumber.trim().toLowerCase()}`;
}

/**
 * Keys on the pair (reagent, lot) rather than lot alone, matching the
 * database's `(reagentId, lotNumber)` uniqueness — two different reagents
 * may legitimately share a lot number. Returns, for every row involved in a
 * collision, the row numbers of the other rows it collides with.
 */
export function findDuplicateLots(rows: ImportRow[]): Map<number, number[]> {
  const byKey = new Map<string, number[]>();

  for (const row of rows) {
    if (!row.lotNumber.trim()) {
      continue;
    }
    const key = lotKey(row);
    const existing = byKey.get(key) ?? [];
    existing.push(row.rowNumber);
    byKey.set(key, existing);
  }

  const result = new Map<number, number[]>();
  for (const rowNumbers of byKey.values()) {
    if (rowNumbers.length < 2) {
      continue;
    }
    for (const rowNumber of rowNumbers) {
      result.set(
        rowNumber,
        rowNumbers.filter((other) => other !== rowNumber),
      );
    }
  }

  return result;
}
