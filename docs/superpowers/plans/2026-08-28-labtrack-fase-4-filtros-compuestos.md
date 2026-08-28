# LabTrack Fase 4 — Filtros compuestos y deuda de interfaz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close spec §6.2 — "reagents whose consumption exceeded X, with or without a date range" — and repay the three user-visible interface defects carried out of Phases 2 and 3.

**Architecture:** The composite filter cannot be expressed as a Prisma `where`: it is a `HAVING` over grouped consumptions. It resolves in two steps that reuse the seam Phase 2 built — a typed raw query returns the ids of reagents whose consumption qualifies, and the existing Prisma path intersects those ids with the simple filters and paginates. The simple filters keep one definition; the raw query only ever answers the aggregation question.

**Tech Stack:** NestJS 11, Prisma 7 (driver adapter, `$queryRaw` with bindings), PostgreSQL 18, Angular 22 with signals, Jest + Supertest (API), Vitest (web).

**Spec:** `docs/superpowers/specs/2026-08-23-labtrack-mvp-design.md` — §6.2 (composite filter), §4.1 (units), §7.1–7.2 (client), §5.3 (pagination).

## Amendment to the spec, decided before this plan was written

**§6.2's SQL groups by reagent alone and sums `c.quantity` across every batch. That is wrong when a reagent holds batches in different units**, and this project has held the opposite line since Phase 2: `stockByUnit` groups per unit and never sums across, because adding millilitres to litres invents a quantity nobody can act on. §4.1 agrees — "los filtros por cantidad consumida se interpretan dentro de la unidad del reactivo."

**The filter therefore takes a unit, and it is required whenever `minConsumed` is present.** The join is constrained to batches of that unit, so the sum is always within one unit and the answer is always actionable. A reagent that consumed 2 L does not match "more than 500 mL" — those are different units and this system never converts between them.

The amended query:

```sql
SELECT r.id
FROM   "Reagent" r
JOIN   "ReagentBatch" b ON b."reagentId" = r.id AND b.active AND b.unit = $unit
JOIN   "Consumption"  c ON c."batchId"   = b.id AND c.active
WHERE  r.active
  AND ($from IS NULL OR c."consumedAt" >= $from)
  AND ($to   IS NULL OR c."consumedAt" <= $to)
GROUP BY r.id
HAVING SUM(c.quantity) > $minConsumed
```

Update the spec's §6.2 as part of Task 3, so the document and the code do not disagree.

## Global Constraints

- Code, identifiers, file names, comments and commit messages in **English**. Every user-visible string is **Spanish** and lives in an `i18n.es.ts` dictionary — never a literal in a template.
- **No physical deletes.** Every table carries `active`; deletion is `active = false`. A soft-deleted row is visible only to an ADMIN.
- Quantities are `Decimal(12,4)` serialized as **strings**. Never parse one into a JS `number`, on either side.
- **Raw SQL uses bindings, never interpolation.** `$queryRaw` as a tagged template, or `Prisma.sql` fragments. A value that reaches SQL by string concatenation is a defect regardless of where it came from.
- `ValidationPipe` runs with `whitelist: true`, `forbidNonWhitelisted: true` and **no** `enableImplicitConversion`.
- Conventional commit prefixes. TDD: the failing test comes first, and you must see it fail for the stated reason.
- Standalone Angular components, `ChangeDetectionStrategy.OnPush`, lazy routes via `loadComponent`.
- **Authorization is server-side.** `auth.isAdmin()` only hides affordances.
- Dates that represent a calendar day cross the wire as **UTC midnight**. Use `toUtcMidnightIso` / `fromUtcMidnightIso` from `apps/web/src/app/shared/date/utc-midnight.ts` — never `new Date(iso)` or a bare `.toISOString()` on a picker value. Three defects of this exact shape shipped across Phases 2 and 3.
- Run `npm run build -w apps/api` before declaring any API task done. Tests and lint passing is not sufficient.
- **Before any e2e run: no dev server on port 3000, and one e2e invocation at a time.** A live connection stalls the suite's `TRUNCATE` and turns a green run red with no evidence in its own output.

## Baselines

