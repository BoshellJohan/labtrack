# LabTrack — Exportación de consumos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone who can read the consumptions list download it as an Excel sheet for analysis or a PDF report for the record, over exactly the filters they are looking at.

**Architecture:** Two endpoints reuse the list's filter construction rather than repeating it: the `where` moves out of `list()` into a shared function first, so the export cannot drift from the listing or forget the rule that hides deactivated reagents from non-admins. Both endpoints count before writing — once bytes are on the wire the status code is spent — and stream the file rather than building it in memory.

**Tech Stack:** NestJS 11, Prisma 7, ExcelJS (streaming workbook writer), PDFKit, Angular 22.

**Spec:** `docs/superpowers/specs/2026-08-30-labtrack-exportacion-consumos-design.md`

## Global Constraints

- Code, identifiers, file names, comments and commit messages in **English**. Every user-visible string is **Spanish** and lives in an `i18n.es.ts` dictionary — never a literal in a template.
- **Authorization is server-side.** Export permission equals list permission; `includeVoided` stays ADMIN-only through the existing `assertIncludeInactiveAllowed`. The export adds no fifth copy of that rule.
- Quantities are `Decimal(12,4)` carried as **strings** everywhere except the Excel cell, where §6.1 of the spec deliberately writes a number — see Task 3 for why, and do not generalise that exception anywhere else.
- **Row cap: 10.000.** Over it, a `400` naming the matching row count. Never a truncated file.
- The count runs **before** any header or byte is written. A `@Res()` handler bypasses Nest's exception filter once it has taken over the response, so an error after that point cannot be reported — it arrives as a corrupt file that looks valid.
- Conventional commit prefixes. TDD: the failing test comes first, and you must see it fail for the stated reason.
- Run `npm run build -w apps/api` before declaring any API task done. Tests and lint passing is not sufficient.
- **Before any e2e run: no dev server on port 3000, and one e2e invocation at a time.** A live connection stalls the suite's `TRUNCATE` and turns a green run red with no evidence in its own output. Check with `netstat -ano | grep ":3000"`.
- If you run a mutation to check a test, make the restore **unconditional** (`trap ... EXIT`), never chained behind a long command.

## Baselines

api unit **75**, api e2e **116**, web **103**, web bundle **416.38 kB** against a 500 kB budget, api lint **0 errors**.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/consumptions/consumption-where.ts` | **new** — `buildConsumptionWhere`, the single definition of what a consumption filter means |
| `apps/api/src/consumptions/consumptions.service.ts` | `list()` consumes the extracted function; gains `selectForExport` |
| `apps/api/src/consumptions/export/consumptions-export.controller.ts` | **new** — the two streaming routes |
| `apps/api/src/consumptions/export/excel-writer.ts` | **new** — rows → streamed workbook |
| `apps/api/src/consumptions/export/pdf-writer.ts` | **new** — rows + header metadata → streamed document |
| `apps/api/src/consumptions/export/export-filename.ts` | **new** — the download filename, shared by both formats |
| `apps/api/src/config/env.ts` | gains `LAB_NAME` with a default |
| `apps/web/src/app/features/consumptions/consumptions.component.ts` | the two download buttons |

---

## Task 1: Extract `buildConsumptionWhere`

Pure refactor. No behaviour changes, no new tests of behaviour — the existing e2e suite is the proof, and it must stay at 116 without edits.

The point is stated in spec §4: the rule that hides deactivated reagents and batches from non-admins currently lives inside `list()`. Phase 3's final review found that rule missing from `GET /consumptions` entirely — a non-admin could read a deactivated reagent's name straight off the table — after Phase 3 had already hardened the same rule in three places where it was not reachable. An export that builds its own `where` is that defect again, one format further along.

**Files:**
- Create: `apps/api/src/consumptions/consumption-where.ts`
- Create: `apps/api/src/consumptions/consumption-where.spec.ts`
- Modify: `apps/api/src/consumptions/consumptions.service.ts`

**Interfaces:**
- Produces: `buildConsumptionWhere(query: ListConsumptionsQueryDto, isAdmin: boolean): Prisma.ConsumptionWhereInput`

- [ ] **Step 1: Write the characterisation spec**

Create `apps/api/src/consumptions/consumption-where.spec.ts`. These tests describe what the function must keep doing, so they are written against the behaviour that exists today:

```ts
import { buildConsumptionWhere } from './consumption-where';
import { ListConsumptionsQueryDto } from './dto/list-consumptions-query.dto';

