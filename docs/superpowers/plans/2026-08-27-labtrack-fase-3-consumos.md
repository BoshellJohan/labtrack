# LabTrack Fase 3 — Consumos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build consumption recording, listing and voiding — the functional core of LabTrack — and close the four debt items Phase 2 left behind.

**Architecture:** Consumptions hang off a batch, never off a reagent directly, so the unit is unambiguous. Recording a consumption is a Serializable transaction that validates `quantity <= currentStock`, inserts the row and decrements the batch; voiding reverses exactly that and is ADMIN-only with a mandatory reason stored on the row itself. The client gains two screens — a guided register flow (reagent → batch → quantity) and a descending list with filters and an admin-only void dialog — built on the existing `PaginatedStore`.

**Tech Stack:** NestJS 11, Prisma 7 (driver adapter), PostgreSQL 18, Angular 22 with signals, Jest + Supertest (API), Vitest (web).

**Spec:** `docs/superpowers/specs/2026-08-23-labtrack-mvp-design.md` — §4.2 (materialized stock), §4.4 (voiding), §5.1 (endpoints), §6.1 (simple filters), §6.3 (consumption filters), §7.2 (screens 3 and 4).

## Global Constraints

- Code, identifiers, file names, comments and commit messages in **English**. Every user-visible string is **Spanish** and lives in an `i18n.es.ts` dictionary — never a literal in a template.
- **No physical deletes.** Every table carries `active`; deletion is `active = false`.
- Every insert or update of a reagent or consumption records `createdAt`, `updatedAt` and `madeById`.
- Quantities are `Decimal(12,4)` and are serialized as **strings** in every DTO. Never parse one into a JS `number`.
- Conventional commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).
- TDD: the failing test comes first, and you must see it fail for the stated reason before implementing.
- Standalone Angular components, `ChangeDetectionStrategy.OnPush`, lazy routes via `loadComponent`.
- **Authorization is server-side.** `auth.isAdmin()` only hides affordances; `RolesGuard` and explicit assertions enforce.
- No Angular component calls `HttpClient` directly — it goes through `ApiService` or a store.
- `ValidationPipe` runs with `whitelist: true` and `forbidNonWhitelisted: true`, and **without** `enableImplicitConversion` — a numeric value in a string field is rejected, not coerced.
- Run `npm run build -w apps/api` before declaring any API task done. Tests and lint passing is not sufficient; the build has caught defects both passed.

---

## File Structure

**Debt (Tasks 1–4)**

| File | Responsibility |
|---|---|
| `apps/api/prisma/migrations/<ts>_reagent_name_normalized/migration.sql` | `unaccent` + `pg_trgm`, an IMMUTABLE wrapper, the generated `nameNormalized` column and its GIN index |
| `apps/api/src/common/text/normalize.ts` | `normalizeForSearch()` — the Node side of the same normalization |
| `apps/api/src/reagents/reagent-ids.query.ts` | gains the `nameNormalized`, `expiringBefore` and `lowStock` clauses |
| `apps/api/src/reagents/dto/list-reagents-query.dto.ts` | gains `expiringBefore` and `lowStock` |
| `apps/api/src/reagents/reagents.service.ts` | `findOne` gains the `active` gate |
| `apps/web/src/app/features/reagents/reagents.component.spec.ts` | gains the locale and expiry-boundary tests |

**Consumptions (Tasks 5–11)**

| File | Responsibility |
|---|---|
| `packages/shared/src/consumption.ts` | `ConsumptionDto`, request types, `CONSUMPTION_SORT_COLUMNS` |
| `apps/api/src/common/mappers/consumption.mapper.ts` | row + relations → `ConsumptionDto`, quantities as strings |
| `apps/api/src/consumptions/consumptions.module.ts` | module wiring |
| `apps/api/src/consumptions/consumptions.controller.ts` | route/validation layer only |
| `apps/api/src/consumptions/consumptions.service.ts` | create, list and void — the only place that touches Prisma |
| `apps/api/src/consumptions/dto/*.ts` | `CreateConsumptionDto`, `VoidConsumptionDto`, `ListConsumptionsQueryDto` |
| `apps/web/src/app/features/consumptions/consumptions.store.ts` | list state + filters, on `PaginatedStore` |
| `apps/web/src/app/features/consumptions/consumptions.component.ts` | descending table, filters, void dialog trigger |
| `apps/web/src/app/features/consumptions/void-consumption.dialog.ts` | admin-only, mandatory reason |
| `apps/web/src/app/features/consumptions/register-consumption.component.ts` | the guided reagent → batch → quantity flow |
| `apps/web/src/app/features/consumptions/i18n.es.ts` | every Spanish string for both screens |

---

## Task 1: Accent-insensitive reagent name search

Spec §6.1 requires name search to be "parcial, insensible a mayúsculas **y acentos**". Today `reagent-ids.query.ts` uses Prisma's `contains` with `mode: 'insensitive'`, which compiles to `ILIKE` — that folds case but not accents, so `acido` finds nothing for `Ácido clorhídrico`.