api unit **72**, api e2e **92**, web **88**, web bundle **416.06 kB** against a 500 kB budget, api lint **0 errors**.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/reagents/dto/list-reagents-query.dto.ts` | gains `minConsumed`, `minConsumedUnit`, `consumedFrom`, `consumedTo`, and the cross-field rule that the unit is required with the threshold |
| `apps/api/src/reagents/consumed-reagent-ids.query.ts` | **new** — the raw `HAVING` query, and nothing else |
| `apps/api/src/reagents/reagent-ids.query.ts` | intersects the raw result with the simple-filter path |
| `apps/web/src/app/features/reagents/reagents.store.ts` | four more filter fields, all primitive |
| `apps/web/src/app/features/reagents/reagents.component.ts` | the composite filter panel |
| `apps/web/src/app/features/reagents/i18n.es.ts` | its Spanish strings |
| `apps/web/src/app/features/consumptions/consumptions.component.ts` | differentiated void errors |
| `apps/web/src/app/features/locations/locations.store.ts` | picker beyond 100 |
| `packages/shared/src/inventory.ts` | optional fields become nullable so an edit can clear them |

---

## Task 1: The query DTO for the composite filter

**Files:**
- Modify: `apps/api/src/reagents/dto/list-reagents-query.dto.ts`
- Test: `apps/api/test/reagents.e2e-spec.ts`

**Interfaces:**
- Produces: `ListReagentsQueryDto.minConsumed?: string`, `.minConsumedUnit?: Unit`, `.consumedFrom?: string`, `.consumedTo?: string`.

The four fields are named for what they filter. `from`/`to` alone would read as a filter on the reagent, and this endpoint already has `expiringBefore`; `consumedFrom`/`consumedTo` say which dates they bound.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/reagents.e2e-spec.ts`:

```ts
it('rejects minConsumed without a unit, because a quantity with no unit cannot be compared', async () => {
  const token = await tokenFor('admin');
  await request(app.getHttpServer())
    .get('/reagents?minConsumed=500')
    .set('Authorization', `Bearer ${token}`)
    .expect(400);
});

it('rejects a minConsumedUnit outside the Unit enum', async () => {
  const token = await tokenFor('admin');
  await request(app.getHttpServer())
    .get('/reagents?minConsumed=500&minConsumedUnit=GALLON')
    .set('Authorization', `Bearer ${token}`)
    .expect(400);
});

it('rejects a non-decimal minConsumed', async () => {
  const token = await tokenFor('admin');
  await request(app.getHttpServer())
    .get('/reagents?minConsumed=mucho&minConsumedUnit=ML')
    .set('Authorization', `Bearer ${token}`)
    .expect(400);
});

it('accepts a unit on its own, which simply narrows nothing', async () => {
  const token = await tokenFor('admin');
  await request(app.getHttpServer())
    .get('/reagents?minConsumedUnit=ML')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
});
```

The last one pins the asymmetry deliberately: the unit is required *by* the threshold, not the other way round. A rule written as "both or neither" would fail it.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- reagents`
Expected: the first three FAIL. The first returns **200** (the parameter is unknown, so `forbidNonWhitelisted` has not been given a chance to know about it — check the actual status and note it; if it is 400 already, it is 400 for the wrong reason and you must still add the field to make the test meaningful).

- [ ] **Step 3: Add the fields and the cross-field rule**

In `list-reagents-query.dto.ts`:

```ts
  // Spec §6.2 as amended: the threshold is meaningless without a unit,
  // because a reagent may hold batches in millilitres and litres at once and
  // this system never converts between them. `@ValidateIf` makes the unit
  // required *by* the threshold rather than making the pair all-or-nothing —
  // a unit on its own is harmless and simply narrows nothing.
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,4})?$/, {
    message: 'minConsumed must be a positive decimal with up to 4 decimal places',
  })
  minConsumed?: string;

  @ValidateIf((dto: ListReagentsQueryDto) => dto.minConsumed !== undefined)
  @IsIn(UNITS, {
    message: 'minConsumedUnit is required when minConsumed is given',
  })
  minConsumedUnit?: Unit;

  @IsOptional()
  @IsDateString()
  consumedFrom?: string;

  @IsOptional()
  @IsDateString()
  consumedTo?: string;
```

Import `ValidateIf` from `class-validator`, and `UNITS` plus the type `Unit` from `@labtrack/shared`.

- [ ] **Step 4: Run the tests**

Run: `npm run test:e2e -w apps/api -- reagents` — expected PASS.
Run: `npm run build -w apps/api` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reagents/dto/list-reagents-query.dto.ts apps/api/test/reagents.e2e-spec.ts
git commit -m "feat(api): accept the composite consumption filter parameters"
```

---

## Task 2: The raw HAVING query

This is the only place in the codebase that writes SQL by hand. It answers exactly one question — which reagents consumed more than X of a given unit, optionally within a date range — and knows nothing about the simple filters.

**Files:**
- Create: `apps/api/src/reagents/consumed-reagent-ids.query.ts`
- Create: `apps/api/src/reagents/consumed-reagent-ids.query.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ListReagentsQueryDto` from Task 1.
- Produces: `selectConsumedReagentIds(prisma, query): Promise<string[] | null>` — the qualifying ids, or **`null`** when `minConsumed` is absent, meaning "this filter does not apply". `null` and `[]` must stay distinguishable: an empty array means "nothing qualified" and must produce an empty page.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/reagents/consumed-reagent-ids.query.spec.ts`:

```ts
import { selectConsumedReagentIds } from './consumed-reagent-ids.query';
import { PrismaService } from '../prisma/prisma.service';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

function query(overrides: Partial<ListReagentsQueryDto>): ListReagentsQueryDto {
  return Object.assign(new ListReagentsQueryDto(), overrides);
}

