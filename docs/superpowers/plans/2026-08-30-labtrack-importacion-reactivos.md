# LabTrack — Importación de reactivos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator load a laboratory's existing inventory from a spreadsheet, seeing exactly what will be created before anything is written.

**Architecture:** Two stateless endpoints. The preview parses and validates and writes nothing; the confirm re-validates the rows the client echoes back — with the same function — and writes them in one all-or-nothing transaction. Validation splits in two: a pure per-row shape check that needs no database, and a resolution pass that looks up locations and decides, per row, whether a reagent will be created or reused.

**Tech Stack:** NestJS 11, Prisma 7, ExcelJS (already installed by the export), Multer via Nest's `FileInterceptor`, Angular 22.

**Spec:** `docs/superpowers/specs/2026-08-30-labtrack-importacion-reactivos-design.md`

## Global Constraints

- Code, identifiers, file names, comments and commit messages in **English**. Every user-visible string is **Spanish** and lives in an `i18n.es.ts` dictionary — never a literal in a template. Spreadsheet column headers are file content and live with the parser, as the export's do.
- **Both endpoints are ADMIN only.** Creating reagents and batches already is; the import must not be a side door into what manual creation restricts.
- **All or nothing.** One invalid row means nothing is written. There is no partial import.
- **Quantities are read from `cell.value`, not `cell.text`** — number goes through `String()`, text is used as-is. Measured against ExcelJS: a numeric cell formatted `0.0000` reports `text = "2.5"`, so the text follows the display and could arrive comma-separated in a Spanish locale, rejecting a valid cell. There is no precision risk either way (a `Decimal(12,4)` holds at most 12 significant digits and a `double` round-trips 15–17), so robustness decides it. Validate with `/^\d{1,8}(\.\d{1,4})?$/`, the same pattern `create-batch.dto.ts` uses.
- **1.000 rows maximum**, and a byte limit on the upload. Over either, reject without writing.
- `madeById` comes from the authenticated user, **never from the file**.
- Conventional commit prefixes. TDD: the failing test comes first, and you must see it fail for the stated reason.
- Run `npm run build -w apps/api` before declaring any API task done.
- **Before any e2e run: no dev server on port 3000, and one e2e invocation at a time.** A live connection stalls the suite's `TRUNCATE` and turns a green run red with no evidence in its own output. Check with `netstat -ano | grep ":3000"`.
- If you run a mutation to check a test, make the restore **unconditional** (`trap ... EXIT`), never chained behind a long command.

## Baselines

api unit **90**, api e2e **125**, web **108**, web bundle **416.38 kB** against a 500 kB budget, api lint **0 errors**.

---

## A constraint the architecture imposes, stated once

`ReagentsService.create` writes through `this.prisma`, and `BatchesService.create` opens its **own** `runInTransaction`. Neither can join a transaction opened elsewhere — `TransactionClient` omits `$transaction` precisely to stop a nested one.

So the import's write path issues its `create` calls directly against the `tx` client (Task 5). That is a second place where reagent and batch rows are created, and the plan accepts it because the alternative — reworking two services to take an optional transaction client — is a larger change to code that currently works.

What must **not** be duplicated is the validation. Every rule about what makes a row acceptable lives in Tasks 1 and 3 and is called from both endpoints.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/common/validation/cas-number.ts` | **new** — `isValidCasNumber`, shape plus check digit |
| `apps/api/src/reagents/dto/create-reagent.dto.ts` | uses the shared CAS validator |
| `packages/shared/src/import.ts` | **new** — the row, verdict and preview contracts |
| `apps/api/src/reagents/import/import-row.ts` | **new** — pure per-row shape validation |
| `apps/api/src/reagents/import/parse-workbook.ts` | **new** — buffer → raw rows, row cap |
| `apps/api/src/reagents/import/import.service.ts` | **new** — resolution, preview, transactional write |
| `apps/api/src/reagents/import/import.controller.ts` | **new** — the two ADMIN routes |
| `apps/web/src/app/features/reagents/import/` | **new** — the screen, its store and dictionary |

---

## Task 1: The CAS check digit

Spec §6.4. `create-reagent.dto.ts` checks the shape `\d{2,7}-\d{2}-\d` and stops there, so `12345-67-9` is accepted today although its check digit is wrong. That is tolerable one reagent at a time and stops being tolerable when hundreds arrive from a catalogue.

**Files:**
- Create: `apps/api/src/common/validation/cas-number.ts`
- Create: `apps/api/src/common/validation/cas-number.spec.ts`
- Modify: `apps/api/src/reagents/dto/create-reagent.dto.ts`
- Test: `apps/api/test/reagents.e2e-spec.ts`

**Interfaces:**
- Produces: `isValidCasNumber(value: string): boolean` and the class-validator decorator `IsCasNumber()`.

- [ ] **Step 1: Write the failing spec**

Create `apps/api/src/common/validation/cas-number.spec.ts`:

```ts
import { isValidCasNumber } from './cas-number';