The fix keeps Prisma in charge of the query. A **generated column** stores the normalized form, so `contains` can search it with an index behind it, and the query term is normalized in Node with the same rule.

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_reagent_name_normalized/migration.sql`
- Create: `apps/api/src/common/text/normalize.ts`
- Create: `apps/api/src/common/text/normalize.spec.ts`
- Modify: `apps/api/prisma/schema.prisma` (add `nameNormalized` to `Reagent`)
- Modify: `apps/api/src/reagents/reagent-ids.query.ts` (the `query.name` branch)
- Test: `apps/api/test/reagents.e2e-spec.ts`

**Interfaces:**
- Produces: `normalizeForSearch(value: string): string` in `apps/api/src/common/text/normalize.ts`.

- [ ] **Step 1: Write the failing e2e test**

Add to `apps/api/test/reagents.e2e-spec.ts`, inside the existing top-level `describe`:

```ts
it('finds an accented name when the search term has no accents', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  await prisma.reagent.create({
    data: { name: 'Ácido clorhídrico', casNumber: '7647-01-0', madeById: admin.id },
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?name=acido')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ReagentDto>>(response);
  expect(page.data.map((r) => r.name)).toEqual(['Ácido clorhídrico']);
});

it('still finds an unaccented name when the search term is accented', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  await prisma.reagent.create({
    data: { name: 'Acetona', casNumber: '67-64-1', madeById: admin.id },
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?name=acetóna')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ReagentDto>>(response);
  expect(page.data.map((r) => r.name)).toEqual(['Acetona']);
});
```

The second test is the one that stops a half-fix: normalizing only the stored column, and not the search term, passes the first test and fails this one.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:e2e -w apps/api -- reagents`
Expected: both new tests FAIL with `expect(received).toEqual(expected)` — received `[]`, because `ILIKE '%acido%'` does not match `Ácido clorhídrico`.

- [ ] **Step 3: Write the migration**

Create `apps/api/prisma/migrations/20260827120000_reagent_name_normalized/migration.sql`:

```sql
-- Accent-insensitive name search (spec §6.1). Postgres' own unaccent() is
-- STABLE, not IMMUTABLE, because its behaviour depends on a dictionary that
-- could be changed. A generated column and an expression index both require
-- IMMUTABLE, so we wrap it: the wrapper pins the dictionary by name, which is
-- what makes the promise safe to keep.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Stored, not computed per query: the search runs on every keystroke of the
-- reagents filter, while a reagent's name changes almost never.
ALTER TABLE "Reagent"
  ADD COLUMN "nameNormalized" text
  GENERATED ALWAYS AS (f_unaccent(lower("name"))) STORED;

-- Trigram GIN, because the filter is a substring match: a btree index cannot
-- serve `LIKE '%acido%'`, which is unanchored at both ends.
CREATE INDEX "Reagent_nameNormalized_trgm_idx"
  ON "Reagent" USING gin ("nameNormalized" gin_trgm_ops);
```

- [ ] **Step 4: Declare the column in the schema**

In `apps/api/prisma/schema.prisma`, inside `model Reagent`, after the `name` field:

```prisma
  /// Generated by Postgres as f_unaccent(lower(name)); see the
  /// reagent_name_normalized migration. Never written by the application —
  /// Prisma only reads it, and the filter in reagent-ids.query.ts matches
  /// against it.
  nameNormalized String @default(dbgenerated()) @map("nameNormalized")
```

Then run `npx prisma generate` from `apps/api` so the client knows the field.

**The one uncertainty in this task, flagged rather than hidden.** Prisma has no first-class support for `GENERATED ALWAYS AS ... STORED` columns. The pattern above works because Prisma only writes the fields you pass in `data`, and nothing ever passes `nameNormalized` — but verify it rather than assuming. After generating, run the existing reagent e2e suite: if `POST /reagents` fails because Prisma tries to write the column, **stop and switch to the fallback** rather than fighting it.

*Fallback:* make `nameNormalized` an ordinary `String` column, drop `GENERATED ALWAYS AS` from the migration in favour of a plain `ADD COLUMN` plus a backfill (`UPDATE "Reagent" SET "nameNormalized" = f_unaccent(lower("name"))`) and a `NOT NULL` afterwards, and have `ReagentsService.create` and `.update` set it with `normalizeForSearch(name)`. Both writes already flow through that one service, and Task 3 is the only other task touching it. The index and the query change are identical either way. If you take the fallback, add an e2e test that renames a reagent and then finds it by its new name — that is the case the generated column got for free and the application-maintained one can forget.

- [ ] **Step 5: Write the Node-side normalizer and its test**

Create `apps/api/src/common/text/normalize.spec.ts`:

```ts
import { normalizeForSearch } from './normalize';

describe('normalizeForSearch', () => {
  it('lowercases and strips accents so a search term matches a stored name', () => {
    expect(normalizeForSearch('Ácido Clorhídrico')).toBe('acido clorhidrico');
  });

  it('leaves ñ alone, which is a letter in Spanish and not an accented n', () => {
    expect(normalizeForSearch('Estaño')).toBe('estaño');
  });

  it('is idempotent, so normalizing an already-normalized term changes nothing', () => {
    expect(normalizeForSearch(normalizeForSearch('Ácido'))).toBe('acido');
  });
});
```

Create `apps/api/src/common/text/normalize.ts`:

```ts
/**
 * The Node-side twin of the `f_unaccent(lower(...))` expression behind
 * `Reagent.nameNormalized`. The stored column and the search term must be
 * normalized the same way or the comparison silently misses: normalizing only
 * one side finds `Ácido` for `acido` but not `Acetona` for `acetóna`.
 *
 * `ñ` survives because Postgres' unaccent dictionary treats it as its own
 * letter rather than an accented `n`, and Spanish agrees — `año` and `ano`
 * are different words.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-̧̃̈̊]/g, '')
    .normalize('NFC')
    .toLowerCase();
}
```

The escape list is deliberate rather than the broader `\p{Diacritic}`: it covers the marks Postgres' dictionary folds (acute, grave, circumflex, tilde-over-vowel, diaeresis, ring, cedilla) while leaving the combining tilde of `ñ` — which is `̃` over `n` — reconstituted by the following `NFC`. Verify the `ñ` test passes before moving on; if it does not, the mark list is wrong and the fix belongs here, not in the test.

- [ ] **Step 6: Point the filter at the normalized column**

In `apps/api/src/reagents/reagent-ids.query.ts`, replace the `query.name` branch:

```ts
  if (query.name) {
    // Both sides normalized: the column by Postgres, the term by us. `mode`
    // is gone because the column is already lowercased — asking for
    // case-insensitivity here would defeat the trigram index.
    where.nameNormalized = { contains: normalizeForSearch(query.name) };
  }
```

and add the import:

```ts
import { normalizeForSearch } from '../common/text/normalize';
```

- [ ] **Step 7: Run everything**

Run: `npm run test:e2e -w apps/api`
Expected: PASS, 62 tests (60 + the 2 new).

Run: `npm run test -w apps/api` — expected 64 (61 + 3 new).
Run: `npm run build -w apps/api` — expected exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/src/common/text apps/api/src/reagents/reagent-ids.query.ts apps/api/test/reagents.e2e-spec.ts
git commit -m "feat(api): make reagent name search accent-insensitive"
```

---

## Task 2: The `expiringBefore` and `lowStock` filters

Spec §6.1 lists five filters for `GET /reagents`. Phase 2 shipped three. These two were never built and appeared in neither the plan nor the ledger — this is a scope shortfall being repaid, not new work.

Both are filters on a reagent's **batches**, not on the reagent itself: a reagent qualifies when at least one of its active batches does.

**Files:**
- Modify: `apps/api/src/reagents/dto/list-reagents-query.dto.ts`
- Modify: `apps/api/src/reagents/reagent-ids.query.ts`
- Test: `apps/api/test/reagents.e2e-spec.ts`

**Interfaces:**
- Consumes: `selectReagentIds(prisma, query)` from Task 1's file.
- Produces: `ListReagentsQueryDto.expiringBefore?: string` (ISO date) and `.lowStock?: string` (decimal string).

- [ ] **Step 1: Write the failing e2e tests**

Add to `apps/api/test/reagents.e2e-spec.ts`:

```ts
it('filters to reagents holding a batch that expires before the given date', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const location = await prisma.location.create({
    data: { name: 'Estante F', madeById: admin.id },
  });
  const soon = await prisma.reagent.create({
    data: { name: 'Caduca pronto', casNumber: '67-64-1', madeById: admin.id },
  });
  const later = await prisma.reagent.create({
    data: { name: 'Caduca tarde', casNumber: '7647-01-0', madeById: admin.id },
  });
  await prisma.reagentBatch.createMany({
    data: [
      {
        reagentId: soon.id, locationId: location.id, lotNumber: 'S-1',
        entryDate: new Date('2026-01-01T00:00:00.000Z'),
        expirationDate: new Date('2026-09-01T00:00:00.000Z'),
        initialStock: '10', currentStock: '10', unit: 'L', madeById: admin.id,
      },
      {
        reagentId: later.id, locationId: location.id, lotNumber: 'L-1',
        entryDate: new Date('2026-01-01T00:00:00.000Z'),
        expirationDate: new Date('2027-09-01T00:00:00.000Z'),
        initialStock: '10', currentStock: '10', unit: 'L', madeById: admin.id,
      },
    ],
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?expiringBefore=2026-12-31')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ReagentDto>>(response);
  expect(page.data.map((r) => r.name)).toEqual(['Caduca pronto']);
});

it('filters to reagents holding a batch at or below the given stock', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const location = await prisma.location.create({
    data: { name: 'Estante G', madeById: admin.id },
  });
  const low = await prisma.reagent.create({
    data: { name: 'Queda poco', casNumber: '67-64-1', madeById: admin.id },
  });
  const plenty = await prisma.reagent.create({
    data: { name: 'Queda mucho', casNumber: '7647-01-0', madeById: admin.id },
  });
  await prisma.reagentBatch.createMany({
    data: [
      {
        reagentId: low.id, locationId: location.id, lotNumber: 'P-1',
        entryDate: new Date('2026-01-01T00:00:00.000Z'),
        initialStock: '100', currentStock: '2.5000', unit: 'L', madeById: admin.id,
      },
      {
        reagentId: plenty.id, locationId: location.id, lotNumber: 'M-1',
        entryDate: new Date('2026-01-01T00:00:00.000Z'),
        initialStock: '100', currentStock: '80.0000', unit: 'L', madeById: admin.id,
      },
    ],
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?lowStock=5')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ReagentDto>>(response);
  expect(page.data.map((r) => r.name)).toEqual(['Queda poco']);
});

it('rejects a lowStock that is not a decimal string', async () => {
  const token = await tokenFor('admin');
  await request(app.getHttpServer())
    .get('/reagents?lowStock=mucho')
    .set('Authorization', `Bearer ${token}`)
    .expect(400);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- reagents`
Expected: the first two FAIL — `forbidNonWhitelisted` rejects the unknown query parameter, so the request returns **400** where the test expects 200. That is the correct failure: the DTO does not declare these fields yet.

- [ ] **Step 3: Declare the two filters**

In `apps/api/src/reagents/dto/list-reagents-query.dto.ts`, add to the class:

```ts
  @IsOptional()
  @IsDateString()
  expiringBefore?: string;

  // A decimal string for the same reason quantities are: the threshold is
  // compared against Decimal(12,4) values, and routing it through a JS number
  // would round the boundary before the database ever sees it.
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,4})?$/, {
    message: 'lowStock must be a positive decimal with up to 4 decimal places',
  })
  lowStock?: string;
```

and extend the imports from `class-validator` to include `IsDateString` and `Matches`.

- [ ] **Step 4: Add the clauses**

In `apps/api/src/reagents/reagent-ids.query.ts`, inside `buildReagentWhere`, after the `locationId` branch:

```ts
  // Both of these ask about a reagent's *batches*, so they are `some` clauses
  // over active batches — a reagent qualifies when at least one batch does.
  // They are separate `some` clauses on purpose: combining them into one would
  // demand a single batch that is both expiring and low, which is a narrower
  // question than either filter asks.
  if (query.expiringBefore) {
    where.batches = {
      ...(where.batches ?? {}),
      some: {
        ...(where.batches?.some ?? {}),
        active: true,
        expirationDate: { not: null, lte: new Date(query.expiringBefore) },
      },
    };
  }
  if (query.lowStock) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      { batches: { some: { active: true, currentStock: { lte: query.lowStock } } } },
    ];
  }
```

`lowStock` goes into `AND` rather than merging into `where.batches` precisely so it cannot collapse into the same `some` as `expiringBefore` or `locationId`.

- [ ] **Step 5: Run the tests**

Run: `npm run test:e2e -w apps/api -- reagents`
Expected: PASS, including the 400 test — `@Matches` rejects `mucho`.

- [ ] **Step 6: Verify the filters compose**

Add one more test that pins the composition, then run again:

```ts
it('combines lowStock with a name filter rather than replacing it', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const location = await prisma.location.create({
    data: { name: 'Estante H', madeById: admin.id },
  });
  const match = await prisma.reagent.create({
    data: { name: 'Acetona', casNumber: '67-64-1', madeById: admin.id },
  });
  const otherLowStock = await prisma.reagent.create({
    data: { name: 'Etanol', casNumber: '64-17-5', madeById: admin.id },
  });
  await prisma.reagentBatch.createMany({
    data: [
      {
        reagentId: match.id, locationId: location.id, lotNumber: 'A-1',
        entryDate: new Date('2026-01-01T00:00:00.000Z'),
        initialStock: '100', currentStock: '1.0000', unit: 'L', madeById: admin.id,
      },
      {
        reagentId: otherLowStock.id, locationId: location.id, lotNumber: 'E-1',
        entryDate: new Date('2026-01-01T00:00:00.000Z'),
        initialStock: '100', currentStock: '1.0000', unit: 'L', madeById: admin.id,
      },
    ],
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/reagents?lowStock=5&name=aceton')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ReagentDto>>(response);
  expect(page.data.map((r) => r.name)).toEqual(['Acetona']);
});
```

Without this, an implementation that overwrote `where.AND` or dropped the name clause would pass every earlier test.

Run: `npm run test:e2e -w apps/api` — expected 66. Run `npm run build -w apps/api` — exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reagents apps/api/test/reagents.e2e-spec.ts
git commit -m "feat(api): add the expiringBefore and lowStock reagent filters"
```

---

## Task 3: Gate `GET /reagents/:id` on `active`

`reagents.service.ts`'s `findOne` uses `findUniqueOrThrow` with no `active` filter, so any authenticated user holding a reagent's UUID can still read it after deactivation. It is the same §6.1 line as `includeInactive`, drawn in a different place.

**Files:**
- Modify: `apps/api/src/reagents/reagents.service.ts`
- Modify: `apps/api/src/reagents/reagents.controller.ts`
- Test: `apps/api/test/reagents.e2e-spec.ts`

**Interfaces:**
- Consumes: `assertIncludeInactiveAllowed` is *not* reused here — the shape is different (a path, not a flag). See Step 3.
- Produces: `ReagentsService.findOne(id: string, includeInactive: boolean): Promise<ReagentDto>`.

- [ ] **Step 1: Write the failing tests**

```ts
it('hides a deactivated reagent from a non-admin who knows its id', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const reagent = await prisma.reagent.create({
    data: { name: 'Retirado', casNumber: '67-64-1', madeById: admin.id, active: false },
  });

  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .get(`/reagents/${reagent.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(404);
});

it('still shows a deactivated reagent to an admin', async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const reagent = await prisma.reagent.create({
    data: { name: 'Retirado', casNumber: '67-64-1', madeById: admin.id, active: false },
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get(`/reagents/${reagent.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(body<ReagentDto>(response).active).toBe(false);
});
```

The second test is what keeps the fix from becoming a blanket 404: an admin must still be able to inspect what was deactivated, or the audit trail is unreachable through the API.

- [ ] **Step 2: Run and watch the first fail**

Run: `npm run test:e2e -w apps/api -- reagents`
Expected: the first test FAILS with `expected 404 "Not Found", got 200 "OK"`. The second already passes — it is a guard against over-correction, not a driver.

- [ ] **Step 3: Gate the read**

In `apps/api/src/reagents/reagents.service.ts`, change `findOne`:

```ts
  // A deactivated reagent is "deleted" for everyone but an administrator
  // (spec §6.1). `findFirst` with the filter — rather than a fetch and a
  // post-hoc check — keeps the not-found and the not-visible cases on one
  // path, so neither leaks the other's existence through a different status.
  async findOne(id: string, includeInactive: boolean): Promise<ReagentDto> {
    const reagent = await this.prisma.reagent.findFirst({
      where: includeInactive ? { id } : { id, active: true },
      include: { batches: { where: { active: true } } },
    });
    if (!reagent) {
      throw new NotFoundException('Reagent not found');
    }
    return toReagentDto(reagent);
  }
```

Import `NotFoundException` from `@nestjs/common` if it is not already imported. Keep the existing `include` shape from the current implementation if it differs — read it before editing rather than trusting this snippet's relations.

- [ ] **Step 4: Pass the role from the controller**

In `apps/api/src/reagents/reagents.controller.ts`:

```ts
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ReagentDto> {
    return this.reagents.findOne(id, actor.role === 'ADMIN');
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:e2e -w apps/api` — expected 68.
Run: `npm run test -w apps/api` — the service's unit spec calls `findOne` with one argument and will fail to compile; update those call sites to pass the flag explicitly and assert both branches.
Run: `npm run build -w apps/api` — exit 0. **This is the task most likely to build-fail while tests pass**, because a mocked Prisma hides an arity change.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reagents apps/api/test/reagents.e2e-spec.ts
git commit -m "fix(api): hide deactivated reagents from non-admins on the detail route"
```

---

## Task 4: Close the two web test gaps

Two Phase 2 fixes rest on nothing. The Spanish locale is configuration only — no test provides `LOCALE_ID`, so the suite runs under en-US and deleting either line in `app.config.ts` would go unnoticed. And the expiry assertion is one-sided (`not.toBe('expired')`), so it would also pass against an implementation that never returns `'expired'` at all.

**Files:**
- Modify: `apps/web/src/app/features/reagents/reagents.component.spec.ts`

**Interfaces:**
- Consumes: `ReagentsComponent`, and `expiryWarningDays: 30` from `features/reagents/i18n.es.ts`.

- [ ] **Step 1: Write the locale test**

In `reagents.component.spec.ts`, inside the existing `describe`, adding `LOCALE_ID` to the TestBed providers exactly as `app.config.ts` provides it:

```ts
it('renders dates in Spanish day/month order, not the en-US default', () => {
  // The app provides LOCALE_ID at the root; the TestBed does not inherit
  // that, so it is provided here the same way. Without this test the locale
  // registration in app.config.ts is unverified: the suite would keep
  // passing if someone deleted it, and the failure would first appear to a
  // user reading 9/10/26 as 9 October on an expiry column.
  TestBed.resetTestingModule();
  registerLocaleData(localeEs);
  TestBed.configureTestingModule({
    imports: [ReagentsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LOCALE_ID, useValue: 'es' },
    ],
  });

  const fixture = TestBed.createComponent(ReagentsComponent);
  // ... drive the fixture with a reagent holding one batch whose entryDate is
  // 2026-08-01T00:00:00.000Z, following the arrangement the existing
  // stock-column test already uses in this file.
  fixture.detectChanges();

  const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
  expect(text).toContain('1/8/26');
  expect(text).not.toContain('8/1/26');
});
```

Read the existing `stockByUnit` test in this file and mirror its arrangement for the fixture data rather than inventing a new one — the harness is already there.

- [ ] **Step 2: Run and confirm it passes for the right reason**

Run: `npm run test -w apps/web`
Expected: PASS. Then **prove it is not vacuous**: temporarily change the provider to `{ provide: LOCALE_ID, useValue: 'en-US' }`, re-run, and confirm the test FAILS on `expect(text).toContain('1/8/26')`. Restore `'es'`.

A test that passes under both locales is testing nothing; if it does, the component is not rendering the date you think it is.

- [ ] **Step 3: Write the expiry boundary tests**

```ts
it('marks a lot as expired the day after its expiration date', () => {
  vi.setSystemTime(new Date('2026-09-11T00:05:00.000Z'));
  const status = componentUnderTest.expiryStatus({
    ...batchFixture,
    expirationDate: '2026-09-10T00:00:00.000Z',
  });
  expect(status).toBe('expired');
});

it('warns exactly at the 30-day threshold and not a day earlier', () => {
  vi.setSystemTime(new Date('2026-08-11T00:00:00.000Z'));
  expect(
    componentUnderTest.expiryStatus({
      ...batchFixture,
      expirationDate: '2026-09-10T00:00:00.000Z',
    }),
  ).toBe('warning');

  vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
  expect(
    componentUnderTest.expiryStatus({
      ...batchFixture,
      expirationDate: '2026-09-10T00:00:00.000Z',
    }),
  ).toBe('ok');
});
```

Use `vi.useFakeTimers()` in a `beforeEach` and `vi.useRealTimers()` in an `afterEach` for this block. `batchFixture` is a local `ReagentBatchDto` constant — declare it in the spec with every required field, reusing the shape the existing tests already build.

The second test is the one that matters: it pins **both** sides of the boundary, so an off-by-one in the threshold arithmetic fails rather than sliding.

- [ ] **Step 4: Run and verify they are not vacuous**

Run: `npm run test -w apps/web` — expected PASS.

Then mutate `expiryWarningDays` from `30` to `31` in `features/reagents/i18n.es.ts`, re-run, and confirm the boundary test FAILS. Restore it. If it still passes, the component is not reading the threshold from the dictionary and that is the real finding.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/reagents/reagents.component.spec.ts
git commit -m "test(web): pin the Spanish locale and both sides of the expiry threshold"
```

---

## Task 5: Shared consumption types

Every later task depends on these names. They live in `packages/shared` so the API's DTOs and the client's stores describe the same contract, and a rename breaks compilation on both sides at once instead of at runtime on one.

**Files:**
- Create: `packages/shared/src/consumption.ts`
- Create: `packages/shared/src/consumption.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Unit` from `./inventory`.
- Produces: `ConsumptionDto`, `CreateConsumptionRequest`, `VoidConsumptionRequest`, `ConsumptionFilters`, `CONSUMPTION_SORT_COLUMNS`, `isConsumptionSortColumn`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/consumption.spec.ts`:

```ts
import { CONSUMPTION_SORT_COLUMNS, isConsumptionSortColumn } from './consumption';

describe('CONSUMPTION_SORT_COLUMNS', () => {
  it('accepts the columns the list endpoint may sort by', () => {
    expect(isConsumptionSortColumn('consumedAt')).toBe(true);
    expect(isConsumptionSortColumn('quantity')).toBe(true);
  });

  it('rejects anything outside the whitelist, which is what keeps orderBy from becoming an injection route', () => {
    expect(isConsumptionSortColumn('id; DROP TABLE "Consumption"')).toBe(false);
    expect(isConsumptionSortColumn('voidReason')).toBe(false);
  });

  it('lists exactly the two sortable columns', () => {
    expect([...CONSUMPTION_SORT_COLUMNS]).toEqual(['consumedAt', 'quantity']);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w packages/shared`
Expected: FAIL — `Cannot find module './consumption'`.

- [ ] **Step 3: Write the types**

Create `packages/shared/src/consumption.ts`:

```ts
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
```

- [ ] **Step 4: Export and verify**

Add `export * from './consumption';` to `packages/shared/src/index.ts`.

Run: `npm run test -w packages/shared` — expected PASS.
Run: `npm run build -w apps/api` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add the consumption contract"
```

---

## Task 6: The consumption mapper

One place turns a Prisma row into a `ConsumptionDto`. It is separate from the service because the create, list and void paths all produce the same shape, and three hand-written literals would drift.

**Files:**
- Create: `apps/api/src/common/mappers/consumption.mapper.ts`
- Create: `apps/api/src/common/mappers/consumption.mapper.spec.ts`

**Interfaces:**
- Consumes: `ConsumptionDto` from `@labtrack/shared`.
- Produces: `toConsumptionDto(row: ConsumptionWithRelations): ConsumptionDto` and the exported type `ConsumptionWithRelations`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/common/mappers/consumption.mapper.spec.ts`:

```ts
import { Prisma } from '../../prisma/client';
import { toConsumptionDto } from './consumption.mapper';

function row() {
  return {
    id: 'c1',
    batchId: 'b1',
    // Prisma 7 generates TypeScript source with no `runtime/` directory, so
    // Decimal comes off the Prisma namespace, not a runtime subpath.
    quantity: new Prisma.Decimal('0.3000'),
    consumedAt: new Date('2026-08-01T10:00:00.000Z'),
    purpose: 'Práctica de titulación',
    active: true,
    voidReason: null,
    voidedAt: null,
    voidedById: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    madeById: 'u1',
    batch: {
      lotNumber: 'L-1',
      unit: 'ML' as const,
      reagentId: 'r1',
      reagent: { name: 'Acetona' },
    },
    madeBy: { fullName: 'Ana Ruiz' },
    voidedBy: null,
  };
}

describe('toConsumptionDto', () => {
  it('keeps the quantity a string, never a number', () => {
    const dto = toConsumptionDto(row());
    expect(dto.quantity).toBe('0.3');
    expect(typeof dto.quantity).toBe('string');
  });

  it('carries the unit down from the batch, because consumption never converts', () => {
    expect(toConsumptionDto(row()).unit).toBe('ML');
  });

  it('reports a void with its reason, actor and timestamp', () => {
    const voided = {
      ...row(),
      active: false,
      voidReason: 'Registrado por error',
      voidedAt: new Date('2026-08-02T09:00:00.000Z'),
      voidedById: 'u2',
      voidedBy: { fullName: 'Carlos Díaz' },
    };
    const dto = toConsumptionDto(voided);
    expect(dto.active).toBe(false);
    expect(dto.voidReason).toBe('Registrado por error');
    expect(dto.voidedByName).toBe('Carlos Díaz');
    expect(dto.voidedAt).toBe('2026-08-02T09:00:00.000Z');
  });

  it('leaves the void fields null on a live consumption', () => {
    const dto = toConsumptionDto(row());
    expect(dto.voidReason).toBeNull();
    expect(dto.voidedByName).toBeNull();
    expect(dto.voidedAt).toBeNull();
  });
});
```

**The mapper must stay strict.** If a fixture does not satisfy its type, fix the fixture — never widen the mapper with `?.` and a fallback to accommodate a thin mock. That exact trade was made and reverted in Phase 2.

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w apps/api -- consumption.mapper`
Expected: FAIL — `Cannot find module './consumption.mapper'`.

- [ ] **Step 3: Write the mapper**

Create `apps/api/src/common/mappers/consumption.mapper.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -w apps/api -- consumption.mapper` — expected PASS, 4 tests.
Run: `npm run build -w apps/api` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/mappers
git commit -m "feat(api): add the consumption mapper"
```

---

## Task 7: Record a consumption

The heart of the phase. Spec §4.2: recording is a transaction that validates `quantity <= currentStock`, inserts the `Consumption` and decrements the batch. Under a weaker isolation level two concurrent requests can both read a stock that permits the write and both proceed, overdrawing the batch — which is why `runInTransaction` defaults to Serializable.

**Files:**
- Create: `apps/api/src/consumptions/consumptions.module.ts`
- Create: `apps/api/src/consumptions/consumptions.controller.ts`
- Create: `apps/api/src/consumptions/consumptions.service.ts`
- Create: `apps/api/src/consumptions/dto/create-consumption.dto.ts`
- Create: `apps/api/test/consumptions.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `runInTransaction(prisma, fn, options)` and `TransactionClient` from `apps/api/src/common/prisma/transaction.ts`; `toConsumptionDto` from Task 6.
- Produces: `ConsumptionsService.create(dto: CreateConsumptionDto, actorId: string): Promise<ConsumptionDto>`, and the module-level `WITH_RELATIONS` include shape reused by Tasks 8 and 9.

- [ ] **Step 1: Write the failing e2e tests**

Create `apps/api/test/consumptions.e2e-spec.ts`. Follow the arrangement in `batches.e2e-spec.ts` for `beforeAll`/`beforeEach`/`tokenFor` — read that file and mirror it, truncating `"Consumption", "ReagentBatch", "Reagent", "Location", "User"`. Seed an `admin` (ADMIN, fullName `Admin`) and `ana` (USER, fullName `Ana Ruiz`), a location, a reagent, and one batch with `initialStock: '100.0000'`, `currentStock: '100.0000'`, `unit: 'ML'`, exposing its id as `batchId`.

```ts
it('records a consumption and decrements the batch in the same transaction', async () => {
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .post('/consumptions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      batchId,
      quantity: '0.3000',
      consumedAt: '2026-08-01T10:00:00.000Z',
      purpose: 'Práctica de titulación',
    })
    .expect(201);

  const dto = body<ConsumptionDto>(response);
  expect(dto.quantity).toBe('0.3');
  expect(dto.unit).toBe('ML');
  expect(dto.madeByName).toBe('Ana Ruiz');

  const batch = await prisma.reagentBatch.findUniqueOrThrow({ where: { id: batchId } });
  // The database does the arithmetic, so this would fail against a Float
  // column: 100 - 0.3 in binary floating point is not exactly 99.7.
  expect(batch.currentStock.toString()).toBe('99.7');
});

it('rejects a quantity greater than the batch stock and leaves the stock untouched', async () => {
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .post('/consumptions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      batchId,
      quantity: '100.0001',
      consumedAt: '2026-08-01T10:00:00.000Z',
      purpose: 'Demasiado',
    })
    .expect(400);

  const batch = await prisma.reagentBatch.findUniqueOrThrow({ where: { id: batchId } });
  expect(batch.currentStock.toString()).toBe('100');
  expect(await prisma.consumption.count()).toBe(0);
});

it('allows consuming exactly the remaining stock', async () => {
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .post('/consumptions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      batchId,
      quantity: '100.0000',
      consumedAt: '2026-08-01T10:00:00.000Z',
      purpose: 'Todo',
    })
    .expect(201);

  const batch = await prisma.reagentBatch.findUniqueOrThrow({ where: { id: batchId } });
  expect(batch.currentStock.toString()).toBe('0');
});

it('refuses to consume from an inactive batch', async () => {
  await prisma.reagentBatch.update({ where: { id: batchId }, data: { active: false } });
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .post('/consumptions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      batchId,
      quantity: '1',
      consumedAt: '2026-08-01T10:00:00.000Z',
      purpose: 'Lote retirado',
    })
    .expect(400);
});

it('rejects a numeric quantity rather than coercing it to a string', async () => {
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .post('/consumptions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      batchId,
      quantity: 0.3,
      consumedAt: '2026-08-01T10:00:00.000Z',
      purpose: 'Número',
    })
    .expect(400);
});

it('rejects a blank purpose, because a consumption with no traceable reason is what this system exists to prevent', async () => {
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .post('/consumptions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      batchId,
      quantity: '1',
      consumedAt: '2026-08-01T10:00:00.000Z',
      purpose: '   ',
    })
    .expect(400);
});
```

The stock assertion after each rejection is the point: a test that only checks the status code would pass against an implementation that decremented first and threw afterwards.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- consumptions`
Expected: all FAIL with 404 — the route does not exist.

- [ ] **Step 3: Write the DTO**

Create `apps/api/src/consumptions/dto/create-consumption.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateConsumptionDto {
  @IsUUID()
  batchId!: string;

  // A decimal string, not a number. Without implicit conversion the pipe
  // leaves the body's types alone, so a numeric quantity reaches `@Matches`
  // still a number and is rejected instead of being silently stringified.
  @Matches(/^\d{1,8}(\.\d{1,4})?$/, {
    message: 'quantity must be a positive decimal with up to 4 decimal places',
  })
  quantity!: string;

  @IsDateString()
  consumedAt!: string;

  // Trimmed before validation so a purpose of only spaces fails `@IsNotEmpty`
  // rather than being stored as blank.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  purpose!: string;
}
```

- [ ] **Step 4: Write the service**

Create `apps/api/src/consumptions/consumptions.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsumptionDto } from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { runInTransaction } from '../common/prisma/transaction';
import { toConsumptionDto } from '../common/mappers/consumption.mapper';
import { CreateConsumptionDto } from './dto/create-consumption.dto';

// Shared by create, list and void so all three produce the exact shape the
// mapper's type demands.
const WITH_RELATIONS = {
  batch: {
    select: {
      lotNumber: true,
      unit: true,
      reagentId: true,
      reagent: { select: { name: true } },
    },
  },
  madeBy: { select: { fullName: true } },
  voidedBy: { select: { fullName: true } },
} as const;

@Injectable()
export class ConsumptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateConsumptionDto,
    actorId: string,
  ): Promise<ConsumptionDto> {
    // Read-then-write: the stock check and the decrement must see the same
    // state, or two concurrent requests can each read a stock that permits
    // their own write and together overdraw the batch. runInTransaction
    // defaults to Serializable for exactly this shape.
    return runInTransaction(this.prisma, async (tx) => {
      const batch = await tx.reagentBatch.findUnique({
        where: { id: dto.batchId },
      });
      if (!batch || !batch.active) {
        throw new BadRequestException('Cannot consume from an inactive batch');
      }

      // Decimal comparison, not a JS number comparison: parsing either side
      // into a float would let a quantity a hair over the stock slip through
      // at the boundary.
      if (batch.currentStock.lessThan(dto.quantity)) {
        throw new BadRequestException(
          'quantity exceeds the current stock of this batch',
        );
      }

      const consumption = await tx.consumption.create({
        data: {
          batchId: dto.batchId,
          quantity: dto.quantity,
          consumedAt: new Date(dto.consumedAt),
          purpose: dto.purpose,
          madeById: actorId,
        },
        include: WITH_RELATIONS,
      });

      // `decrement` so the arithmetic happens in Postgres on the numeric
      // column. Computing the new value in Node would route a Decimal through
      // a JS number and lose the precision the column exists for.
      await tx.reagentBatch.update({
        where: { id: dto.batchId },
        data: { currentStock: { decrement: dto.quantity } },
      });

      return toConsumptionDto(consumption);
    });
  }
}
```

- [ ] **Step 5: Write the controller and module**

Create `apps/api/src/consumptions/consumptions.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ConsumptionDto } from '@labtrack/shared';
import { ConsumptionsService } from './consumptions.service';
import { CreateConsumptionDto } from './dto/create-consumption.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('consumptions')
export class ConsumptionsController {
  constructor(private readonly consumptions: ConsumptionsService) {}

  // Any authenticated user records consumption: that is the daily work of the
  // lab. Only voiding is restricted.
  @Post()
  create(
    @Body() dto: CreateConsumptionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConsumptionDto> {
    return this.consumptions.create(dto, actor.id);
  }
}
```

Create `apps/api/src/consumptions/consumptions.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConsumptionsController } from './consumptions.controller';
import { ConsumptionsService } from './consumptions.service';

@Module({
  controllers: [ConsumptionsController],
  providers: [ConsumptionsService],
})
export class ConsumptionsModule {}
```

Register `ConsumptionsModule` in `apps/api/src/app.module.ts` alongside the other feature modules.

- [ ] **Step 6: Run the tests**

Run: `npm run test:e2e -w apps/api -- consumptions` — expected PASS, 6 tests.
Run: `npm run test:e2e -w apps/api` — full suite green.
Run: `npm run build -w apps/api` — exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/consumptions apps/api/src/app.module.ts apps/api/test/consumptions.e2e-spec.ts
git commit -m "feat(api): record consumptions transactionally against batch stock"
```

---

## Task 8: List consumptions

Spec §6.3: descending by `consumedAt` by default, filters by `reagentId`, `batchId`, `madeById`, a date range and a partial `purpose`. Voided consumptions are excluded unless an ADMIN asks for `includeVoided` — the same shape as `includeInactive`, and it gets the same server-side gate.

**Files:**
- Create: `apps/api/src/consumptions/dto/list-consumptions-query.dto.ts`
- Modify: `apps/api/src/consumptions/consumptions.service.ts`
- Modify: `apps/api/src/consumptions/consumptions.controller.ts`
- Test: `apps/api/test/consumptions.e2e-spec.ts`

**Interfaces:**
- Consumes: `PaginationQueryDto` from `apps/api/src/common/dto/pagination-query.dto.ts`; `CONSUMPTION_SORT_COLUMNS` from Task 5; `WITH_RELATIONS` from Task 7.
- Produces: `ConsumptionsService.list(query: ListConsumptionsQueryDto): Promise<PaginatedResponse<ConsumptionDto>>`.

- [ ] **Step 1: Write the failing e2e tests**

Write a local `seedConsumptions()` helper in the spec that inserts three consumptions against the seeded batch with `consumedAt` of `2026-08-01`, `2026-08-02`, `2026-08-03` and purposes `Primero`, `Segundo`, `Tercero`. **Insert them out of chronological order** so the descending assertion cannot pass by insertion order alone.

```ts
it('returns consumptions newest first by default', async () => {
  await seedConsumptions();
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ConsumptionDto>>(response);
  expect(page.data.map((c) => c.purpose)).toEqual(['Tercero', 'Segundo', 'Primero']);
});

it('excludes voided consumptions from a normal listing', async () => {
  await seedConsumptions();
  const first = await prisma.consumption.findFirstOrThrow({ where: { purpose: 'Primero' } });
  await prisma.consumption.update({
    where: { id: first.id },
    data: { active: false, voidReason: 'Error', voidedAt: new Date() },
  });

  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ConsumptionDto>>(response);
  expect(page.data.map((c) => c.purpose)).toEqual(['Tercero', 'Segundo']);
  expect(page.total).toBe(2);
});

it('lets an admin see voided consumptions with includeVoided', async () => {
  await seedConsumptions();
  const first = await prisma.consumption.findFirstOrThrow({ where: { purpose: 'Primero' } });
  await prisma.consumption.update({
    where: { id: first.id },
    data: { active: false, voidReason: 'Error', voidedAt: new Date() },
  });

  const token = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .get('/consumptions?includeVoided=true')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(body<PaginatedResponse<ConsumptionDto>>(response).total).toBe(3);
});

it('refuses includeVoided for a non-admin', async () => {
  const token = await tokenFor('ana');
  await request(app.getHttpServer())
    .get('/consumptions?includeVoided=true')
    .set('Authorization', `Bearer ${token}`)
    .expect(403);
});

it('filters by a date range on consumedAt', async () => {
  await seedConsumptions();
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions?from=2026-08-02T00:00:00.000Z&to=2026-08-02T23:59:59.999Z')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ConsumptionDto>>(response);
  expect(page.data.map((c) => c.purpose)).toEqual(['Segundo']);
});

it('filters by a partial purpose, case-insensitively', async () => {
  await seedConsumptions();
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get('/consumptions?purpose=terc')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const page = body<PaginatedResponse<ConsumptionDto>>(response);
  expect(page.data.map((c) => c.purpose)).toEqual(['Tercero']);
});

it('filters by reagent across all of that reagent batches', async () => {
  await seedConsumptions();
  const token = await tokenFor('ana');
  const response = await request(app.getHttpServer())
    .get(`/consumptions?reagentId=${reagentId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(body<PaginatedResponse<ConsumptionDto>>(response).total).toBe(3);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- consumptions`
Expected: FAIL with 404 — `GET /consumptions` does not exist.

- [ ] **Step 3: Write the query DTO**

Create `apps/api/src/consumptions/dto/list-consumptions-query.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CONSUMPTION_SORT_COLUMNS } from '@labtrack/shared';
import type { ConsumptionSortColumn } from '@labtrack/shared';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListConsumptionsQueryDto extends PaginationQueryDto {
  // Spec §6.3: newest first is the default, because the question this screen
  // answers is almost always "what happened recently". PaginationQueryDto
  // already defaults sortOrder to 'desc'.
  @IsOptional()
  @IsIn(CONSUMPTION_SORT_COLUMNS)
  sortBy: ConsumptionSortColumn = 'consumedAt';

  @IsOptional()
  @IsUUID()
  reagentId?: string;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  madeById?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeVoided?: boolean;
}
```

- [ ] **Step 4: Add `list` to the service**

Append to `ConsumptionsService`:

```ts
  async list(
    query: ListConsumptionsQueryDto,
  ): Promise<PaginatedResponse<ConsumptionDto>> {
    const where: Prisma.ConsumptionWhereInput = {};

    if (!query.includeVoided) {
      where.active = true;
    }
    if (query.batchId) {
      where.batchId = query.batchId;
    }
    if (query.reagentId) {
      // A consumption belongs to a batch, and a batch to a reagent: filtering
      // by reagent means "any of that reagent's batches".
      where.batch = { reagentId: query.reagentId };
    }
    if (query.madeById) {
      where.madeById = query.madeById;
    }
    if (query.purpose) {
      where.purpose = { contains: query.purpose, mode: 'insensitive' };
    }
    if (query.from || query.to) {
      where.consumedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    // Count and rows in one transaction with the same `where`, so the
    // paginator can never show a total that disagrees with the page. The `id`
    // tie-break makes the order deterministic when two rows share a
    // `consumedAt`, which is common when several are logged in one sitting.
    const [data, total] = await this.prisma.$transaction([
      this.prisma.consumption.findMany({
        where,
        include: WITH_RELATIONS,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.consumption.count({ where }),
    ]);

    return buildPaginatedResponse(
      data.map(toConsumptionDto),
      total,
      query.page,
      query.pageSize,
    );
  }
```

Add the imports: `PaginatedResponse` and `buildPaginatedResponse` from `@labtrack/shared`, `Prisma` from `../prisma/client`, and `ListConsumptionsQueryDto`.

- [ ] **Step 5: Wire the controller with the role gate**

```ts
  @Get()
  list(
    @Query() query: ListConsumptionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<ConsumptionDto>> {
    // Same rule and same reason as `includeInactive` on the other list
    // endpoints (spec §6.3): a voided consumption is "deleted" for everyone
    // but an administrator, so the flag is gated server-side rather than by
    // hiding a checkbox.
    assertIncludeInactiveAllowed(query.includeVoided, actor.role);
    return this.consumptions.list(query);
  }
```

Import `Get`, `Query` from `@nestjs/common` and `assertIncludeInactiveAllowed` from `../common/authorization/assert-include-inactive-allowed`. Its parameter is named for the flag it was written for; if reusing it here reads poorly, rename that parameter to something neutral in its own file and update the three existing call sites — do not copy the function.

- [ ] **Step 6: Run the tests**

Run: `npm run test:e2e -w apps/api` — expected PASS.
Run: `npm run build -w apps/api` — exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/consumptions apps/api/test/consumptions.e2e-spec.ts
git commit -m "feat(api): list consumptions newest first with filters"
```

---

## Task 9: Void a consumption

Spec §4.4: only an ADMIN may void, the justification is mandatory, the row keeps `voidReason`/`voidedById`/`voidedAt`, and the quantity returns to the batch's `currentStock` — all in one transaction. Voiding an already-voided consumption must not return the stock twice.

**Files:**
- Create: `apps/api/src/consumptions/dto/void-consumption.dto.ts`
- Modify: `apps/api/src/consumptions/consumptions.service.ts`
- Modify: `apps/api/src/consumptions/consumptions.controller.ts`
- Test: `apps/api/test/consumptions.e2e-spec.ts`

**Interfaces:**
- Consumes: `runInTransaction`, `toConsumptionDto`, `WITH_RELATIONS`.
- Produces: `ConsumptionsService.void(id: string, dto: VoidConsumptionDto, actorId: string): Promise<ConsumptionDto>`.

- [ ] **Step 1: Write the failing e2e tests**

```ts
it('returns the quantity to the batch and records who voided it and why', async () => {
  const token = await tokenFor('ana');
  const created = body<ConsumptionDto>(
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId, quantity: '0.3000', consumedAt: '2026-08-01T10:00:00.000Z', purpose: 'Prueba' })
      .expect(201),
  );

  const adminToken = await tokenFor('admin');
  const response = await request(app.getHttpServer())
    .patch(`/consumptions/${created.id}/void`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ voidReason: 'Registrado por error' })
    .expect(200);

  const dto = body<ConsumptionDto>(response);
  expect(dto.active).toBe(false);
  expect(dto.voidReason).toBe('Registrado por error');
  expect(dto.voidedByName).toBe('Admin');
  expect(dto.voidedAt).not.toBeNull();

  const batch = await prisma.reagentBatch.findUniqueOrThrow({ where: { id: batchId } });
  expect(batch.currentStock.toString()).toBe('100');
});

it('refuses to void for a non-admin, and leaves the stock consumed', async () => {
  const token = await tokenFor('ana');
  const created = body<ConsumptionDto>(
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId, quantity: '1', consumedAt: '2026-08-01T10:00:00.000Z', purpose: 'Prueba' })
      .expect(201),
  );

  await request(app.getHttpServer())
    .patch(`/consumptions/${created.id}/void`)
    .set('Authorization', `Bearer ${token}`)
    .send({ voidReason: 'Quiero anularlo' })
    .expect(403);

  const batch = await prisma.reagentBatch.findUniqueOrThrow({ where: { id: batchId } });
  expect(batch.currentStock.toString()).toBe('99');
});

it('requires a justification', async () => {
  const token = await tokenFor('ana');
  const created = body<ConsumptionDto>(
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId, quantity: '1', consumedAt: '2026-08-01T10:00:00.000Z', purpose: 'Prueba' })
      .expect(201),
  );

  const adminToken = await tokenFor('admin');
  await request(app.getHttpServer())
    .patch(`/consumptions/${created.id}/void`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ voidReason: '   ' })
    .expect(400);
});

it('does not return the stock twice when voiding an already-voided consumption', async () => {
  const token = await tokenFor('ana');
  const created = body<ConsumptionDto>(
    await request(app.getHttpServer())
      .post('/consumptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ batchId, quantity: '5', consumedAt: '2026-08-01T10:00:00.000Z', purpose: 'Prueba' })
      .expect(201),
  );

  const adminToken = await tokenFor('admin');
  await request(app.getHttpServer())
    .patch(`/consumptions/${created.id}/void`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ voidReason: 'Primera anulación' })
    .expect(200);

  await request(app.getHttpServer())
    .patch(`/consumptions/${created.id}/void`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ voidReason: 'Segunda anulación' })
    .expect(400);

  const batch = await prisma.reagentBatch.findUniqueOrThrow({ where: { id: batchId } });
  expect(batch.currentStock.toString()).toBe('100');
});
```

The last test matters most: without it, a void that blindly incremented would inflate the inventory every time an admin clicked twice, and every other test would still pass.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:e2e -w apps/api -- consumptions`
Expected: FAIL with 404 — the route does not exist.

- [ ] **Step 3: Write the DTO**

Create `apps/api/src/consumptions/dto/void-consumption.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VoidConsumptionDto {
  // Mandatory by spec §4.4: an administrator removing a record from the
  // history has to say why, and a reason of only spaces is not a reason —
  // hence the trim before `@IsNotEmpty`.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  voidReason!: string;
}
```

- [ ] **Step 4: Add `void` to the service**

```ts
  async void(
    id: string,
    dto: VoidConsumptionDto,
    actorId: string,
  ): Promise<ConsumptionDto> {
    return runInTransaction(this.prisma, async (tx) => {
      const current = await tx.consumption.findUnique({ where: { id } });
      if (!current) {
        throw new NotFoundException('Consumption not found');
      }
      // Read-then-write again, and the reason this needs the transaction as
      // much as `create` does: two concurrent voids of the same consumption
      // could each read it as active and each return the quantity, inflating
      // the batch by twice what was consumed.
      if (!current.active) {
        throw new BadRequestException('This consumption is already voided');
      }

      const consumption = await tx.consumption.update({
        where: { id },
        data: {
          active: false,
          voidReason: dto.voidReason,
          voidedById: actorId,
          voidedAt: new Date(),
        },
        include: WITH_RELATIONS,
      });

      // The exact reverse of `create`'s decrement, and in Postgres for the
      // same reason.
      await tx.reagentBatch.update({
        where: { id: current.batchId },
        data: { currentStock: { increment: current.quantity } },
      });

      return toConsumptionDto(consumption);
    });
  }
```

Import `NotFoundException` from `@nestjs/common` and `VoidConsumptionDto`.

- [ ] **Step 5: Wire the route**

```ts
  @Patch(':id/void')
  @Roles('ADMIN')
  voidConsumption(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidConsumptionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConsumptionDto> {
    return this.consumptions.void(id, dto, actor.id);
  }
```

Import `Patch`, `Param`, `ParseUUIDPipe` from `@nestjs/common` and `Roles` from `../common/decorators/roles.decorator`. The method is named `voidConsumption` because `void` is a reserved word.

- [ ] **Step 6: Run everything**

Run: `npm run test:e2e -w apps/api` — expected PASS.
Run: `npm run test -w apps/api` and `npm run build -w apps/api` — both green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/consumptions apps/api/test/consumptions.e2e-spec.ts
git commit -m "feat(api): void a consumption and return its quantity to the batch"
```

---

## Task 10: The register-consumption screen

Spec §7.2 screen 3: pick a reagent, then a batch (showing its stock and expiry), then a quantity validated against that stock, a date and a purpose. The batch step is what makes the unit unambiguous, so the reagent must be chosen first.

**Files:**
- Create: `apps/web/src/app/features/consumptions/i18n.es.ts`
- Create: `apps/web/src/app/features/consumptions/register-consumption.component.ts`
- Create: `apps/web/src/app/features/consumptions/register-consumption.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`, `apps/web/src/app/app.html`, `apps/web/src/app/features/home/home.component.ts`, `apps/web/src/app/features/home/i18n.es.ts`, `apps/web/src/app/shared/i18n/es.ts`

**Interfaces:**
- Consumes: `ApiService` (`get`, `post`) from `core/api/api.service`; `ReagentDto`, `ReagentBatchDto`, `CreateConsumptionRequest`, `ConsumptionDto` from `@labtrack/shared`.
- Produces: the `/consumos/registrar` route and `REGISTER_CONSUMPTION_ES`.

- [ ] **Step 1: Write the dictionary**

Create `apps/web/src/app/features/consumptions/i18n.es.ts`:

```ts
export const REGISTER_CONSUMPTION_ES = {
  title: 'Registrar consumo',
  reagent: 'Reactivo',
  selectReagent: 'Selecciona un reactivo',
  batch: 'Lote',
  selectBatch: 'Selecciona un lote',
  noBatches: 'Este reactivo no tiene lotes activos.',
  batchOption: (lot: string, stock: string, unit: string) =>
    `Lote ${lot} · ${stock} ${unit} disponibles`,
  expiresOn: 'Vence el',
  noExpiry: 'Sin fecha de vencimiento',
  quantity: 'Cantidad',
  consumedAt: 'Fecha del consumo',
  purpose: 'Propósito',
  submit: 'Registrar',
  exceedsStock: 'La cantidad supera las existencias del lote.',
  invalidQuantity: 'Escribe una cantidad con hasta 4 decimales.',
  success: 'Consumo registrado.',
  failure: 'No se pudo registrar el consumo.',
} as const;
```

Every string this screen shows lives here. `batchOption` is a function because the option label interleaves three values — building it in the template would put Spanish word order into the component.

- [ ] **Step 2: Write the failing component spec**

Create `register-consumption.component.spec.ts`. Mirror the harness in `features/reagents/reagents.component.spec.ts` (`provideZonelessChangeDetection`, `provideHttpClientTesting`).

```ts
it('does not offer batches until a reagent is chosen', () => {
  // The unit of a consumption comes from its batch, so offering batches
  // across reagents would let someone log 5 mL against the wrong substance.
  expect(component.batches()).toEqual([]);
  http.expectNone((r) => r.url.includes('/batches'));
});

it('loads only the active batches of the chosen reagent', () => {
  component.selectReagent('r1');
  const request = http.expectOne((r) => r.url === '/reagents/r1/batches');
  expect(request.request.params.get('includeInactive')).toBeNull();
  request.flush({ data: [batchFixture], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  expect(component.batches().map((b) => b.lotNumber)).toEqual(['L-1']);
});

it('clears the selected batch when the reagent changes', () => {
  component.selectReagent('r1');
  http.expectOne((r) => r.url === '/reagents/r1/batches')
    .flush({ data: [batchFixture], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  component.form.controls.batchId.setValue('b1');

  component.selectReagent('r2');

  // Without this, submitting after switching reagents would post a batch
  // belonging to the previous one — a consumption recorded against the wrong
  // substance, which is the worst outcome this screen can produce.
  expect(component.form.controls.batchId.value).toBe('');
});

it('rejects a quantity above the selected batch stock before sending anything', () => {
  component.selectReagent('r1');
  http.expectOne((r) => r.url === '/reagents/r1/batches')
    .flush({ data: [batchFixture], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  component.form.controls.batchId.setValue('b1');
  component.form.controls.quantity.setValue('999');

  expect(component.form.controls.quantity.hasError('exceedsStock')).toBe(true);
  component.submit();
  http.expectNone((r) => r.method === 'POST');
});

it('sends the quantity as the string the user typed, never a parsed number', () => {
  component.selectReagent('r1');
  http.expectOne((r) => r.url === '/reagents/r1/batches')
    .flush({ data: [batchFixture], total: 1, page: 1, pageSize: 100, totalPages: 1 });
  component.form.patchValue({
    batchId: 'b1',
    quantity: '0.3000',
    consumedAt: new Date('2026-08-01T00:00:00.000Z'),
    purpose: 'Práctica',
  });

  component.submit();

  const request = http.expectOne((r) => r.method === 'POST' && r.url === '/consumptions');
  // '0.3000' and not '0.3': the trailing zeros are the scale the column
  // stores, and a round trip through Number would drop them.
  expect(request.request.body.quantity).toBe('0.3000');
  expect(typeof request.request.body.quantity).toBe('string');
});
```

`batchFixture` is a local `ReagentBatchDto` constant with `id: 'b1'`, `lotNumber: 'L-1'`, `currentStock: '100.0000'`, `unit: 'ML'` and every other required field filled.

- [ ] **Step 3: Run and watch it fail**

Run: `npm run test -w apps/web`
Expected: FAIL — the component module does not exist.

- [ ] **Step 4: Write the component**

Create `register-consumption.component.ts` as a standalone `OnPush` component. Requirements the tests above pin, stated so the implementer builds to them rather than to the tests:

- A reactive form with `reagentId`, `batchId`, `quantity`, `consumedAt` and `purpose`, all required.
- `selectReagent(id)` fetches `/reagents/{id}/batches` through `ApiService` with `pageSize: 100`, stores the result in a `batches` signal, and **resets `batchId`**.
- A `selectedBatch` computed that finds the chosen batch in `batches()`.
- A synchronous validator on `quantity` that sets `exceedsStock` when the typed value exceeds `selectedBatch()!.currentStock`. Compare the two as **decimal strings** — pad both to the same scale and compare, or compare integer and fractional parts separately. Do not call `parseFloat`; that is the precision loss this whole contract exists to prevent.
- A second validator that sets `invalidQuantity` unless the value matches `/^\d{1,8}(\.\d{1,4})?$/` — the same pattern the API's DTO enforces, so the user learns of the problem before a round trip.
- `submit()` returns early unless the form is valid, then posts `CreateConsumptionRequest` with `quantity` taken **verbatim from the control**.
- On success, show `success` in a snackbar and reset the form; on error, show `failure`.
- The `consumedAt` control holds a `Date` from the Material datepicker; convert it with `.toISOString()` only at the moment of posting.

- [ ] **Step 5: Run the tests**

Run: `npm run test -w apps/web` — expected PASS.

Then prove the third test is not vacuous: delete the `batchId` reset inside `selectReagent`, re-run, and confirm it FAILS. Restore it.

- [ ] **Step 6: Wire the route and the links**

In `app.routes.ts`, alongside the existing entries:

```ts
  // Any authenticated user records consumption: it is the daily work of the
  // lab, and restricting it would defeat the traceability the system exists
  // for.
  {
    path: 'consumos/registrar',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/consumptions/register-consumption.component').then(
        (m) => m.RegisterConsumptionComponent,
      ),
  },
```

Add `registerConsumptionLink: 'Registrar consumo'` to `COMMON_ES` in `shared/i18n/es.ts`, and a link in both `app.html` and `home.component.ts` following exactly the pattern the reagents link already uses in those files. Do not rewrite what is there.

- [ ] **Step 7: Verify and commit**

Run: `npm run test -w apps/web`, then `npm run build -w apps/web` and **report the bundle size** — the budget is 500 kB and the baseline is 413.15 kB.

```bash
git add apps/web/src/app/features/consumptions apps/web/src/app/app.routes.ts apps/web/src/app/app.html apps/web/src/app/features/home apps/web/src/app/shared/i18n/es.ts
git commit -m "feat(web): add the register-consumption screen"
```

---

## Task 11: The consumptions list screen

Spec §7.2 screen 4: a descending table with filters, and voiding with a mandatory justification visible only to an ADMIN. This is the last task of the phase.

**Files:**
- Create: `apps/web/src/app/features/consumptions/consumptions.store.ts`
- Create: `apps/web/src/app/features/consumptions/consumptions.store.spec.ts`
- Create: `apps/web/src/app/features/consumptions/consumptions.component.ts`
- Create: `apps/web/src/app/features/consumptions/consumptions.component.spec.ts`
- Create: `apps/web/src/app/features/consumptions/void-consumption.dialog.ts`
- Create: `apps/web/src/app/features/consumptions/void-consumption.dialog.spec.ts`
- Modify: `apps/web/src/app/features/consumptions/i18n.es.ts`, `app.routes.ts`, `app.html`, `features/home/home.component.ts`, `features/home/i18n.es.ts`, `shared/i18n/es.ts`

**Interfaces:**
- Consumes: `PaginatedStore<T, F>` from `shared/paginated-store`; `ConsumptionDto`, `ConsumptionFilters`, `VoidConsumptionRequest` from `@labtrack/shared`.
- Produces: `ConsumptionsStore` (root-scoped) and the `/consumos` route.

### Read these before writing anything

`apps/web/src/app/shared/paginated-store.ts` and `features/reagents/reagents.store.ts`. Two things in them decide the shape of your work:

1. **`setFilters` replaces the filter object wholesale — it does not merge.** This screen has six filters. A component that calls `setFilters({ purpose })` on every keystroke silently clears the other five. Follow `ReagentsStore.applyFilters`, which reads `this.filters()` fresh and spreads.
2. **Filter values must stay primitive.** A cast at the store's serialisation boundary means the compiler no longer enforces it. `from` and `to` must be ISO **strings** in the filter object, converted from the datepicker's `Date` before they reach `setFilters`.

- [ ] **Step 1: Write the failing store spec**

Create `consumptions.store.spec.ts`:

```ts
it('omits an empty filter instead of sending it as a blank parameter', () => {
  store.setPurpose('');
  const request = http.expectOne((r) => r.url === '/consumptions');
  expect(request.request.params.has('purpose')).toBe(false);
});

it('changing one filter preserves the others', () => {
  store.setReagentId('r1');
  http.expectOne((r) => r.url === '/consumptions').flush(emptyPage);
  store.setPurpose('titulación');

  const request = http.expectOne((r) => r.url === '/consumptions');
  expect(request.request.params.get('reagentId')).toBe('r1');
  expect(request.request.params.get('purpose')).toBe('titulación');
});

it('sends the date range as ISO strings, not Date objects', () => {
  store.setDateRange(new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-31T00:00:00.000Z'));
  const request = http.expectOne((r) => r.url === '/consumptions');
  // A Date in the filter object would compile — the store's serialisation
  // boundary is cast — and then serialize as a locale-dependent string the
  // API rejects.
  expect(request.request.params.get('from')).toBe('2026-08-01T00:00:00.000Z');
  expect(request.request.params.get('to')).toBe('2026-08-31T00:00:00.000Z');
});

it('returns to page 1 when a filter changes', () => {
  store.setPage(3);
  http.expectOne((r) => r.url === '/consumptions').flush(emptyPage);
  store.setPurpose('algo');

  const request = http.expectOne((r) => r.url === '/consumptions');
  expect(request.request.params.get('page')).toBe('1');
});

it('debounces the purpose search by 300ms while leaving other filters intact', fakeAsync(() => {
  store.setReagentId('r1');
  http.expectOne((r) => r.url === '/consumptions').flush(emptyPage);

  store.setPurpose('ti');
  store.setPurpose('titu');
  http.expectNone((r) => r.url === '/consumptions');

  tick(300);
  const request = http.expectOne((r) => r.url === '/consumptions');
  expect(request.request.params.get('purpose')).toBe('titu');
  expect(request.request.params.get('reagentId')).toBe('r1');
}));
```

The `reagentId` assertion inside the debounce test is deliberate: it is the one that fails if the debounced path captures a stale filter snapshot instead of reading fresh.

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test -w apps/web`
Expected: FAIL — `Cannot find module './consumptions.store'`.

- [ ] **Step 3: Write the store**

```ts
import { Injectable, computed } from '@angular/core';
import { Observable, Subject, debounceTime, tap } from 'rxjs';
import { ConsumptionDto, VoidConsumptionRequest } from '@labtrack/shared';
import { PaginatedStore } from '../../shared/paginated-store';

// Every value primitive: the store's serialisation boundary is cast, so a
// Date or a nested object here would compile and fail at runtime.
interface ConsumptionsFilters {
  reagentId?: string;
  purpose?: string;
  from?: string;
  to?: string;
  madeById?: string;
  includeVoided?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConsumptionsStore extends PaginatedStore<ConsumptionDto, ConsumptionsFilters> {
  protected readonly path = '/consumptions';

  readonly consumptions = this.items;
  readonly purposeFilter = computed(() => this.filters().purpose ?? '');
  readonly reagentIdFilter = computed(() => this.filters().reagentId ?? '');

  private readonly purposeInput$ = new Subject<string>();

  constructor() {
    super();
    this.purposeInput$.pipe(debounceTime(300)).subscribe((purpose) => {
      this.applyFilters({ purpose: purpose || undefined });
    });
  }

  setPurpose(purpose: string): void {
    this.purposeInput$.next(purpose);
  }

  setReagentId(reagentId: string): void {
    this.applyFilters({ reagentId: reagentId || undefined });
  }

  setMadeById(madeById: string): void {
    this.applyFilters({ madeById: madeById || undefined });
  }

  setIncludeVoided(includeVoided: boolean): void {
    this.applyFilters({ includeVoided: includeVoided || undefined });
  }

  // Converted here rather than in the component so no Date can reach the
  // filter object by another route.
  setDateRange(from: Date | null, to: Date | null): void {
    this.applyFilters({
      from: from ? from.toISOString() : undefined,
      to: to ? to.toISOString() : undefined,
    });
  }

  // setFilters replaces the whole object rather than merging, so every call
  // folds the patch into the *current* filters, read fresh rather than
  // captured in a closure.
  private applyFilters(patch: Partial<ConsumptionsFilters>): void {
    this.setFilters({ ...this.filters(), ...patch });
  }

  voidConsumption(id: string, request: VoidConsumptionRequest): Observable<ConsumptionDto> {
    return this.api
      .patch<ConsumptionDto>(`/consumptions/${id}/void`, request)
      .pipe(tap(() => this.reload()));
  }
}
```

- [ ] **Step 4: Extend the dictionary**

Append to `features/consumptions/i18n.es.ts`:

```ts
export const CONSUMPTIONS_ES = {
  title: 'Consumos',
  columns: {
    consumedAt: 'Fecha',
    reagent: 'Reactivo',
    lotNumber: 'Lote',
    quantity: 'Cantidad',
    purpose: 'Propósito',
    madeBy: 'Registrado por',
    status: 'Estado',
    actions: 'Acciones',
  },
  filters: {
    purpose: 'Propósito',
    reagent: 'Reactivo',
    allReagents: 'Todos los reactivos',
    from: 'Desde',
    to: 'Hasta',
    includeVoided: 'Incluir anulados',
  },
  status: { active: 'Vigente', voided: 'Anulado' },
  voidedBy: (name: string, reason: string) => `Anulado por ${name}: ${reason}`,
  voidAction: 'Anular',
  empty: 'No hay consumos que coincidan con los filtros.',
  loadFailed: 'No se pudieron cargar los consumos.',
} as const;

export const VOID_CONSUMPTION_ES = {
  title: 'Anular consumo',
  explanation:
    'La cantidad volverá a las existencias del lote y el consumo quedará marcado como anulado. Esta acción queda registrada con tu usuario.',
  reason: 'Justificación',
  reasonRequired: 'La justificación es obligatoria.',
  confirm: 'Anular',
  failure: 'No se pudo anular el consumo.',
} as const;
```

- [ ] **Step 5: Write the void dialog and its spec**

`void-consumption.dialog.ts`: a standalone `OnPush` dialog taking the `ConsumptionDto` via `MAT_DIALOG_DATA`, with one required `voidReason` control (`Validators.required` plus a non-whitespace check), and a confirm that closes with `{ voidReason }` only when valid.

Its spec must cover:

```ts
it('does not close when the reason is only whitespace', () => {
  component.form.controls.voidReason.setValue('   ');
  component.confirm();
  expect(dialogRef.close).not.toHaveBeenCalled();
});

it('closes with the trimmed reason', () => {
  component.form.controls.voidReason.setValue('  Registrado por error  ');
  component.confirm();
  expect(dialogRef.close).toHaveBeenCalledWith({ voidReason: 'Registrado por error' });
});
```

The whitespace test is the one that matters: the API rejects a blank reason with a 400, and without this the user would only find out after a round trip.

- [ ] **Step 6: Write the list component and its spec**

`consumptions.component.ts`: an `OnPush` standalone component with a Material table over `store.consumptions()`, a filter panel wired to the store's setters, a paginator, and the void button.

The component spec must pin these three, each of which fails against a plausible wrong implementation:

```ts
it('renders the quantity with its unit so a number is never read out of context', () => {
  // Spec §4.1: consumption never converts units, so a bare "5" on screen is
  // ambiguous between 5 mL and 5 L.
  expect(text).toContain('0.3 ML');
});

it('hides the void action from a non-admin', () => {
  // Server-side RolesGuard is the real enforcement; this only checks the
  // affordance is not offered.
  expect(text).not.toContain(CONSUMPTIONS_ES.voidAction);
});

it('shows who voided a consumption and why, not just that it is voided', () => {
  expect(text).toContain('Anulado por Carlos Díaz: Registrado por error');
});
```

- [ ] **Step 7: Wire the route and links**

```ts
  {
    path: 'consumos',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/consumptions/consumptions.component').then(
        (m) => m.ConsumptionsComponent,
      ),
  },
```

Add `consumptionsLink: 'Consumos'` to `COMMON_ES` and place the link in `app.html` and `home.component.ts` following the existing pattern.

- [ ] **Step 8: Verify**

Run each and report the number:
- `npm run test -w apps/web`
- `npm run build -w apps/web` — **report the bundle size**; budget 500 kB
- `npm run test -w apps/api`, `npm run test:e2e -w apps/api`, `npm run lint -w apps/api`
- `git status --short` empty after committing

- [ ] **Step 9: Manual walkthrough**

Start the API (`npm run start:dev -w apps/api`) and the client (`npm start -w apps/web`), then walk this and **report what you actually observe, including anything that does not work**:

1. Log in as admin, create a reagent with a batch of `100 ML`.
2. Register a consumption of `0.3` against it → the reagents screen shows `99.7 ML`, not `99.69999...`.
3. Try to consume `999` → blocked in the form, with no request sent.
4. Open `/consumos` → the consumption appears, newest first, with its unit.
5. Filter by a partial purpose and by a date range.
6. Void it with a justification → it leaves the default listing, the batch returns to `100 ML`, and with "incluir anulados" it reappears showing who voided it and why.
7. Log in as a non-admin → `/consumos` and `/consumos/registrar` both work, but no void button appears.

Shut both servers down afterwards.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app/features/consumptions apps/web/src/app/app.routes.ts apps/web/src/app/app.html apps/web/src/app/features/home apps/web/src/app/shared/i18n/es.ts
git commit -m "feat(web): add the consumptions screen with filters and voiding"
```

---

## Plan Self-Review

**Spec coverage.** §4.2 materialized stock → Tasks 7 and 9. §4.4 voiding → Task 9. §5.1's three consumption endpoints → Tasks 7, 8, 9. §6.1's five reagent filters → Phase 2 shipped three, Tasks 1 and 2 add the missing two. §6.3's consumption filters → Task 8. §7.2 screens 3 and 4 → Tasks 10 and 11. §5.3 sort whitelist → Task 5.

**Known gap, deliberately deferred.** §6.2's composite filter ("reagents whose consumption exceeded X") is Phase 4, not this plan. Task 7 makes it *possible* by creating the consumption data it aggregates; the seam that will carry it already exists in `reagent-ids.query.ts` and this plan does not disturb it. Tasks 1 and 2 add clauses to `buildReagentWhere` and leave `selectReagentIds`'s structure alone, which is what keeps that seam intact.

**Carried forward from Phase 2, not addressed here:** the locations picker's 100-item ceiling, the root-scoped stores retaining filters across navigation, and the `undefined`-vs-`null` limit that stops an edit clearing an optional field. All three are recorded in the Phase 2 ledger with rulings.

**Type consistency.** `toConsumptionDto` (Task 6) is used by Tasks 7, 8 and 9. `WITH_RELATIONS` is declared once in Task 7 and reused in 8 and 9 — its `select` shape matches `ConsumptionWithRelations` field for field. `ConsumptionDto.unit` comes from `batch.unit`, which the `select` includes. `ConsumptionsStore` (Task 11) consumes the same `ConsumptionDto`. `normalizeForSearch` (Task 1) is used only by `reagent-ids.query.ts`.

**Ordering constraint.** Task 3 changes `ReagentsService.findOne`'s arity, and Task 10's component reads a reagent's batches rather than the reagent itself, so it is unaffected. Tasks 1–4 are independent of 5–11 and could run in either order; they are placed first so the debt is repaid before new surface is added on top of it.