describe('selectConsumedReagentIds', () => {
  it('returns null when no threshold is given, so the caller keeps the simple path', async () => {
    const prisma = { $queryRaw: jest.fn() } as unknown as PrismaService;
    await expect(selectConsumedReagentIds(prisma, query({}))).resolves.toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns an empty array rather than null when nothing qualifies', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as PrismaService;
    await expect(
      selectConsumedReagentIds(prisma, query({ minConsumed: '500', minConsumedUnit: 'ML' })),
    ).resolves.toEqual([]);
  });

  it('passes every value as a binding, never as interpolated SQL', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ id: 'r1' }]);
    const prisma = { $queryRaw } as unknown as PrismaService;

    await selectConsumedReagentIds(
      prisma,
      query({ minConsumed: '500', minConsumedUnit: 'ML', consumedFrom: '2026-08-01T00:00:00.000Z' }),
    );

    // The tagged-template form receives the static SQL fragments as the first
    // argument and every value separately. If a value were concatenated into
    // the SQL text it would appear in that first argument instead — which is
    // exactly the injection route this assertion exists to close.
    const [fragments, ...values] = $queryRaw.mock.calls[0] as [string[], ...unknown[]];
    expect(fragments.join('')).not.toContain('500');
    expect(values).toContain('500');
  });
});
```

That third test is the one that matters. A `$queryRaw` built by string concatenation would satisfy every behavioural test in this file and still be injectable.

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w apps/api -- consumed-reagent-ids`
Expected: FAIL — `Cannot find module './consumed-reagent-ids.query'`.

- [ ] **Step 3: Write the query**

Create `apps/api/src/reagents/consumed-reagent-ids.query.ts`:

```ts
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

/**
 * Spec §6.2: "reagents whose consumption exceeded X, with or without a date
 * range". This is a HAVING over grouped consumptions, which Prisma's query API
 * cannot express over a nested relation — hence the one hand-written query in
 * this codebase.
 *
 * It answers only the aggregation question. The simple filters (name, CAS,
 * location, expiry, low stock, includeInactive) stay in `buildReagentWhere`
 * and are applied by the caller, so they keep a single definition and cannot
 * drift between two languages.
 *
 * The unit is part of the grouping, not incidental: a reagent may hold
 * millilitres and litres at once, and summing across them would produce a
 * number that corresponds to no physical quantity. See the spec amendment in
 * the Phase 4 plan.
 *
 * Returns `null` when the filter does not apply, which is different from `[]`:
 * `[]` means the filter applied and nothing qualified, and must yield an empty
 * page rather than the unfiltered list.
 */
export async function selectConsumedReagentIds(
  prisma: PrismaService,
  query: ListReagentsQueryDto,
): Promise<string[] | null> {
  if (!query.minConsumed || !query.minConsumedUnit) {
    return null;
  }

  const from = query.consumedFrom ? new Date(query.consumedFrom) : null;
  const to = query.consumedTo ? new Date(query.consumedTo) : null;

  // Every value below is a binding. Prisma's tagged template turns each `${}`
  // into a placeholder and sends the value separately; none of them is ever
  // concatenated into the SQL text.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT r.id
    FROM   "Reagent" r
    JOIN   "ReagentBatch" b
      ON   b."reagentId" = r.id AND b.active AND b.unit = ${query.minConsumedUnit}::"Unit"
    JOIN   "Consumption" c
      ON   c."batchId" = b.id AND c.active
    WHERE  r.active
      AND  (${from}::timestamptz IS NULL OR c."consumedAt" >= ${from}::timestamptz)
      AND  (${to}::timestamptz   IS NULL OR c."consumedAt" <= ${to}::timestamptz)
    GROUP BY r.id
    HAVING SUM(c.quantity) > ${new Prisma.Decimal(query.minConsumed)}
  `;

  return rows.map((row) => row.id);
}
```

Note the explicit casts. `b.unit` is a Postgres enum and `consumedAt` is `timestamptz`; without the casts a `null` binding has no type Postgres can infer, and the query fails at runtime rather than at compile time.

- [ ] **Step 4: Run the unit tests**

Run: `npm run test -w apps/api -- consumed-reagent-ids` — expected PASS, 3 tests.
Run: `npm run build -w apps/api` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reagents/consumed-reagent-ids.query.ts apps/api/src/reagents/consumed-reagent-ids.query.spec.ts
git commit -m "feat(api): add the grouped-consumption id query"
```

---

## Task 3: Wire the composite filter into the reagents listing

**Files:**
- Modify: `apps/api/src/reagents/reagent-ids.query.ts`
- Modify: `docs/superpowers/specs/2026-08-23-labtrack-mvp-design.md` (§6.2)
- Test: `apps/api/test/reagents.e2e-spec.ts`