describe('isValidCasNumber', () => {
  // Verified against the real registry before this plan was written: each of
  // these is the CAS of a reagent this project already uses as a fixture.
  it.each([
    ['7647-01-0', 'ácido clorhídrico'],
    ['67-64-1', 'acetona'],
    ['64-17-5', 'etanol'],
    ['7440-31-5', 'estaño'],
  ])('accepts %s (%s)', (cas) => {
    expect(isValidCasNumber(cas)).toBe(true);
  });

  it('rejects a well-shaped number whose check digit is wrong', () => {
    // This is the case the current DTO lets through: the shape matches and
    // the digit does not.
    expect(isValidCasNumber('12345-67-9')).toBe(false);
  });

  it('rejects anything that is not shaped like a CAS at all', () => {
    expect(isValidCasNumber('67641')).toBe(false);
    expect(isValidCasNumber('67-64')).toBe(false);
    expect(isValidCasNumber('abc-de-f')).toBe(false);
    expect(isValidCasNumber('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w apps/api -- cas-number`
Expected: FAIL — `Cannot find module './cas-number'`.

- [ ] **Step 3: Implement**

```ts
import {
  ValidationOptions,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';

const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/**
 * A CAS registry number carries its own checksum: reading the digits before
 * the final one from right to left, each is multiplied by its 1-based
 * position, and the sum modulo 10 must equal that final digit.
 *
 * The shape alone accepts `12345-67-9`, which is not a CAS number — it just
 * looks like one. That distinction does not matter much when someone types a
 * reagent by hand; it matters when hundreds arrive from a spreadsheet.
 */
export function isValidCasNumber(value: string): boolean {
  if (!CAS_SHAPE.test(value)) {
    return false;
  }

  const digits = value.replace(/-/g, '');
  const checkDigit = Number(digits.slice(-1));
  const sum = digits
    .slice(0, -1)
    .split('')
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index + 1), 0);

  return sum % 10 === checkDigit;
}

export function IsCasNumber(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isCasNumber',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidCasNumber(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a valid CAS number, e.g. 67-64-1`,
      },
    });
  };
}
```

- [ ] **Step 4: Use it in the DTO**

In `create-reagent.dto.ts`, replace the `@Matches(/^\d{2,7}-\d{2}-\d$/, ...)` on `casNumber` with `@IsCasNumber()`, keeping `@IsString()`. Leave the surrounding comment but update it to say the checksum is verified, not only the shape.

- [ ] **Step 5: Pin the behaviour change end to end**

Add to `apps/api/test/reagents.e2e-spec.ts`:

```ts
it('rejects a CAS number whose check digit is wrong', async () => {
  const token = await tokenFor('admin');
  await request(app.getHttpServer())
    .post('/reagents')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Inventado', casNumber: '12345-67-9' })
    .expect(400);
});
```

- [ ] **Step 6: Verify**

Run: `npm run test -w apps/api` — baseline 90, expect **97**.
Run: `npm run test:e2e -w apps/api` — baseline 125, expect **126**.

**No fixture should break, and that is checked rather than hoped.** I extracted every CAS-shaped literal in `apps/` and `packages/` before writing this plan and ran the check digit over all of them: `64-17-5`, `67-56-1`, `67-64-1`, `7440-31-5` and `7647-01-0` — five distinct numbers, all valid. So if a test does break here, it is not a stale fixture: read the failure, because something else is wrong.
Run: `npm run build -w apps/api` and `npm run lint -w apps/api` — exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/validation apps/api/src/reagents/dto/create-reagent.dto.ts apps/api/test/reagents.e2e-spec.ts
git commit -m "feat(api): validate the CAS check digit, not just its shape"
```

---

## Task 2: The shared import contract

**Files:**
- Create: `packages/shared/src/import.ts`
- Create: `packages/shared/src/import.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Unit` from `./inventory`.
- Produces: `ImportRow`, `RowIssue`, `RowVerdict`, `ImportPreview`, `IMPORT_ROW_LIMIT`, `IMPORT_COLUMNS`.

- [ ] **Step 1: Write the failing test**

```ts
import { IMPORT_COLUMNS, IMPORT_ROW_LIMIT } from './import';

describe('the import contract', () => {
  it('names every column the template requires, in order', () => {
    expect(IMPORT_COLUMNS).toEqual([
      'Reactivo',
      'CAS',
      'Referencia',
      'Lote',
      'Fecha de entrada',
      'Fecha de vencimiento',
      'Cantidad',
      'Unidad',
      'Ubicación',
    ]);
  });

  it('caps an import well below the export, because a human has to read the preview', () => {
    expect(IMPORT_ROW_LIMIT).toBe(1000);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w packages/shared`
Expected: FAIL — `Cannot find module './import'`.

- [ ] **Step 3: Write the types**

```ts
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

export interface RowIssue {
  column: (typeof IMPORT_COLUMNS)[number];
  message: string;
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
```

- [ ] **Step 4: Export and verify**

Add `export * from './import';` to `packages/shared/src/index.ts`.

Run: `npm run test -w packages/shared` — expected PASS.
Run: `npm run build -w apps/api` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add the reagent import contract"
```

---

## Task 3: Parsing and shape validation

The half of validation that needs no database. Keeping it pure is what makes it cheap to test exhaustively, and every rule here is called from **both** endpoints — the preview and the confirm — which is what stops them diverging.

**Files:**
- Create: `apps/api/src/reagents/import/parse-workbook.ts`
- Create: `apps/api/src/reagents/import/parse-workbook.spec.ts`
- Create: `apps/api/src/reagents/import/import-row.ts`
- Create: `apps/api/src/reagents/import/import-row.spec.ts`

**Interfaces:**
- Consumes: `ImportRow`, `RowIssue`, `IMPORT_COLUMNS`, `IMPORT_ROW_LIMIT` from Task 2; `isValidCasNumber` from Task 1.
- Produces: `parseWorkbook(buffer: Buffer): Promise<ImportRow[]>` and `validateRowShape(row: ImportRow): RowIssue[]`, plus `findDuplicateLots(rows: ImportRow[]): Map<number, number[]>`.

- [ ] **Step 1: Write the shape-validation spec**

```ts
import { validateRowShape, findDuplicateLots } from './import-row';
import { ImportRow } from '@labtrack/shared';

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
    // The message must list what is valid: the reader has to fix the cell.
    expect(issues[0].message).toContain('ML');
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
      row({ reagentName: '', casNumber: 'nope', quantity: 'x', unit: 'litros' }),
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
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w apps/api -- import-row`
Expected: FAIL — `Cannot find module './import-row'`.

- [ ] **Step 3: Implement `import-row.ts`**

`validateRowShape` returns **every** issue it finds, one per broken rule, each naming its column. Required fields, the CAS through `isValidCasNumber`, the quantity through `/^\d{1,8}(\.\d{1,4})?$/`, the unit against `UNITS` case-insensitively, and the date ordering.

`findDuplicateLots` keys on the pair (normalised reagent name + CAS, lot number) — matching the database's `(reagentId, lotNumber)` uniqueness rather than lot number alone — and returns, for every row in a collision, the other row numbers it collides with.

- [ ] **Step 4: Write the parsing spec**

```ts
import * as ExcelJS from 'exceljs';
import { parseWorkbook } from './parse-workbook';
import { IMPORT_COLUMNS } from '@labtrack/shared';

async function workbookWith(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Reactivos');
  sheet.addRow([...IMPORT_COLUMNS]);
  rows.forEach((row) => sheet.addRow(row));
  return (await workbook.xlsx.writeBuffer()) as Buffer;
}

describe('parseWorkbook', () => {
  it('reads a text-formatted quantity exactly as written', async () => {
    const buffer = await workbookWith([
      ['Acetona', '67-64-1', '', 'L-1', '2026-08-01', '', '2.5000', 'ML', 'Estante A1'],
    ]);
    expect((await parseWorkbook(buffer))[0].quantity).toBe('2.5000');
  });

  it('reads a numeric quantity from the cell value, not from how it is displayed', async () => {
    // Write a real number rather than a string, which is what a technician
    // typing into Excel produces. Reading `cell.text` here would follow the
    // display format and could return a comma-separated value in a Spanish
    // locale, rejecting a perfectly valid cell.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Reactivos');
    sheet.addRow([...IMPORT_COLUMNS]);
    sheet.addRow(['Acetona', '67-64-1', '', 'L-1', '2026-08-01', '', 2.5, 'ML', 'Estante A1']);
    sheet.getCell('G2').numFmt = '0.0000';
    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;

    // '2.5' and not '2.5000': the trailing zeros are display scale, and
    // Decimal(12,4) stores 2.5 and 2.5000 as the same number anyway.
    expect((await parseWorkbook(buffer))[0].quantity).toBe('2.5');
  });

  it('numbers rows as the spreadsheet does, so an error names a row the user can find', async () => {
    const buffer = await workbookWith([
      ['Acetona', '67-64-1', '', 'L-1', '2026-08-01', '', '1', 'ML', 'Estante A1'],
    ]);
    // Row 1 is the header, so the first data row is 2 — what Excel shows.
    expect((await parseWorkbook(buffer))[0].rowNumber).toBe(2);
  });

  it('refuses a file whose headers are not the template', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Reactivos').addRow(['Nombre', 'CAS']);
    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;
    await expect(parseWorkbook(buffer)).rejects.toThrow(/plantilla|template/i);
  });

  it('refuses a file over the row limit instead of truncating it', async () => {
    const many = Array.from({ length: 1001 }, () => [
      'Acetona', '67-64-1', '', 'L-1', '2026-08-01', '', '1', 'ML', 'Estante A1',
    ]);
    await expect(parseWorkbook(await workbookWith(many))).rejects.toThrow(/1000/);
  });
});
```

- [ ] **Step 5: Implement `parse-workbook.ts`**

Loads the buffer with ExcelJS, checks the header row equals `IMPORT_COLUMNS`, then reads each data row from **`cell.value`** — a number goes through `String()`, a string is used as-is — with a comment saying why: `cell.text` follows the cell's display format, so a numeric cell shown with a comma separator would arrive as `2,5` and be rejected although it is valid. Throws a `BadRequestException` on a wrong template or over `IMPORT_ROW_LIMIT`.

- [ ] **Step 6: Verify**

Run: `npm run test -w apps/api` — expect **97 + your new tests**.
Run: `npm run build -w apps/api` and `npm run lint -w apps/api` — exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reagents/import
git commit -m "feat(api): parse and shape-validate an import sheet"
```