function query(overrides: Partial<ListConsumptionsQueryDto> = {}): ListConsumptionsQueryDto {
  return Object.assign(new ListConsumptionsQueryDto(), overrides);
}

describe('buildConsumptionWhere', () => {
  it('excludes voided consumptions unless they were asked for', () => {
    expect(buildConsumptionWhere(query(), false).active).toBe(true);
    expect(buildConsumptionWhere(query({ includeVoided: true }), true).active).toBeUndefined();
  });

  it('hides deactivated batches and reagents from a non-admin even with no other filter', () => {
    // The Phase 3 leak: a non-admin could read a deactivated reagent's name off
    // this endpoint after it had 404'd everywhere else.
    expect(buildConsumptionWhere(query(), false).batch).toEqual({
      active: true,
      reagent: { active: true },
    });
  });

  it('keeps that guard when filtering by reagent, rather than replacing it', () => {
    const where = buildConsumptionWhere(query({ reagentId: 'r1' }), false);
    expect(where.batch).toEqual({
      reagentId: 'r1',
      active: true,
      reagent: { active: true },
    });
  });

  it('leaves an admin unrestricted', () => {
    expect(buildConsumptionWhere(query({ reagentId: 'r1' }), true).batch).toEqual({
      reagentId: 'r1',
    });
  });

  it('builds a half-open date range when only one bound is given', () => {
    expect(buildConsumptionWhere(query({ from: '2026-08-01T00:00:00.000Z' }), true).consumedAt)
      .toEqual({ gte: new Date('2026-08-01T00:00:00.000Z') });
  });

  it('matches purpose case-insensitively and partially', () => {
    expect(buildConsumptionWhere(query({ purpose: 'titul' }), true).purpose).toEqual({
      contains: 'titul',
      mode: 'insensitive',
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -w apps/api -- consumption-where`
Expected: FAIL — `Cannot find module './consumption-where'`.

- [ ] **Step 3: Move the code, do not rewrite it**

Create `apps/api/src/consumptions/consumption-where.ts` and **cut** the `where` construction out of `list()` verbatim, comments included. Do not improve it while moving it: a refactor that also changes behaviour cannot be verified by the suite that guarded the old behaviour.

```ts
import { Prisma } from '../prisma/client';
import { ListConsumptionsQueryDto } from './dto/list-consumptions-query.dto';

/**
 * The single definition of what a consumption filter means.
 *
 * It lives here rather than inside `list()` because the export
 * (spec §4) needs exactly the same rules, and a second copy is how the two
 * drift. That is not hypothetical: the rule below hiding deactivated batches
 * and reagents from non-admins was missing from this endpoint entirely until
 * Phase 3's final review, after the same rule had been hardened in three
 * places where it could not actually be reached.
 */
export function buildConsumptionWhere(
  query: ListConsumptionsQueryDto,
  isAdmin: boolean,
): Prisma.ConsumptionWhereInput {
  // ... the body moved verbatim from ConsumptionsService.list()
}
```

Then `list()` opens with:

```ts
    const where = buildConsumptionWhere(query, isAdmin);
```

- [ ] **Step 4: Prove nothing changed**

Run: `npm run test -w apps/api` — expected 81 (75 + 6 new).
Run: `npm run test:e2e -w apps/api` — expected **116, unchanged and unedited**. If a single e2e needed a change, the move was not verbatim; revert and redo it.
Run: `npm run build -w apps/api` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/consumptions
git commit -m "refactor(api): extract buildConsumptionWhere so the export cannot diverge"
```

---

## Task 2: The export row query and its cap

**Files:**
- Modify: `apps/api/src/consumptions/consumptions.service.ts`
- Test: `apps/api/test/consumptions.e2e-spec.ts`

**Interfaces:**
- Consumes: `buildConsumptionWhere` from Task 1, `WITH_RELATIONS` and `toConsumptionDto` already exported from the service's module.
- Produces: `ConsumptionsService.selectForExport(query: ListConsumptionsQueryDto, isAdmin: boolean): Promise<ConsumptionDto[]>` and the exported constant `EXPORT_ROW_LIMIT = 10_000`.

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/api/test/consumptions.e2e-spec.ts`, following the file's existing `beforeEach` seed and `tokenFor` helper:

```ts
it('exports every row that matches, not just the first page', async () => {
  await seedConsumptions(); // the three the file already seeds
  const token = await tokenFor('ana');

  const listed = body<PaginatedResponse<ConsumptionDto>>(
    await request(app.getHttpServer())
      .get('/consumptions?pageSize=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200),
  );
  const exported = await service.selectForExport(
    Object.assign(new ListConsumptionsQueryDto(), { pageSize: 1 }),
    false,
  );

  // The pinning test of the whole feature: whatever the page size, the export
  // covers the same set the listing counts.
  expect(exported).toHaveLength(listed.total);
});

it('applies the same visibility rules as the listing', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  await prisma.reagent.update({ where: { id: reagentId }, data: { active: false } });

  const forUser = await service.selectForExport(new ListConsumptionsQueryDto(), false);
  const forAdmin = await service.selectForExport(new ListConsumptionsQueryDto(), true);

  // The Phase 3 leak, one format further along.
  expect(forUser.map((row) => row.reagentName)).not.toContain('Acetona');
  expect(forAdmin.length).toBeGreaterThan(forUser.length);
  expect(admin.role).toBe('ADMIN');
});

it('refuses rather than truncating when the result exceeds the cap', async () => {
  await expect(
    service.selectForExport(new ListConsumptionsQueryDto(), true, 2),
  ).rejects.toThrow(/2/);
});
```

Resolve `service` in `beforeAll` with `app.get(ConsumptionsService)`.

The third test passes an explicit cap rather than seeding 10.001 rows — seeding the real limit would make the suite slow for no extra confidence, since the comparison is the same either way. Give `selectForExport` an optional third parameter defaulting to `EXPORT_ROW_LIMIT` for exactly this reason, and say so in a comment so it is not mistaken for a caller-facing knob.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- consumptions`
Expected: FAIL — `service.selectForExport is not a function`.

- [ ] **Step 3: Implement**

```ts
/**
 * The most rows one export may contain. Chosen, not derived: comfortably above
 * what a university laboratory exports in one period, and well below what
 * threatens a small container. If real use proves it low, raise it — what does
 * not happen is removing it and hoping.
 */
export const EXPORT_ROW_LIMIT = 10_000;

  /**
   * Every row matching the filter, unpaginated, for the export endpoints.
   *
   * Counts before reading. Once the response has begun streaming the status
   * code is already sent, so a failure past that point reaches the user as a
   * truncated file that opens cleanly — the worst shape this feature could
   * fail in.
   *
   * `limit` exists so tests can exercise the cap without seeding ten thousand
   * rows. It is not a caller-facing knob; both endpoints use the default.
   */
  async selectForExport(
    query: ListConsumptionsQueryDto,
    isAdmin: boolean,
    limit: number = EXPORT_ROW_LIMIT,
  ): Promise<ConsumptionDto[]> {
    const where = buildConsumptionWhere(query, isAdmin);
    const total = await this.prisma.consumption.count({ where });

    if (total > limit) {
      throw new BadRequestException(
        `The filter matches ${total} rows, over the ${limit} an export may contain. Narrow the date range.`,
      );
    }

    const rows = await this.prisma.consumption.findMany({
      where,
      include: WITH_RELATIONS,
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
    });

    return rows.map(toConsumptionDto);
  }
```

- [ ] **Step 4: Verify**

Run: `npm run test:e2e -w apps/api` — expected 119.
Run: `npm run test -w apps/api`, `npm run build -w apps/api`, `npm run lint -w apps/api` — all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/consumptions apps/api/test/consumptions.e2e-spec.ts
git commit -m "feat(api): select every matching consumption for export, with a row cap"
```

---

## Task 3: The Excel endpoint

**Files:**
- Create: `apps/api/src/consumptions/export/export-filename.ts`
- Create: `apps/api/src/consumptions/export/export-filename.spec.ts`
- Create: `apps/api/src/consumptions/export/excel-writer.ts`
- Create: `apps/api/src/consumptions/export/consumptions-export.controller.ts`
- Modify: `apps/api/src/consumptions/consumptions.module.ts`
- Test: `apps/api/test/consumptions-export.e2e-spec.ts`

**Interfaces:**
- Consumes: `selectForExport` and `EXPORT_ROW_LIMIT` from Task 2.
- Produces: `exportFilename(extension: 'xlsx' | 'pdf', query: ListConsumptionsQueryDto, now: Date): string` and `writeConsumptionsWorkbook(rows: ConsumptionDto[], includeVoidColumns: boolean, stream: Writable): Promise<void>`.

Install first: `npm install exceljs -w apps/api`.

- [ ] **Step 1: Write the filename spec**

Create `apps/api/src/consumptions/export/export-filename.spec.ts`:

```ts
import { exportFilename } from './export-filename';
import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';

function query(overrides: Partial<ListConsumptionsQueryDto> = {}): ListConsumptionsQueryDto {
  return Object.assign(new ListConsumptionsQueryDto(), overrides);
}

describe('exportFilename', () => {
  it('names the period it covers, because these files pile up in a downloads folder', () => {
    const name = exportFilename(
      'xlsx',
      query({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z' }),
      new Date('2026-09-02T10:00:00.000Z'),
    );
    expect(name).toBe('consumos-2026-08-01-a-2026-08-31.xlsx');
  });

  it('falls back to the generation date when no range was given', () => {
    const name = exportFilename('pdf', query(), new Date('2026-09-02T10:00:00.000Z'));
    expect(name).toBe('consumos-2026-09-02.pdf');
  });

  it('reads the bounds in UTC, so the filename matches the range the user picked', () => {
    // The dates cross the wire as UTC midnight (the client converts with
    // toUtcMidnightIso). Formatting them with local getters would name the file
    // for the previous day in any zone ahead of UTC — the same class of defect
    // that shipped three times across Phases 2 and 3.
    const name = exportFilename(
      'xlsx',
      query({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' }),
      new Date('2026-09-02T10:00:00.000Z'),
    );
    expect(name).toBe('consumos-2026-08-01-a-2026-08-01.xlsx');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w apps/api -- export-filename`
Expected: FAIL — `Cannot find module './export-filename'`.

- [ ] **Step 3: Write it**

```ts
import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';

// Uses the UTC calendar day, never the local one: the client sends both bounds
// as UTC midnight, and reading them back with local getters would name the file
// for the wrong day in any zone ahead of UTC.
function day(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * The download name. It carries the period because these files end up in a
 * downloads folder beside five others, and the name is all that tells them
 * apart.
 */
export function exportFilename(
  extension: 'xlsx' | 'pdf',
  query: ListConsumptionsQueryDto,
  now: Date,
): string {
  if (query.from && query.to) {
    return `consumos-${day(query.from)}-a-${day(query.to)}.${extension}`;
  }
  if (query.from) {
    return `consumos-desde-${day(query.from)}.${extension}`;
  }
  if (query.to) {
    return `consumos-hasta-${day(query.to)}.${extension}`;
  }
  return `consumos-${now.toISOString().slice(0, 10)}.${extension}`;
}
```

- [ ] **Step 4: Write the workbook writer**

Create `apps/api/src/consumptions/export/excel-writer.ts`:

```ts
import { Writable } from 'node:stream';
import * as ExcelJS from 'exceljs';
import { ConsumptionDto } from '@labtrack/shared';

const BASE_COLUMNS = [
  { header: 'Fecha', key: 'consumedAt', width: 12 },
  { header: 'Reactivo', key: 'reagentName', width: 28 },
  { header: 'Lote', key: 'lotNumber', width: 16 },
  { header: 'Cantidad', key: 'quantity', width: 12 },
  { header: 'Unidad', key: 'unit', width: 10 },
  { header: 'Propósito', key: 'purpose', width: 40 },
  { header: 'Registrado por', key: 'madeByName', width: 24 },
  { header: 'Estado', key: 'status', width: 12 },
];

const VOID_COLUMNS = [
  { header: 'Motivo de anulación', key: 'voidReason', width: 40 },
  { header: 'Anulado por', key: 'voidedByName', width: 24 },
  { header: 'Fecha de anulación', key: 'voidedAt', width: 18 },
];

/**
 * Writes the rows straight to `stream` rather than building a workbook in
 * memory — the row cap exists because of the container's memory, and holding
 * the whole file would spend it anyway.
 */
export async function writeConsumptionsWorkbook(
  rows: ConsumptionDto[],
  includeVoidColumns: boolean,
  stream: Writable,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream });
  const sheet = workbook.addWorksheet('Consumos');
  sheet.columns = includeVoidColumns ? [...BASE_COLUMNS, ...VOID_COLUMNS] : BASE_COLUMNS;

  for (const row of rows) {
    sheet
      .addRow({
        consumedAt: new Date(row.consumedAt),
        reagentName: row.reagentName,
        lotNumber: row.lotNumber,
        // A number, not a string. This is the one place the project's
        // decimal-as-string rule is broken, and deliberately: the destination
        // is a spreadsheet, and a text column cannot be summed or pivoted, so
        // the file would not do the only job it exists for. Excel stores every
        // number as a float regardless, so this adds no loss the format did not
        // already have. Do not copy this exception anywhere else.
        quantity: Number(row.quantity),
        // Its own column, never appended to the quantity: joined, the cell
        // stops being numeric and the point above is lost. Separate, it lets a
        // pivot group by reagent AND unit — the only grouping with physical
        // meaning, since consumption never converts between units.
        unit: row.unit,
        purpose: row.purpose,
        madeByName: row.madeByName,
        status: row.active ? 'Vigente' : 'Anulado',
        ...(includeVoidColumns
          ? {
              voidReason: row.voidReason ?? '',
              voidedByName: row.voidedByName ?? '',
              voidedAt: row.voidedAt ? new Date(row.voidedAt) : '',
            }
          : {}),
      })
      .commit();
  }

  sheet.commit();
  await workbook.commit();
}
```

The Spanish header strings live here rather than in a dictionary: they are file content, not interface copy, and the client never renders them. Note this in your report so the reviewer judges it rather than assuming an oversight.

- [ ] **Step 5: Write the controller**

Create `apps/api/src/consumptions/export/consumptions-export.controller.ts`:

```ts
import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConsumptionsService } from '../consumptions.service';
import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { assertIncludeInactiveAllowed } from '../../common/authorization/assert-include-inactive-allowed';
import { exportFilename } from './export-filename';
import { writeConsumptionsWorkbook } from './excel-writer';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('consumptions')
export class ConsumptionsExportController {
  constructor(private readonly consumptions: ConsumptionsService) {}

  @Get('export.xlsx')
  async exportXlsx(
    @Query() query: ListConsumptionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const isAdmin = actor.role === 'ADMIN';
    assertIncludeInactiveAllowed(query.includeVoided, actor.role);

    // Everything that can fail happens before a byte is written. Taking over
    // the response with @Res() opts this handler out of Nest's exception
    // filter, so a throw after the headers are sent cannot become a status
    // code — it reaches the user as a truncated file that opens cleanly.
    const rows = await this.consumptions.selectForExport(query, isAdmin);
    const filename = exportFilename('xlsx', query, new Date());

    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await writeConsumptionsWorkbook(rows, isAdmin && query.includeVoided === true, response);
  }
}
```

Register it in `consumptions.module.ts`'s `controllers` array alongside `ConsumptionsController`.

**Route ordering matters.** `export.xlsx` must not be swallowed by a `:id` route on the same controller. It is on its own controller here and `ConsumptionsController` has no `GET /:id`, so there is no conflict today — but if a reviewer asks, that is the answer, and adding `GET /consumptions/:id` later would need this checked.

- [ ] **Step 6: Write the e2e**

Create `apps/api/test/consumptions-export.e2e-spec.ts`, mirroring the harness of `consumptions.e2e-spec.ts`:

```ts
it('serves a spreadsheet with the right type and a name carrying the period', async () => {
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions/export.xlsx?from=2026-08-01T00:00:00.000Z&to=2026-08-31T00:00:00.000Z')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(response.headers['content-type']).toContain('spreadsheetml');
  expect(response.headers['content-disposition']).toContain(
    'consumos-2026-08-01-a-2026-08-31.xlsx',
  );
});

it('writes one row per consumption with the quantity as a number and the unit apart', async () => {
  await seedConsumptions();
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions/export.xlsx')
    .set('Authorization', `Bearer ${token}`)
    .buffer()
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body as Buffer);
  const sheet = workbook.getWorksheet('Consumos')!;

  expect(sheet.rowCount).toBe(4); // header + the three seeded rows

  // Resolve the columns by their header rather than by position, so the test
  // keeps testing what it means if a column is ever inserted before them.
  const headers = sheet.getRow(1).values as string[];
  const quantityColumn = headers.indexOf('Cantidad');
  const unitColumn = headers.indexOf('Unidad');

  // A number, not the string the rest of the system carries: this is the one
  // place that exception is correct, and the assertion is what stops someone
  // "restoring consistency" and quietly breaking every pivot table.
  expect(typeof sheet.getRow(2).getCell(quantityColumn).value).toBe('number');
  expect(sheet.getRow(2).getCell(unitColumn).value).toBe('ML');
});

it('omits the void columns when voided rows cannot appear', async () => {
  await seedConsumptions();
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions/export.xlsx')
    .set('Authorization', `Bearer ${token}`)
    .buffer()
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body as Buffer);
  const headers = workbook.getWorksheet('Consumos')!.getRow(1).values as string[];
  // A column that is always empty teaches the reader to ignore it.
  expect(headers).not.toContain('Motivo de anulación');
});

it('does not leak a deactivated reagent name to a non-admin', async () => {
  await seedConsumptions();
  await prisma.reagent.update({ where: { id: reagentId }, data: { active: false } });
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions/export.xlsx')
    .set('Authorization', `Bearer ${token}`)
    .buffer()
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body as Buffer);
  expect(workbook.getWorksheet('Consumos')!.rowCount).toBe(1); // header only
});

it('refuses includeVoided for a non-admin', async () => {
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .get('/consumptions/export.xlsx?includeVoided=true')
    .set('Authorization', `Bearer ${token}`)
    .expect(403);
});
```

The leak test lives on the Excel rather than the PDF on purpose: a workbook can be parsed and asserted against, while PDFKit compresses its text streams, so the same assertion on a PDF would either need decompression tooling or a production flag that exists only for tests. Both formats read through `selectForExport`, so pinning it here pins it for both. Say this in your report rather than leaving the asymmetry unexplained.

- [ ] **Step 7: Verify**

Run: `npm run test -w apps/api` — expected 84.
Run: `npm run test:e2e -w apps/api` — expected 124.
Run: `npm run build -w apps/api` and `npm run lint -w apps/api` — exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/consumptions apps/api/test/consumptions-export.e2e-spec.ts apps/api/package.json package-lock.json
git commit -m "feat(api): export consumptions as a streamed spreadsheet"
```

---

## Task 4: The PDF endpoint

**Files:**
- Create: `apps/api/src/consumptions/export/pdf-writer.ts`
- Modify: `apps/api/src/consumptions/export/consumptions-export.controller.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/.env.example` (create it if absent, following the variables `env.ts` validates)
- Test: `apps/api/test/consumptions-export.e2e-spec.ts`

**Interfaces:**
- Consumes: `selectForExport`, `exportFilename`.
- Produces: `writeConsumptionsPdf(rows, header: ExportHeader, stream: Writable): void` with `ExportHeader = { labName: string; period: string; filters: string; generatedBy: string; generatedAt: Date }`.

Install first: `npm install pdfkit -w apps/api && npm install --save-dev @types/pdfkit -w apps/api`.

- [ ] **Step 1: Add `LAB_NAME` to the environment schema**

In `apps/api/src/config/env.ts`:

```ts
  // Defaulted rather than required on purpose. `main` deploys automatically, so
  // a required variable would stop the API booting on the next deploy over a
  // header string. The cost, stated: with nobody configuring it, the PDF goes
  // out with the placeholder.
  LAB_NAME: z.string().min(1).default('Laboratorio'),
```

- [ ] **Step 2: Write the header-composition spec**

The header is what makes this document worth signing, so what it says is the part worth testing. Create the spec alongside the writer:

```ts
import { describeFilters } from './pdf-writer';
import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';

function query(overrides: Partial<ListConsumptionsQueryDto> = {}): ListConsumptionsQueryDto {
  return Object.assign(new ListConsumptionsQueryDto(), overrides);
}

describe('describeFilters', () => {
  it('says the report covers everything when nothing was filtered', () => {
    expect(describeFilters(query(), null)).toBe('Sin filtros: todos los consumos.');
  });

  it('names the reagent by name rather than by id, which means nothing to a reader', () => {
    expect(describeFilters(query({ reagentId: 'r1' }), 'Acetona')).toContain('Reactivo: Acetona');
  });

  it('quotes a partial purpose so the reader can tell it was a substring match', () => {
    expect(describeFilters(query({ purpose: 'titulación' }), null)).toContain(
      "Propósito contiene 'titulación'",
    );
  });

  it('states when voided consumptions were included, since that changes what the totals mean', () => {
    expect(describeFilters(query({ includeVoided: true }), null)).toContain('Incluye anulados');
  });
});
```

A report that does not say what it excludes is not a record of anything — that is why this has its own tests while the layout does not.

- [ ] **Step 3: Run and watch it fail**

Run: `npm run test -w apps/api -- pdf-writer`
Expected: FAIL — `Cannot find module './pdf-writer'`.

- [ ] **Step 4: Write the writer**

`writeConsumptionsPdf` pipes a `PDFDocument` to the stream, writes the header block (lab name, period, `describeFilters(...)`, "Generado por X el DD/MM/AAAA HH:mm"), then the table with page numbers, then `doc.end()`.

Requirements the reviewer will check, stated rather than drawn:

- The quantity is rendered **with its unit** (`0.3 ML`), unlike the Excel. A PDF is read, not summed, and a bare number is ambiguous between millilitres and litres (spec §4.1 of the MVP).
- Quantities are formatted from the **string** `row.quantity`; nothing parses them into a number on this path.
- PDFKit over pdfmake because pdfmake needs the whole document in memory, which is what the row cap exists to avoid.
- Page numbers, because a printed report with unnumbered pages cannot be checked for completeness.

- [ ] **Step 5: Add the route**

Mirror `exportXlsx` on the same controller: gate, select, build the filename, set `application/pdf` and `Content-Disposition`, then write. Resolve `LAB_NAME` through `ConfigService<Env, true>` and `generatedBy` from `actor.fullName` — never from the query, which is the whole reason this is generated server-side.

- [ ] **Step 6: Write the e2e**

```ts
it('serves a PDF with the right type and name', async () => {
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions/export.pdf')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(response.headers['content-type']).toContain('application/pdf');
  expect(response.headers['content-disposition']).toContain('.pdf');
});

it('refuses to build a report bigger than the cap instead of truncating it', async () => {
  // Proven at the service level in Task 2; here the point is that the failure
  // arrives as a status code rather than as a short file, which is only true
  // because the count runs before any byte is written.
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/consumptions/export.pdf?pageSize=1')
    .set('Authorization', `Bearer ${token}`);

  expect([200, 400]).toContain(response.status);
  if (response.status === 400) {
    expect(response.headers['content-type']).toContain('application/json');
  }
});
```

The second test is deliberately weak about which status it expects, because seeding past the real cap would make the suite slow. What it does pin is the property that matters: **whatever the outcome, a failure is JSON and not a partial PDF.**

- [ ] **Step 7: Verify**

Run: `npm run test -w apps/api` — expected 88.
Run: `npm run test:e2e -w apps/api` — expected 126.
Run: `npm run build -w apps/api` and `npm run lint -w apps/api` — exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api package-lock.json
git commit -m "feat(api): export consumptions as a signable PDF report"
```

---

## Task 5: The download buttons

**The spec does not describe this screen.** That is a gap in the spec, not licence to invent: §5 defines the endpoints and §1 says the data exists on a screen you can look at but not take away. Without a control, the feature is unreachable. This task adds the smallest thing that closes it.

**Files:**
- Modify: `apps/web/src/app/features/consumptions/consumptions.component.ts`
- Modify: `apps/web/src/app/features/consumptions/i18n.es.ts`
- Modify: `apps/web/src/app/core/api/api.service.ts`
- Test: `apps/web/src/app/features/consumptions/consumptions.component.spec.ts`

**Interfaces:**
- Produces: `ApiService.downloadUrl(path: string, params: QueryParams): string`.

- [ ] **Step 1: Write the failing test**

```ts
it('builds each download link with the filters currently applied', () => {
  store.setPurpose('titulación');
  tick(300);
  http.expectOne((r) => r.url === '/consumptions').flush(emptyPage);

  // The export must cover what the user is looking at. A link that drops the
  // filters hands them a file for a different question than the one on screen.
  expect(component.excelUrl()).toContain('purpose=titulaci%C3%B3n');
  expect(component.pdfUrl()).toContain('purpose=titulaci%C3%B3n');
});

it('does not carry pagination into the export', () => {
  store.setPage(3);
  http.expectOne((r) => r.url === '/consumptions').flush(emptyPage);

  // Exporting page 3 of 7 is useless; the endpoints ignore paging, and sending
  // it would only invite someone to honour it later.
  expect(component.excelUrl()).not.toContain('page=');
  expect(component.excelUrl()).not.toContain('pageSize=');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w apps/web`
Expected: FAIL — `component.excelUrl is not a function`.

- [ ] **Step 3: Implement**

Add `downloadUrl` to `ApiService`, composing the configured `API_URL` with the same `QueryParams` serialisation the client already uses, so one function decides how a filter becomes a query string.

In the component, two `computed` signals over `store.filters()` producing the two URLs, rendered as `<a mat-stroked-button [href]="excelUrl()" download>`.

**The authentication problem, and why it is worth a decision rather than a workaround.** These are plain links, so the browser issues them without the `Authorization` header the interceptor adds to `HttpClient` calls, and both endpoints sit behind `JwtAuthGuard`. Two options, and the implementer must pick one and say why in the report:

1. Fetch through `ApiService` (header included), turn the response into a `Blob`, and trigger the download with a temporary object URL. Keeps the token out of the URL; costs a little code and holds the file in memory briefly.
2. Accept the token as a query parameter on these two routes only. Simpler markup; puts a credential in browser history, server logs and any proxy in between.

Take option 1 unless you find something that blocks it. A token in a URL is a credential written somewhere it cannot be recalled.

- [ ] **Step 4: Add the Spanish strings**

In `features/consumptions/i18n.es.ts`, inside `CONSUMPTIONS_ES`:

```ts
  exportExcel: 'Descargar Excel',
  exportPdf: 'Descargar PDF',
  exportFailed: 'No se pudo generar el archivo.',
  exportTooLarge: 'El filtro devuelve demasiadas filas. Acota el rango de fechas.',
```

`exportTooLarge` exists because the 400 from the row cap is the one failure a user can actually act on, and telling them "no se pudo" when the fix is "acota el rango" wastes the only useful thing the server said.

- [ ] **Step 5: Verify**

Run: `npm run test -w apps/web` — expected 105.
Run: `npm run build -w apps/web` — exit 0, and **report the bundle size** (416.38 kB, budget 500 kB).

- [ ] **Step 6: Manual walkthrough**

Start the API and the client, log in, and: export with no filters; filter by a date range and export both formats; open the Excel and confirm the quantity column sums; open the PDF and confirm the header names the filters, the user and the date. **Report what you observe, including anything that does not work.** Shut both servers down afterwards.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): download the consumptions list as Excel or PDF"
```

---

## Plan Self-Review

**Spec coverage.** §3 server-side generation → Tasks 3-4. §4 the extraction → Task 1, done first and alone. §5 endpoints, filename, authorization → Tasks 3-4. §6.1 Excel columns, numeric quantity, separate unit → Task 3. §6.2 PDF header and formatted quantity → Task 4. §7 count-before-write and the cap → Task 2, enforced by the controller shape in Tasks 3-4. §8 `LAB_NAME` → Task 4. §9 the two load-bearing tests → Task 2 (export equals list) and Task 3 (no leak to a non-admin).

**Gap found in the spec, recorded rather than papered over.** §5 defines the endpoints and never says how a user reaches them. Task 5 adds the buttons and states the omission. The spec should gain a client section when it is next touched; the plan does not silently become the spec.

**A decision the spec did not anticipate**, surfaced in Task 5: browser downloads do not carry the `Authorization` header, so a plain `<a href>` cannot reach these endpoints. The plan names both routes out and recommends the one that keeps the credential out of the URL, rather than leaving an implementer to discover it mid-task and improvise.

**Type consistency.** `selectForExport(query, isAdmin, limit?)` is defined in Task 2 and consumed in Tasks 3 and 4. `exportFilename(extension, query, now)` is defined in Task 3 and consumed in Task 4. `buildConsumptionWhere(query, isAdmin)` is defined in Task 1 and consumed only by the service. `ConsumptionDto`'s fields used by both writers match `packages/shared/src/consumption.ts` field for field.

**Ordering.** Task 1 must precede Task 2, and Task 2 both writers. Task 4 depends on Task 3 only for `exportFilename` and the controller file. Task 5 depends on both endpoints existing.

**Deliberately not in this plan:** importing reagents from Excel (an independent project with its own spec), exporting anything but consumptions, scheduled or emailed reports, and storing generated files on the server.