**Interfaces:**
- Consumes: `selectConsumedReagentIds` from Task 2.
- Produces: no signature change — `selectReagentIds(prisma, query)` keeps returning `{ ids, total }`, which is why `reagents.service.ts` and the controller do not change at all.

- [ ] **Step 1: Write the failing e2e tests**

Seed, in one test's arrangement: a reagent `Acetona` with an `ML` batch consuming `600` in total across two consumptions; a reagent `Etanol` with an `ML` batch consuming `100`; and a reagent `Metanol` with an **`L`** batch consuming `900`.

```ts
it('returns only reagents whose consumption in that unit exceeds the threshold', async () => {
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?minConsumed=500&minConsumedUnit=ML')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ReagentDto>>(response);
  expect(page.data.map((r) => r.name)).toEqual(['Acetona']);
  expect(page.total).toBe(1);
});

it('never sums across units: 900 L does not satisfy a 500 mL threshold', async () => {
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?minConsumed=500&minConsumedUnit=ML')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(body<PaginatedResponse<ReagentDto>>(response).data.map((r) => r.name)).not.toContain(
    'Metanol',
  );
});

it('sums several consumptions of the same batch rather than taking the largest', async () => {
  // Acetona's 600 is 350 + 250. An implementation using MAX instead of SUM
  // would return nothing here, and an implementation taking only the first
  // consumption would too.
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?minConsumed=500&minConsumedUnit=ML')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(body<PaginatedResponse<ReagentDto>>(response).data.map((r) => r.name)).toEqual(['Acetona']);
});

it('bounds the sum by the date range, so consumptions outside it do not count', async () => {
  // Acetona's two consumptions are dated 2026-08-01 and 2026-08-20. A range
  // covering only August 1st leaves 350, below the threshold.
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get(
      '/reagents?minConsumed=500&minConsumedUnit=ML' +
        '&consumedFrom=2026-08-01T00:00:00.000Z&consumedTo=2026-08-02T00:00:00.000Z',
    )
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(body<PaginatedResponse<ReagentDto>>(response).data).toEqual([]);
});

it('ignores voided consumptions', async () => {
  // Void one of Acetona's two consumptions, leaving 350 of 600.
  // A void returns stock; it must also stop counting toward this filter.
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?minConsumed=500&minConsumedUnit=ML')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(body<PaginatedResponse<ReagentDto>>(response).data).toEqual([]);
});

it('composes with the simple filters instead of replacing them', async () => {
  // Acetona qualifies on consumption but the name filter excludes it.
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?minConsumed=500&minConsumedUnit=ML&name=etan')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(body<PaginatedResponse<ReagentDto>>(response).data).toEqual([]);
});

it('returns an empty page when nothing qualifies, not the unfiltered list', async () => {
  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?minConsumed=99999&minConsumedUnit=ML')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ReagentDto>>(response);
  expect(page.data).toEqual([]);
  expect(page.total).toBe(0);
});
```

The last one is the `null`-versus-`[]` distinction made observable. An implementation that treats "no qualifying ids" as "filter not applied" returns every reagent and passes nothing else in this list.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- reagents`
Expected: FAIL — the filter is accepted (Task 1) but ignored, so every test that expects narrowing gets the full list back.

- [ ] **Step 3: Intersect the two paths**

In `reagent-ids.query.ts`, inside `selectReagentIds`, before the transaction:

```ts
  // Spec §6.2. The aggregation runs first and yields the ids that qualify;
  // the simple filters then apply to exactly those ids through the ordinary
  // Prisma path, so `buildReagentWhere` stays the single definition of what
  // every other filter means.
  //
  // `null` means the filter was not requested. `[]` means it was requested
  // and nothing qualified — which must produce an empty page, not the
  // unfiltered list, so the two cannot be collapsed into one falsy check.
  const consumedIds = await selectConsumedReagentIds(prisma, query);
  if (consumedIds !== null) {
    where.id = { in: consumedIds };
  }
```

The raw query returns every qualifying id, unpaginated. For a laboratory's volume that is a few hundred rows at most; the alternative — paginating inside the raw query — would force the simple filters to be re-expressed in SQL, where they would drift from `buildReagentWhere`. Record that trade-off in the comment.

- [ ] **Step 4: Run the tests**

Run: `npm run test:e2e -w apps/api` — expected PASS.
Run: `npm run test -w apps/api` and `npm run build -w apps/api` — both green.

- [ ] **Step 5: Update the spec**

Edit §6.2 of `docs/superpowers/specs/2026-08-23-labtrack-mvp-design.md`: replace the SQL block with the amended query (the join constrained by `b.unit = $unit`), and add a sentence saying the unit is required with the threshold and why. The spec is the authority; leaving it describing a query the code does not run makes it useless to the next reader.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reagents docs/superpowers/specs apps/api/test/reagents.e2e-spec.ts
git commit -m "feat(api): filter reagents by consumption over a threshold"
```

---

## Task 4: The composite filter panel on the reagents screen

