import { validateRowShape, findDuplicateLots } from './import-row';
import { ImportRow, UNITS } from '@labtrack/shared';

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    rowNumber: 2,
    reagentName: 'Acetona',
    casNumber: '67-64-1',
    reference: '',
    lotNumber: 'L-1',
    entryDate: '2026-08-01',
    expirationDate: '',
    quantity: '2.5000',
    unit: 'ML',
    locationName: 'Estante A1',
    ...overrides,
  };
}

describe('validateRowShape', () => {
  it('accepts a complete, well-formed row', () => {
    expect(validateRowShape(row())).toEqual([]);
  });

  it('rejects a quantity written with a decimal comma rather than guessing', () => {
    // Interpreting '2,5' means deciding what someone meant. Getting that
    // half-right in an inventory import is how a quantity nobody wrote ends
    // up on a shelf.
    const issues = validateRowShape(row({ quantity: '2,5' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].column).toBe('Cantidad');
  });

  it('rejects more than four decimal places, matching the column it will be stored in', () => {
    expect(validateRowShape(row({ quantity: '2.00001' }))).toHaveLength(1);
  });

  it('accepts a unit in any case but refuses to translate one', () => {
    expect(validateRowShape(row({ unit: 'ml' }))).toEqual([]);
    const issues = validateRowShape(row({ unit: 'litros' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('INVALID_UNIT');
    // The allowed units travel as data, so the client can name them in the
    // message a technician reads while fixing the cell.
    expect(issues[0].params?.allowed).toEqual(UNITS);
  });

  it('rejects a CAS whose check digit is wrong', () => {
    expect(validateRowShape(row({ casNumber: '12345-67-9' }))).toHaveLength(1);
  });

  it('requires an expiration date to be after the entry date', () => {
    const issues = validateRowShape(
      row({ entryDate: '2026-08-01', expirationDate: '2026-07-01' }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].column).toBe('Fecha de vencimiento');
  });

  it('allows an empty expiration date, which means the batch does not expire', () => {
    expect(validateRowShape(row({ expirationDate: '' }))).toEqual([]);
  });

  it('reports every problem in a row at once, not just the first', () => {
    // Someone fixing a spreadsheet wants the whole list, not one error per
    // upload cycle.
    const issues = validateRowShape(
      row({
        reagentName: '',
        casNumber: 'nope',
        quantity: 'x',
        unit: 'litros',
      }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });
});

describe('findDuplicateLots', () => {
  it('names both rows of a collision, because fixing one means finding the other', () => {
    const rows = [
      row({ rowNumber: 2, lotNumber: 'L-1' }),
      row({ rowNumber: 5, lotNumber: 'L-1' }),
      row({ rowNumber: 7, lotNumber: 'L-2' }),
    ];
    const duplicates = findDuplicateLots(rows);
    expect(duplicates.get(2)).toEqual([5]);
    expect(duplicates.get(5)).toEqual([2]);
    expect(duplicates.has(7)).toBe(false);
  });

  it('does not collide two rows with the same lot under different reagents', () => {
    // The database's uniqueness is (reagentId, lotNumber), not lotNumber
    // alone — two reagents may legitimately both have a lot called L-1.
    const rows = [
      row({ rowNumber: 2, reagentName: 'Acetona', lotNumber: 'L-1' }),
      row({ rowNumber: 3, reagentName: 'Etanol', lotNumber: 'L-1' }),
    ];
    expect(findDuplicateLots(rows).size).toBe(0);
  });

  it('collides two rows for the same reagent spelled with and without an accent', () => {
    // import.service.ts resolves reagent identity with `normalizeForSearch`,
    // which folds accents (`Acetona` and `Acetóna` are one reagent to it).
    // This check has to agree, or these two rows preview clean and then
    // collide only once written, against the database's partial unique
    // index — exactly the gap closed here.
    const rows = [
      row({ rowNumber: 2, reagentName: 'Acetona', lotNumber: 'L-1' }),
      row({ rowNumber: 5, reagentName: 'Acetóna', lotNumber: 'L-1' }),
    ];
    const duplicates = findDuplicateLots(rows);
    expect(duplicates.get(2)).toEqual([5]);
    expect(duplicates.get(5)).toEqual([2]);
  });
});