---

## Task 4: Resolution and the preview endpoint

The half of validation that needs the database — does this location exist, does this reagent already — plus the route that returns it all without writing anything.

**Files:**
- Create: `apps/api/src/reagents/import/import.service.ts`
- Create: `apps/api/src/reagents/import/import.controller.ts`
- Create: `apps/api/src/reagents/import/import.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/reagents-import.e2e-spec.ts`

**Interfaces:**
- Consumes: `parseWorkbook`, `validateRowShape`, `findDuplicateLots` from Task 3; `ImportPreview`, `RowVerdict` from Task 2.
- Produces: `ImportService.preview(rows: ImportRow[]): Promise<ImportPreview>` and `POST /reagents/import/preview`.

Install first: `npm install @nestjs/platform-express -w apps/api` if it is not already a dependency (Nest's `FileInterceptor` comes from it), and `npm install --save-dev @types/multer -w apps/api`.

- [ ] **Step 1: Write the failing e2e**

Create `apps/api/test/reagents-import.e2e-spec.ts`, mirroring the harness in `consumptions-export.e2e-spec.ts`. Seed an admin, a non-admin `ana`, a location `Estante A1`, and a reagent `Acetona` with CAS `67-64-1`.

Build the upload with supertest's `.attach('file', buffer, 'inventario.xlsx')`.

```ts
it('says a row will reuse a reagent when name and CAS both match', async () => {
  const buffer = await workbookWith([
    ['Acetona', '67-64-1', '', 'L-9', '2026-08-01', '', '5', 'ML', 'Estante A1'],
  ]);
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .post('/reagents/import/preview')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buffer, 'inventario.xlsx')
    .expect(201);

  const preview = body<ImportPreview>(response);
  expect(preview.verdicts[0].reagent).toEqual({ action: 'reuse', existingName: 'Acetona' });
  expect(preview.summary.reagentsToReuse).toBe(1);
});

it('matches a reagent ignoring case and accents, reusing the search column', async () => {
  // 'ACETÓNA' against the stored 'Acetona'. nameNormalized already exists for
  // the reagents search; using it here is one fewer silent duplicate.
  const buffer = await workbookWith([
    ['ACETÓNA', '67-64-1', '', 'L-9', '2026-08-01', '', '5', 'ML', 'Estante A1'],
  ]);
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .post('/reagents/import/preview')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buffer, 'inventario.xlsx')
    .expect(201);

  expect(body<ImportPreview>(response).verdicts[0].reagent).toEqual({
    action: 'reuse',
    existingName: 'Acetona',
  });
});

it('says it will create when the CAS differs, even if the name matches', async () => {
  const buffer = await workbookWith([
    ['Acetona', '64-17-5', '', 'L-9', '2026-08-01', '', '5', 'ML', 'Estante A1'],
  ]);
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .post('/reagents/import/preview')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buffer, 'inventario.xlsx')
    .expect(201);

  expect(body<ImportPreview>(response).verdicts[0].reagent).toEqual({ action: 'create' });
});

it('flags a location that does not exist rather than creating one', async () => {
  const buffer = await workbookWith([
    ['Acetona', '67-64-1', '', 'L-9', '2026-08-01', '', '5', 'ML', 'Estante Z'],
  ]);
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .post('/reagents/import/preview')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buffer, 'inventario.xlsx')
    .expect(201);

  const verdict = body<ImportPreview>(response).verdicts[0];
  expect(verdict.issues.map((i) => i.column)).toContain('Ubicación');
  expect(verdict.locationId).toBeNull();
});

it('writes nothing at all', async () => {
  const before = await prisma.reagent.count();
  const buffer = await workbookWith([
    ['Nuevo', '64-17-5', '', 'L-9', '2026-08-01', '', '5', 'ML', 'Estante A1'],
  ]);
  const token = await tokenFor('admin');
  await request(app.getHttpServer())
    .post('/reagents/import/preview')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buffer, 'inventario.xlsx')
    .expect(201);

  // A preview that writes is not a preview.
  expect(await prisma.reagent.count()).toBe(before);
});

it('refuses a non-admin', async () => {
  const buffer = await workbookWith([
    ['Acetona', '67-64-1', '', 'L-9', '2026-08-01', '', '5', 'ML', 'Estante A1'],
  ]);
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .post('/reagents/import/preview')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buffer, 'inventario.xlsx')
    .expect(403);
});
```

`workbookWith` is the same local helper as Task 3's parsing spec; copy it into this file rather than exporting it from `src/` — a test helper does not belong in production code.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- reagents-import`
Expected: FAIL with 404 — the route does not exist.

- [ ] **Step 3: Write the service's resolution**

`preview(rows)` does, in this order:

1. `validateRowShape` on every row, collecting issues.
2. `findDuplicateLots`, adding an issue to **both** rows of each collision naming the other row number.
3. One query for every distinct location name in the file, matching **active** locations; rows whose location is missing get an issue on `Ubicación` and a null `locationId`.
4. One query for every distinct (normalised name, CAS) pair, against `nameNormalized` and `casNumber`; a hit yields `{ action: 'reuse', existingName }`, a miss `{ action: 'create' }`.
5. The summary counts.

Steps 3 and 4 are **two queries, not two per row**. A 1.000-row file must not issue 2.000 lookups.

Normalise the sheet's reagent name with the same `normalizeForSearch` the reagents search uses (`apps/api/src/common/text/normalize.ts`), so the comparison against `nameNormalized` is like for like. That function and the generated column are two halves of one rule — a defect from Phase 3 came from letting them disagree.

- [ ] **Step 4: Write the controller**

```ts
@Controller('reagents/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  // ADMIN only, on both routes: creating reagents and batches already is, and
  // an import must not be a side door into what manual creation restricts.
  @Post('preview')
  @Roles('ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      // A byte ceiling is not optional on an endpoint that accepts files.
      // The row limit bounds what we will process; this bounds what we will
      // even read into memory.
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async preview(@UploadedFile() file: Express.Multer.File): Promise<ImportPreview> {
    if (!file) {
      throw new BadRequestException('A spreadsheet file is required');
    }
    const rows = await parseWorkbook(file.buffer);
    return this.imports.preview(rows);
  }
}
```

Register `ImportModule` in `app.module.ts`.

- [ ] **Step 5: Verify**

Run: `npm run test:e2e -w apps/api` — baseline 126, expect **132**.
Run: `npm run test -w apps/api`, `npm run build -w apps/api`, `npm run lint -w apps/api` — all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reagents/import apps/api/src/app.module.ts apps/api/test/reagents-import.e2e-spec.ts apps/api/package.json package-lock.json
git commit -m "feat(api): preview a reagent import without writing anything"
```

---

## Task 5: The confirm endpoint

**Files:**
- Modify: `apps/api/src/reagents/import/import.service.ts`
- Modify: `apps/api/src/reagents/import/import.controller.ts`
- Create: `apps/api/src/reagents/import/dto/confirm-import.dto.ts`
- Test: `apps/api/test/reagents-import.e2e-spec.ts`

**Interfaces:**
- Consumes: everything from Task 4; `runInTransaction` from `apps/api/src/common/prisma/transaction.ts`.
- Produces: `ImportService.confirm(rows: ImportRow[], actorId: string): Promise<{ reagentsCreated: number; batchesCreated: number }>` and `POST /reagents/import/confirm`.

- [ ] **Step 1: Write the failing e2e**

```ts
it('creates the reagent and its batch, recording the importer as the author', async () => {
  const token = await tokenFor('admin');
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const response = await request(app.getHttpServer())
    .post('/reagents/import/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ rows: [rowFor({ reagentName: 'Nuevo', casNumber: '64-17-5' })] })
    .expect(201);

  expect(body<{ reagentsCreated: number }>(response).reagentsCreated).toBe(1);
  const created = await prisma.reagent.findFirstOrThrow({ where: { name: 'Nuevo' } });
  // Never from the file: the author is whoever was authenticated.
  expect(created.madeById).toBe(admin.id);
});

it('adds a batch to the existing reagent when name and CAS match', async () => {
  const token = await tokenFor('admin');
  const before = await prisma.reagent.count();
  await request(app.getHttpServer())
    .post('/reagents/import/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ rows: [rowFor({ reagentName: 'Acetona', casNumber: '67-64-1', lotNumber: 'L-77' })] })
    .expect(201);

  expect(await prisma.reagent.count()).toBe(before);
  expect(await prisma.reagentBatch.findFirst({ where: { lotNumber: 'L-77' } })).not.toBeNull();
});

it('writes nothing when a single row is invalid', async () => {
  const token = await tokenFor('admin');
  const reagentsBefore = await prisma.reagent.count();
  const batchesBefore = await prisma.reagentBatch.count();

  await request(app.getHttpServer())
    .post('/reagents/import/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({
      rows: [
        rowFor({ reagentName: 'Buena 1', casNumber: '64-17-5', lotNumber: 'A' }),
        rowFor({ reagentName: 'Buena 2', casNumber: '7440-31-5', lotNumber: 'B' }),
        rowFor({ reagentName: 'Mala', casNumber: '12345-67-9', lotNumber: 'C' }),
      ],
    })
    .expect(400);

  // All or nothing is the property; this is what proves it is a behaviour and
  // not an intention.
  expect(await prisma.reagent.count()).toBe(reagentsBefore);
  expect(await prisma.reagentBatch.count()).toBe(batchesBefore);
});

it('does not trust the rows the client echoes back', async () => {
  const token = await tokenFor('admin');
  const before = await prisma.reagentBatch.count();

  await request(app.getHttpServer())
    .post('/reagents/import/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ rows: [rowFor({ locationName: 'Estante Z', lotNumber: 'X' })] })
    .expect(400);

  // Without this the stateless design would be unsafe and nobody would notice:
  // the preview said nothing about this row, because the client never showed
  // it to us.
  expect(await prisma.reagentBatch.count()).toBe(before);
});

it('refuses a non-admin', async () => {
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .post('/reagents/import/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ rows: [rowFor({})] })
    .expect(403);
});
```

`rowFor(overrides)` is a local helper returning a complete `ImportRow` with sensible defaults, so each test states only what it is about.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- reagents-import`
Expected: FAIL with 404.

- [ ] **Step 3: Write the DTO**

`ConfirmImportDto` carries `rows: ImportRow[]`, validated with `@ValidateNested({ each: true })` and `@Type(() => ImportRowDto)`, plus `@ArrayMaxSize(IMPORT_ROW_LIMIT)`. Each field is a `@IsString()`; the semantic rules stay in `validateRowShape`, which is what both endpoints share.

- [ ] **Step 4: Write `confirm`**

```ts
  /**
   * Re-runs the same validation the preview ran, then writes.
   *
   * The re-validation is what makes the stateless design safe: the client
   * echoes back rows we handed it, and we treat them as untrusted input
   * because they are. It is the same function the preview called, so the two
   * cannot drift apart and disagree about what is acceptable.
   */
  async confirm(
    rows: ImportRow[],
    actorId: string,
  ): Promise<{ reagentsCreated: number; batchesCreated: number }> {
    const preview = await this.preview(rows);
    if (preview.summary.invalidRows > 0) {
      throw new BadRequestException({
        code: 'IMPORT_INVALID_ROWS',
        message: 'The import contains invalid rows and was not applied',
        verdicts: preview.verdicts.filter((v) => v.issues.length > 0),
      });
    }

    // One transaction for the whole file. All or nothing is the contract
    // (spec §5), so a failure halfway leaves no half-loaded inventory.
    return runInTransaction(this.prisma, async (tx) => {
      // ... resolve-or-create each reagent, then create its batch, against tx
    });
  }
```

Inside the transaction, for each verdict: reuse the resolved reagent id, or create the reagent; then create the batch with `initialStock` and `currentStock` both set to the row's quantity, `madeById: actorId`.

**Two reagents in the same file may resolve to the same new reagent.** Two rows for `Nuevo / 64-17-5` with different lot numbers must create **one** reagent and two batches. Keep a map from the identity pair to the id created in this transaction, and consult it before creating. Without that, the file creates duplicates that the preview said it would not.

- [ ] **Step 5: Add the route**

Mirror the preview's `@Roles('ADMIN')`, taking `@Body() dto: ConfirmImportDto` and `@CurrentUser() actor`.

- [ ] **Step 6: Verify**

Run: `npm run test:e2e -w apps/api` — expect **137**.
Run: `npm run test -w apps/api`, `npm run build -w apps/api`, `npm run lint -w apps/api` — all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reagents/import apps/api/test/reagents-import.e2e-spec.ts
git commit -m "feat(api): apply a reagent import in one all-or-nothing transaction"
```

---

## Task 6: The import screen

**Files:**
- Create: `apps/web/src/app/features/reagents/import/import.component.ts`
- Create: `apps/web/src/app/features/reagents/import/import.component.spec.ts`
- Create: `apps/web/src/app/features/reagents/import/import.store.ts`
- Create: `apps/web/src/app/features/reagents/import/i18n.es.ts`
- Modify: `apps/web/src/app/app.routes.ts`, `app.html`, `features/home/home.component.ts`, `features/home/i18n.es.ts`, `shared/i18n/es.ts`
- Modify: `apps/web/src/app/core/api/api.service.ts` (a method that posts `FormData`)

**Interfaces:**
- Consumes: `ImportPreview`, `RowVerdict`, `ImportRow` from Task 2.
- Produces: the `/reactivos/importar` route, ADMIN only.

- [ ] **Step 1: Write the failing spec**

```ts
it('keeps the preview it was given and sends those exact rows on confirm', () => {
  component.onFileSelected(fileWithOneRow());
  http.expectOne((r) => r.url === '/reagents/import/preview').flush(previewFixture);

  component.confirm();

  const request = http.expectOne((r) => r.url === '/reagents/import/confirm');
  // What the user approved is what gets sent. Re-reading the file here would
  // let a swapped file be imported without anyone seeing it.
  expect(request.request.body.rows).toEqual(previewFixture.verdicts.map((v) => v.row));
});

it('does not allow confirming while any row is invalid', () => {
  component.onFileSelected(fileWithOneRow());
  http.expectOne((r) => r.url === '/reagents/import/preview').flush({
    ...previewFixture,
    summary: { ...previewFixture.summary, invalidRows: 1 },
  });

  expect(component.canConfirm()).toBe(false);
  component.confirm();
  http.expectNone((r) => r.url === '/reagents/import/confirm');
});

it('shows, per row, whether a reagent will be created or reused', () => {
  component.onFileSelected(fileWithOneRow());
  http.expectOne((r) => r.url === '/reagents/import/preview').flush(previewFixture);
  fixture.detectChanges();

  // This column is the only thing that makes a near-duplicate visible before
  // it is written, so it is the one the test pins.
  const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
  expect(text).toContain(IMPORT_ES.willReuse);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w apps/web`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the dictionary**

```ts
export const IMPORT_ES = {
  title: 'Importar reactivos',
  chooseFile: 'Elegir archivo',
  explanation:
    'Sube una hoja de cálculo con los reactivos y sus lotes. Verás exactamente qué se creará antes de confirmar; si alguna fila tiene errores, no se importa nada.',
  summary: (created: number, reused: number, batches: number) =>
    `Se crearán ${created} reactivos, se reutilizarán ${reused} y entrarán ${batches} lotes.`,
  invalidRows: (count: number) =>
    `${count} filas tienen errores. Corrige el archivo y vuelve a subirlo.`,
  columns: {
    row: 'Fila',
    reagent: 'Reactivo',
    lot: 'Lote',
    quantity: 'Cantidad',
    action: 'Reactivo',
    issues: 'Errores',
  },
  willCreate: 'Se creará',
  willReuse: 'Se reutilizará',
  confirm: 'Importar',
  confirmed: (reagents: number, batches: number) =>
    `Importación completada: ${reagents} reactivos y ${batches} lotes.`,
  previewFailed: 'No se pudo leer el archivo.',
  confirmFailed: 'No se pudo completar la importación. No se escribió nada.',
} as const;
```

`confirmFailed` says "no se escribió nada" because that is true and because it is the thing a user most needs to know after a failed import — otherwise they will wonder what got in.

- [ ] **Step 4: Write the store and component**

The store holds the preview and posts the file (`FormData`) and the confirm. The component renders the summary, the per-row table with the create/reuse column and the issues, and a confirm button disabled while `invalidRows > 0`.

`ApiService` gains a method that posts `FormData` — **do not set `Content-Type` by hand**; the browser must set the multipart boundary itself, and an explicit header breaks the upload in a way that looks like a server problem.

- [ ] **Step 5: Wire the route, ADMIN only**

```ts
  {
    path: 'reactivos/importar',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/reagents/import/import.component').then((m) => m.ImportComponent),
  },
```

Add `importReagentsLink: 'Importar reactivos'` to `COMMON_ES`, and the link to `app.html` and `home.component.ts` **inside their existing `@if (auth.isAdmin())` blocks**, alongside what is already there.

- [ ] **Step 6: Verify**

Run: `npm run test -w apps/web` — baseline 108, expect **111**.
Run: `npm run build -w apps/web` — exit 0, and **report the bundle size** (416.38 kB, budget 500 kB).

- [ ] **Step 7: Manual walkthrough**

Start both servers, log in as admin, and: upload a sheet with one row matching an existing reagent and one new one; check the create/reuse column says the right thing for each; upload a sheet with a bad CAS and confirm the button is disabled and the row names its error; fix it, re-upload, confirm, and check the reagents screen shows the new reagent and both batches.

**Report what you observe, including anything that does not work.** Shut both servers down afterwards and confirm port 3000 is free — killing only the listener lets an orphaned `nest start --watch` relaunch it.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): import reagents from a spreadsheet with a preview"
```

---

## Plan Self-Review

**Spec coverage.** §2 a row is a batch plus its reagent → Tasks 4–5. §3 identity by name and CAS, accent-insensitive → Task 4, pinned by four e2e cases. §4 stateless, re-validating → Task 5, pinned by "does not trust the rows the client echoes back". §4.1 ADMIN only → Tasks 4–6. §4.2 row and byte caps → Tasks 3 and 4. §5 the create/reuse column and the disabled confirm → Task 6. §6 the template and its rules → Tasks 2–3. §6.4 the CAS check digit → Task 1. §7 one transaction, author from the session → Task 5. §8 the three load-bearing tests → Tasks 4, 5 and 5.

**Type consistency.** `ImportRow`, `RowVerdict`, `ImportPreview` are defined in Task 2 and consumed unchanged in Tasks 3–6. `parseWorkbook` and `validateRowShape` are defined in Task 3 and called from both endpoints. `normalizeForSearch` already exists and is reused rather than reimplemented.

**A duplication I accepted, stated in the plan body:** the import writes reagents and batches directly against the transaction client, because `ReagentsService.create` uses its own connection and `BatchesService.create` opens its own transaction. The alternative — threading an optional transaction client through two working services — is a larger change than this feature justifies. The validation, which is the part that must not diverge, is shared.

**A risk I could not design away.** Identity by name and CAS means a typo creates a near-duplicate reagent, and no validation can tell a typo from a legitimately new name. The create/reuse column is the mitigation, which is why Task 6 pins it with a test rather than leaving it as markup.

**Deliberately not in this plan:** updating existing reagents or batches, importing consumptions or locations, undoing a confirmed import, and CSV. All are listed as out of scope in spec §9.