Spec §7.2, screen 2: the reagents table's filter panel gains the composite filter. Four controls that only mean anything together — a threshold, a unit, and an optional date range.

**Files:**
- Modify: `apps/web/src/app/features/reagents/reagents.store.ts`
- Modify: `apps/web/src/app/features/reagents/reagents.component.ts`
- Modify: `apps/web/src/app/features/reagents/i18n.es.ts`
- Test: `apps/web/src/app/features/reagents/reagents.store.spec.ts`, `reagents.component.spec.ts`

**Interfaces:**
- Consumes: the four query parameters from Task 1 — `minConsumed`, `minConsumedUnit`, `consumedFrom`, `consumedTo`.
- Produces: `ReagentsStore.setConsumptionFilter(minConsumed, unit, from, to)`.

### Read before writing

`apps/web/src/app/features/consumptions/consumptions.store.ts` — it already does exactly this shape of work: primitive filter values, a date range converted at the store boundary, and `applyFilters` folding into the current filters rather than replacing them. Mirror it.

`apps/web/src/app/shared/date/utc-midnight.ts` — `toUtcMidnightIso` and `fromUtcMidnightIso`. Use both. A picker `Date` is local midnight and `consumedAt` is stored at UTC midnight; three defects of this shape shipped across Phases 2 and 3, and the last one walked the date back a further day on every edit cycle.

- [ ] **Step 1: Write the failing store spec**

```ts
it('sends the threshold with its unit, since neither means anything alone', () => {
  store.setConsumptionFilter('500', 'ML', null, null);
  const request = http.expectOne((r) => r.url === '/reagents');
  expect(request.request.params.get('minConsumed')).toBe('500');
  expect(request.request.params.get('minConsumedUnit')).toBe('ML');
});

it('drops both when the threshold is cleared, so a stale unit cannot linger', () => {
  store.setConsumptionFilter('500', 'ML', null, null);
  http.expectOne((r) => r.url === '/reagents').flush(emptyPage);

  store.setConsumptionFilter('', 'ML', null, null);
  const request = http.expectOne((r) => r.url === '/reagents');
  // The API rejects a threshold without a unit but accepts a unit alone, so a
  // lingering unit is harmless to it — it is the *user* who would be misled by
  // a filter panel showing a unit that filters nothing.
  expect(request.request.params.has('minConsumed')).toBe(false);
  expect(request.request.params.has('minConsumedUnit')).toBe(false);
});

it('sends the consumption date range as UTC-midnight ISO strings', () => {
  // Local midnight, deliberately: this is the fixture shape that catches a
  // bare .toISOString(). A UTC-midnight fixture passes either way.
  store.setConsumptionFilter('500', 'ML', new Date(2026, 7, 1), new Date(2026, 7, 31));
  const request = http.expectOne((r) => r.url === '/reagents');
  expect(request.request.params.get('consumedFrom')).toBe('2026-08-01T00:00:00.000Z');
  expect(request.request.params.get('consumedTo')).toBe('2026-08-31T00:00:00.000Z');
});

it('preserves the other filters when the consumption filter changes', () => {
  store.setName('aceton');
  tick(300);
  http.expectOne((r) => r.url === '/reagents').flush(emptyPage);

  store.setConsumptionFilter('500', 'ML', null, null);
  const request = http.expectOne((r) => r.url === '/reagents');
  expect(request.request.params.get('name')).toBe('aceton');
  expect(request.request.params.get('minConsumed')).toBe('500');
});

it('returns to page 1 when the consumption filter changes', () => {
  store.setPage(3);
  http.expectOne((r) => r.url === '/reagents').flush(emptyPage);

  store.setConsumptionFilter('500', 'ML', null, null);
  expect(http.expectOne((r) => r.url === '/reagents').request.params.get('page')).toBe('1');
});
```

The web suite runs under a pinned `TZ=America/Bogota` (`apps/web/package.json`'s `test` script). That is what makes the third test able to fail — do not remove it, and do not "fix" a failing date test by moving the fixture to UTC midnight.

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w apps/web`
Expected: FAIL — `setConsumptionFilter` does not exist.

- [ ] **Step 3: Extend the store**

Add to `ReagentsFilters`: `minConsumed?: string`, `minConsumedUnit?: string`, `consumedFrom?: string`, `consumedTo?: string` — all primitive, because the store's serialisation boundary is cast and a `Date` here would compile and then fail at runtime.

```ts
  // The threshold and the unit travel together or not at all: a threshold
  // without a unit is rejected by the API (§6.2 as amended, since a reagent
  // may hold millilitres and litres at once), and a unit without a threshold
  // filters nothing while suggesting to the user that it does.
  setConsumptionFilter(
    minConsumed: string,
    unit: string,
    from: Date | null,
    to: Date | null,
  ): void {
    const threshold = minConsumed || undefined;
    this.applyFilters({
      minConsumed: threshold,
      minConsumedUnit: threshold ? unit || undefined : undefined,
      consumedFrom: from ? toUtcMidnightIso(from) : undefined,
      consumedTo: to ? toUtcMidnightIso(to) : undefined,
    });
  }
```

Add computed accessors for all four, following `purposeFilter`/`reagentIdFilter` in `ConsumptionsStore` — the dates through `fromUtcMidnightIso`. The component seeds from them, and **`ConsumptionsComponent` is the model to copy**: `ReagentsComponent` and `LocationsComponent` already seed their existing controls, so add these four to that same `ngOnInit` block with `{ emitEvent: false }`.

- [ ] **Step 4: Write the dictionary entries**

In `features/reagents/i18n.es.ts`, inside the existing `filters` object:

```ts
    minConsumed: 'Consumo mayor a',
    minConsumedUnit: 'Unidad',
    consumedFrom: 'Consumido desde',
    consumedTo: 'Consumido hasta',
    unitRequired: 'Elige la unidad del consumo.',
```

- [ ] **Step 5: Add the controls and a component test**

The panel needs a number-ish text input for the threshold, a `mat-select` of `UNITS`, and two datepickers. Make the unit control `required` only while the threshold is non-empty, showing `unitRequired` — the same rule the API enforces, applied client-side so the user learns before a round trip.

The component spec must pin one thing the store spec cannot:

```ts
it('does not send a consumption filter while the unit is missing', () => {
  component.filtersForm.controls.minConsumed.setValue('500');
  component.applyConsumptionFilter();

  // Without this the user gets a 400 from an endpoint they cannot see, and
  // the table simply stops updating with no explanation.
  http.expectNone((r) => r.url === '/reagents' && r.params.has('minConsumed'));
  expect(component.filtersForm.controls.minConsumedUnit.hasError('required')).toBe(true);
});
```

- [ ] **Step 6: Verify**

Run: `npm run test -w apps/web` — expected baseline 88 plus your six.
Run: `npm run build -w apps/web` — exit 0, and **report the bundle size** (416.06 kB, budget 500).

Then prove the date test is not vacuous: change `toUtcMidnightIso(from)` to `from.toISOString()`, re-run, confirm the UTC-midnight test fails, restore.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/reagents
git commit -m "feat(web): filter reagents by consumption over a threshold"
```

---

## Task 5: Tell the user why a void failed

Carried from Phase 3's final review. `consumptions.component.ts` shows one generic snackbar for every failure, so two admins racing to void the same consumption leaves the loser reading "No se pudo anular el consumo." with no hint that someone else already handled it.

**Files:**
- Modify: `apps/web/src/app/features/consumptions/consumptions.component.ts`
- Modify: `apps/web/src/app/features/consumptions/i18n.es.ts`
- Test: `apps/web/src/app/features/consumptions/consumptions.component.spec.ts`

**Interfaces:**
- Consumes: the API's error codes — `WRITE_CONFLICT` (409, from `PrismaExceptionFilter`) and the 400 whose message is `'This consumption is already voided'`.

- [ ] **Step 1: Write the failing tests**

```ts
it('tells the user someone else voided it first when the API reports a write conflict', () => {
  openVoidDialogAndConfirm(component, 'Registrado por error');
  http.expectOne((r) => r.method === 'PATCH').flush(
    { statusCode: 409, code: 'WRITE_CONFLICT' },
    { status: 409, statusText: 'Conflict' },
  );

  expect(snackBarSpy).toHaveBeenCalledWith(
    VOID_CONSUMPTION_ES.conflict,
    COMMON_ES.accept,
    expect.anything(),
  );
});

it('tells the user it was already voided when the API says so', () => {
  openVoidDialogAndConfirm(component, 'Registrado por error');
  http.expectOne((r) => r.method === 'PATCH').flush(
    { message: 'This consumption is already voided' },
    { status: 400, statusText: 'Bad Request' },
  );

  expect(snackBarSpy).toHaveBeenCalledWith(
    VOID_CONSUMPTION_ES.alreadyVoided,
    COMMON_ES.accept,
    expect.anything(),
  );
});

it('falls back to the generic message for anything else', () => {
  openVoidDialogAndConfirm(component, 'Registrado por error');
  http.expectOne((r) => r.method === 'PATCH').flush(null, {
    status: 500,
    statusText: 'Server Error',
  });

  expect(snackBarSpy).toHaveBeenCalledWith(
    VOID_CONSUMPTION_ES.failure,
    COMMON_ES.accept,
    expect.anything(),
  );
});
```

The third is not filler: a `switch` with no default would leave a 500 silent, which is worse than the generic message this task started with.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test -w apps/web`
Expected: the first two FAIL — the generic message is shown for all three.

- [ ] **Step 3: Add the messages**

In `features/consumptions/i18n.es.ts`, inside `VOID_CONSUMPTION_ES`:

```ts
  conflict: 'Otro administrador anuló este consumo al mismo tiempo. Actualiza la lista.',
  alreadyVoided: 'Este consumo ya estaba anulado.',
```

- [ ] **Step 4: Branch on the error**

Replace the void error handler. Branch on `HttpErrorResponse.status` and, for the 409, on `error.error?.code === 'WRITE_CONFLICT'`; reload the list after a conflict or an already-voided response, since in both cases the screen is showing a row whose state has moved on.

```ts
          error: (error: HttpErrorResponse) => {
            // A 409 is the Serializable write conflict PrismaExceptionFilter
            // maps from P2034, and a 400 here is the already-voided guard.
            // Both mean the row on screen is stale, so reload as well as
            // explain — otherwise the user re-clicks a button that cannot
            // succeed.
            const message =
              error.status === 409 && error.error?.code === 'WRITE_CONFLICT'
                ? VOID_CONSUMPTION_ES.conflict
                : error.status === 400
                  ? VOID_CONSUMPTION_ES.alreadyVoided
                  : VOID_CONSUMPTION_ES.failure;

            if (error.status === 409 || error.status === 400) {
              this.store.reload();
            }
            this.snackBar.open(message, COMMON_ES.accept, { duration: 5000 });
          },
```

- [ ] **Step 5: Verify and commit**

Run: `npm run test -w apps/web` — expected PASS. `npm run build -w apps/web` — exit 0.

```bash
git add apps/web/src/app/features/consumptions
git commit -m "fix(web): explain why a void failed instead of one generic message"
```

---

## Task 6: The location picker beyond 100

Carried from Phase 2. `LocationsStore.listActive()` requests `pageSize: 100`, which is the API's maximum, and silently drops everything past it. A laboratory that outgrows 100 locations gets a picker that cannot reach the rest, with no indication anything is missing.

**Files:**
- Modify: `apps/web/src/app/features/locations/locations.store.ts`
- Test: `apps/web/src/app/features/locations/locations.store.spec.ts`

**Interfaces:**
- Produces: `listActive(): Observable<LocationDto[]>` — unchanged signature, now complete rather than truncated.

- [ ] **Step 1: Write the failing test**

```ts
it('fetches every page, so locations past the first are not silently missing', () => {
  const locations: LocationDto[] = [];
  store.listActive().subscribe((result) => locations.push(...result));

  const first = http.expectOne((r) => r.url === '/locations' && r.params.get('page') === '1');
  first.flush({ data: pageOf(100, 'A'), total: 150, page: 1, pageSize: 100, totalPages: 2 });

  const second = http.expectOne((r) => r.url === '/locations' && r.params.get('page') === '2');
  second.flush({ data: pageOf(50, 'B'), total: 150, page: 2, pageSize: 100, totalPages: 2 });

  expect(locations).toHaveLength(150);
});

it('makes exactly one request when everything fits on one page', () => {
  store.listActive().subscribe();
  http
    .expectOne((r) => r.url === '/locations' && r.params.get('page') === '1')
    .flush({ data: pageOf(12, 'A'), total: 12, page: 1, pageSize: 100, totalPages: 1 });

  // The common case must not pay for the uncommon one.
  http.expectNone((r) => r.url === '/locations');
});
```

`pageOf(n, prefix)` is a local helper building `n` `LocationDto` fixtures.

- [ ] **Step 2: Run and watch the first fail**

Run: `npm run test -w apps/web`
Expected: the first FAILS with 100 locations instead of 150; the second already passes and guards against over-correcting into a request per page regardless.

- [ ] **Step 3: Follow the pagination**

Read the first page, then request the remaining pages using `totalPages` from the response and concatenate. `expand` or a `mergeMap` over a page range both work; keep it to one page when `totalPages` is 1.

```ts
  // The picker needs every active location, and the API caps a page at 100
  // (spec §5.3). Follow the pagination rather than truncating: a laboratory
  // with more than 100 locations would otherwise get a picker that silently
  // cannot reach the rest.
```

- [ ] **Step 4: Verify and commit**

Run: `npm run test -w apps/web` and `npm run build -w apps/web` — both green; report the bundle size.

```bash
git add apps/web/src/app/features/locations
git commit -m "fix(web): load every page of locations into the picker"
```

---

## Task 7: Let an edit clear an optional field

Carried from Phase 2. `UpdateReagentRequest` and `UpdateLocationRequest` carry `string | undefined`, and the dialogs strip blanks to `undefined`, which Prisma reads as "leave unchanged". So a reference, description or data-sheet URL can be set and corrected but never emptied. The only way out today is a direct database edit.

**Files:**
- Modify: `packages/shared/src/inventory.ts`
- Modify: `apps/api/src/reagents/dto/update-reagent.dto.ts`, `apps/api/src/locations/dto/update-location.dto.ts`
- Modify: `apps/api/src/reagents/reagents.service.ts`, `apps/api/src/locations/locations.service.ts`
- Modify: the reagent and location dialogs under `apps/web/src/app/features/`
- Test: `apps/api/test/reagents.e2e-spec.ts`, `apps/api/test/locations.e2e-spec.ts`, and the dialog specs

**Interfaces:**
- Produces: optional fields on the update requests become `string | null | undefined`. **`undefined` still means "leave unchanged"; `null` now means "clear it".** That distinction is the whole task — collapsing them would either make every omitted field clear itself or leave the bug in place.

- [ ] **Step 1: Write the failing API test**

```ts
it('clears an optional field when it is sent as null', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const reagent = await prisma.reagent.create({
    data: { name: 'Acetona', casNumber: '67-64-1', reference: 'REF-1', madeById: admin.id },
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .patch(`/reagents/${reagent.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reference: null })
    .expect(200);

  expect(body<ReagentDto>(response).reference).toBeNull();
});

it('leaves an optional field untouched when it is omitted', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const reagent = await prisma.reagent.create({
    data: { name: 'Acetona', casNumber: '67-64-1', reference: 'REF-1', madeById: admin.id },
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .patch(`/reagents/${reagent.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Acetona pura' })
    .expect(200);

  // This is the test that stops the fix from becoming a worse bug: if null
  // and undefined were collapsed, editing the name would wipe the reference.
  expect(body<ReagentDto>(response).reference).toBe('REF-1');
});
```

Write the same pair for `PATCH /locations/:id` and `description`.

- [ ] **Step 2: Run and watch the first fail**

Run: `npm run test:e2e -w apps/api -- reagents` (port 3000 clear, one invocation)
Expected: the first FAILS — `whitelist`/`forbidNonWhitelisted` with `@IsOptional()` rejects or ignores the explicit `null`, so `reference` comes back `'REF-1'`.

- [ ] **Step 3: Widen the contract**

In `packages/shared/src/inventory.ts`:

```ts
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
```

and the same for `UpdateLocationRequest.description`.

In the DTOs, replace `@IsOptional()` on those fields with `@ValidateIf((_, value) => value !== null)` plus `@IsOptional()`, so an explicit `null` survives validation instead of being rejected. Verify which combination your `class-validator` version honours by running the test rather than reasoning about it.

In the services, map the field explicitly instead of passing the DTO through:

```ts
        // `?? undefined` would defeat the whole point: it turns an explicit
        // null back into "leave unchanged". The field is passed through as-is,
        // and Prisma treats null as SET NULL and undefined as omitted.
        reference: dto.reference,
```

- [ ] **Step 4: Let the dialogs send null**

The reagent and location dialogs currently strip blanks to `undefined` in `confirm()`. A blank field must now send `null` **when editing** and stay `undefined` **when creating** — a create has nothing to clear, and sending nulls there would write nulls into columns the create path leaves at their defaults.

Update the dialog specs accordingly: the existing "strips blank optional fields to undefined" test becomes two, one per mode.

- [ ] **Step 5: Verify**

Run all of: `npm run test -w apps/api`, `npm run test:e2e -w apps/api`, `npm run test -w apps/web`, `npm run build -w apps/api`, `npm run build -w apps/web`, `npm run lint -w apps/api`.

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/api apps/web
git commit -m "fix: let an edit clear an optional field"
```

---

## Plan Self-Review

**Spec coverage.** §6.2 composite filter → Tasks 1–3, with the unit amendment written back into the spec in Task 3. §7.2 screen 2's filter panel → Task 4. §4.1's rule that quantities are read within their unit → enforced by the amended join and pinned by Task 3's "900 L does not satisfy 500 mL" test. §5.3 pagination → unchanged; `selectReagentIds` keeps its signature, which is why no controller or service changes.

**The remaining spec scope after this plan is empty.** §11's Excel import and PDF/Excel export are explicitly out of the MVP.

**Type consistency.** `selectConsumedReagentIds` (Task 2) is consumed only by `selectReagentIds` (Task 3). The four query fields are named identically in the DTO (Task 1), the store (Task 4) and the tests. `ReagentsFilters` gains four primitives, matching the constraint the store's cast no longer enforces. `UpdateReagentRequest` (Task 7) is consumed by the API DTOs and the web dialogs, which is why that task changes all three layers in one commit rather than leaving a version skew.

**Ordering.** Tasks 1→2→3 are strictly sequential. Task 4 depends on Task 1's parameter names. Tasks 5, 6 and 7 are independent of everything else and of each other.

**Known risk, stated rather than hidden.** Task 2 is the only hand-written SQL in the codebase, and its correctness rests on Postgres' `::"Unit"` and `::timestamptz` casts, which exist because a `null` binding otherwise has no inferable type. If the query fails at runtime with a type error, that is the first place to look — not the JavaScript.

**Deliberately not in this plan:** the typed-ISO datepicker display quirk (display-only, `NativeDateAdapter`'s own parsing), `lock_timeout` on the test connection, and the Phase 2 race test that asserts `switchMap` cancellation rather than the agnostic contract. All three are recorded in their phases' ledgers with rulings.
