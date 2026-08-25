# LabTrack — Plan de Implementación, Fase 2: Ubicaciones, Reactivos y Lotes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar los reactivos del laboratorio y sus lotes físicos, con ubicaciones gestionables, listado paginado y filtros simples, dejando preparado el terreno para los consumos de la Fase 3.

**Architecture:** Se añaden tres módulos NestJS que siguen el patrón ya establecido por `users` (controller delgado, service con la regla de negocio y único punto de acceso a Prisma, DTO con `class-validator`). En el cliente se extraen primero las piezas compartidas que hoy `UsersStore` tiene a mano —decodificación del contrato paginado y tabla paginada— para que las dos pantallas nuevas nazcan sobre ellas en vez de duplicarlas.

**Tech Stack:** NestJS 11, Prisma 7 (driver adapter `@prisma/adapter-pg`), PostgreSQL, Angular 22 con Angular Material y señales, Jest, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-23-labtrack-mvp-design.md` — §3 (reglas transversales), §4 (modelo), §5 (API), §6.1 (filtros simples), §7 (cliente). El §6.2 (filtro compuesto) y el §4.4 (anulación) son de fases posteriores; este plan solo deja el hueco para el primero.

## Global Constraints

Aplican a **todas** las tareas:

- **Idioma:** código, identificadores, nombres de archivo, comentarios, mensajes de log y de commit en **inglés**. Toda cadena visible en la interfaz, en **español**, y siempre en un diccionario `es.ts` por feature, nunca como literal en una plantilla.
- **Sin borrado físico.** Ningún servicio llama a `delete` ni `deleteMany`. No existe ningún verbo HTTP `DELETE`. Desactivar es `PATCH /:id/deactivate` poniendo `active: false`.
- **Auditoría.** Todo modelo lleva `createdAt`, `updatedAt` y `madeById`. `madeById` **jamás** se lee del cuerpo de la petición: llega por `@CurrentUser()` como argumento `actorId` explícito al service. No aparece en ningún DTO.
- **Cantidades en `Decimal(12,4)`**, nunca `Float`.
- **Paginación:** `{ data, total, page, pageSize, totalPages }`; `pageSize` máximo 100, por defecto 20; el conteo y las filas salen de la misma transacción.
- **`sortBy` validado contra una lista blanca** por módulo. Un valor sin validar llegando a `orderBy` de Prisma es el vector de inyección que esto cierra.
- **La autorización vive en el servidor.** `isAdmin()` en el cliente solo oculta afordancias.
- **Prisma fijado en la línea 7.x.** El cliente generado se importa desde `src/prisma/client`, nunca desde `@prisma/client` ni desde `src/generated/`.
- Commits con prefijo convencional (`feat:`, `fix:`, `chore:`, `test:`, `refactor:`).
- El `package-lock.json` de la raíz se mantiene commiteado y al día.

---

## Estructura de archivos

```
apps/api/prisma/schema.prisma                    + Unit, Location, Reagent, ReagentBatch, Consumption
apps/api/prisma/migrations/<ts>_inventory/       migración generada
apps/api/src/common/prisma/transaction.ts        NUEVO — tipo y convención del cliente transaccional
apps/api/src/common/mappers/location.mapper.ts   NUEVO
apps/api/src/common/mappers/reagent.mapper.ts    NUEVO
apps/api/src/common/mappers/batch.mapper.ts      NUEVO
apps/api/src/locations/                          NUEVO — controller, service, module, dto
apps/api/src/reagents/                           NUEVO — controller, service, module, dto (incluye batches)
apps/api/test/utils/assert-test-database.ts      NUEVO — guarda contra producción
packages/shared/src/inventory.ts                 NUEVO — Unit, LocationDto, ReagentDto, ReagentBatchDto, requests
apps/web/src/app/core/api/api.service.ts         NUEVO — decodifica el contrato paginado una sola vez
apps/web/src/app/shared/paginated-store.ts       NUEVO — estado de listado reutilizable
apps/web/src/app/features/locations/             NUEVO — store, componente, diálogo, i18n
apps/web/src/app/features/reagents/              NUEVO — store, componente, diálogos, i18n
apps/web/src/app/features/users/users.store.ts   refactorizado sobre ApiService
```

---

## Task 1: Guarda del e2e contra bases que no son de pruebas

**Files:**
- Create: `apps/api/test/utils/assert-test-database.ts`
- Modify: `apps/api/test/utils/test-app.ts`
- Test: `apps/api/src/common/__tests__/assert-test-database.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `assertTestDatabase(url: string | undefined): void` — lanza si la URL no apunta a un host local.

**Por qué primero:** cada suite e2e vacía tablas con `TRUNCATE`. La Fase 2 añade cuatro tablas más y dos suites más, y Neon ya tiene datos reales. Un `.env` apuntando a producción convierte `npm run test:e2e` en un borrado silencioso.

- [ ] **Step 1: Escribir la prueba que falla**

`apps/api/src/common/__tests__/assert-test-database.spec.ts`:

```ts
import { assertTestDatabase } from '../../../test/utils/assert-test-database';

describe('assertTestDatabase', () => {
  it('accepts a localhost database', () => {
    expect(() =>
      assertTestDatabase('postgresql://labtrack:pass@localhost:5432/labtrack'),
    ).not.toThrow();
  });

  it('accepts 127.0.0.1', () => {
    expect(() =>
      assertTestDatabase('postgresql://labtrack:pass@127.0.0.1:5432/labtrack'),
    ).not.toThrow();
  });

  it('refuses a remote host', () => {
    expect(() =>
      assertTestDatabase(
        'postgresql://user:pass@ep-plain-heart.us-east-2.aws.neon.tech/neondb',
      ),
    ).toThrow(/refusing to run/i);
  });

  it('names the offending host without echoing credentials', () => {
    let message = '';
    try {
      assertTestDatabase('postgresql://user:sup3rsecret@db.example.com/app');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('db.example.com');
    expect(message).not.toContain('sup3rsecret');
  });

  it('refuses when the URL is missing', () => {
    expect(() => assertTestDatabase(undefined)).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- assert-test-database`
Expected: FAIL — "Cannot find module '../../../test/utils/assert-test-database'".

- [ ] **Step 3: Implementar la guarda**

`apps/api/test/utils/assert-test-database.ts`:

```ts
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Every e2e suite truncates shared tables. Pointed at a real database that
 * destroys data with no warning and no undo, so the harness refuses to start
 * unless the host is local.
 */
export function assertTestDatabase(url: string | undefined): void {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The e2e suites need a local database; ' +
        'copy apps/api/.env.example to apps/api/.env.',
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }

  if (!LOCAL_HOSTS.has(host)) {
    // The host is named because it is what the reader needs to act on; the
    // credentials in the URL are never included.
    throw new Error(
      `Refusing to run the e2e suites against '${host}'. ` +
        'They TRUNCATE tables on every test, which would destroy the data in ' +
        'that database. Point DATABASE_URL at a local database first.',
    );
  }
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/api -- assert-test-database`
Expected: PASS, 5 pruebas.

- [ ] **Step 5: Conectarla al harness**

En `apps/api/test/utils/test-app.ts`, antes de crear el módulo de pruebas, al principio de `createTestApp`:

```ts
import { assertTestDatabase } from './assert-test-database';

export async function createTestApp(): Promise<TestContext> {
  assertTestDatabase(process.env.DATABASE_URL);
  // ... resto sin cambios
```

Y en `resetDatabase`, antes del `TRUNCATE`, por si alguna suite construye su propio cliente sin pasar por `createTestApp`:

```ts
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL);
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
}
```

`apps/api/test/seed.e2e-spec.ts` construye su propio `PrismaClient` y trunca por su cuenta: añade también ahí la llamada, antes de instanciarlo.

- [ ] **Step 6: Verificar que la guarda dispara de verdad**

Run: `DATABASE_URL="postgresql://u:p@db.example.com/app" npm run test:e2e -w apps/api`
Expected: FALLA inmediatamente con el mensaje de rechazo, **sin** ejecutar ninguna prueba.

Run: `npm run test:e2e -w apps/api`
Expected: PASS, 24 pruebas, como antes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/utils apps/api/src/common/__tests__ apps/api/test/seed.e2e-spec.ts
git commit -m "test(api): refuse to run e2e suites against a non-local database"
```

---

## Task 2: Dejar el lint en verde

**Files:**
- Modify: `apps/api/src/common/filters/prisma-exception.filter.ts`, `apps/api/src/common/decorators/current-user.decorator.ts`, `apps/api/src/common/guards/password-change.guard.ts`, `apps/api/src/common/guards/roles.guard.ts`, `apps/api/src/users/users.service.spec.ts`, `apps/api/test/auth.e2e-spec.ts`, `apps/api/test/users.e2e-spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `npm run lint -w apps/api` termina con código 0.

**Por qué ahora:** son 53 errores `no-unsafe-*` preexistentes sobre `any`. Con el lint roto, el código de esta fase no puede apoyarse en él, y los errores nuevos se pierden entre los viejos. Se arregla antes de escribir nada nuevo.

- [ ] **Step 1: Ver el estado de partida**

Run: `cd apps/api && ../../node_modules/.bin/eslint "{src,test}/**/*.ts" 2>&1 | grep -c " error "`
Expected: 53. Anota el número: al final debe ser 0.

- [ ] **Step 2: Tipar el filtro de excepciones**

En `apps/api/src/common/filters/prisma-exception.filter.ts`, el `response` implícitamente `any` concentra 13 errores:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '../../prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    // ... el resto del cuerpo no cambia
```

- [ ] **Step 3: Tipar lo que lee la petición**

Crea `apps/api/src/common/types/request-with-user.ts`:

```ts
import { Request } from 'express';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

// Express types `request.user` as `any`. Naming the shape here once keeps the
// unsafe access out of every guard and decorator that reads it.
export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}
```

Úsalo en los tres sitios que hoy leen `request.user` sin tipo:

```ts
// current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<RequestWithUser>().user as AuthenticatedUser,
);

// roles.guard.ts
const user = context.switchToHttp().getRequest<RequestWithUser>().user;

// password-change.guard.ts
const request = context.switchToHttp().getRequest<RequestWithUser>();
const user = request.user;
```

- [ ] **Step 4: Tipar los cuerpos de respuesta en los e2e**

Los 29 errores restantes son accesos a `response.body`, que supertest tipa como `any`. Añade en `apps/api/test/utils/` un helper:

`apps/api/test/utils/body.ts`:

```ts
import { Response } from 'supertest';

// supertest types `body` as `any`, which makes every assertion an unsafe member
// access. This names the shape at the call site instead.
export function body<T>(response: Response): T {
  return response.body as T;
}
```

Y en las suites, sustituye `response.body.total` por:

```ts
const page = body<PaginatedResponse<UserDto>>(response);
expect(page.total).toBe(2);
```

Aplica el mismo patrón a cada acceso marcado por el lint. No cambies ninguna aserción: solo el tipo por el que se llega a ella.

- [ ] **Step 5: Verificar**

Run: `cd apps/api && ../../node_modules/.bin/eslint "{src,test}/**/*.ts" 2>&1 | grep -c " error "`
Expected: 0.

Run: `npm run test -w apps/api && npm run test:e2e -w apps/api`
Expected: 34 unitarias y 24 e2e, todas pasando. Ninguna aserción cambió de significado.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "refactor(api): type the request and response bodies the lint flagged"
```

> **Nota para quien ejecute:** el script `lint` lleva `--fix`, así que reformatea archivos al pasar. Ejecuta `git diff --stat` antes de commitear y revierte cualquier archivo cuyo único cambio sea de formato y no tenga que ver con esta tarea.

---

## Task 3: Esquema de inventario y migración

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_inventory/migration.sql` (generada)
- Test: `apps/api/test/inventory-schema.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `createTestApp`, `resetDatabase`.
- Produces: los modelos `Location`, `Reagent`, `ReagentBatch`, `Consumption` y el enum `Unit` en el cliente generado, importables desde `src/prisma/client`.

**Decisión de alcance:** la migración incluye también `Consumption`, aunque su API es de la Fase 3. Motivo: `ReagentBatch.consumptions` es una relación del modelo del spec, y el hueco para el filtro compuesto (Task 6) necesita la tabla para poder unir contra ella. Crear la tabla ahora evita una segunda migración que toque `ReagentBatch` otra vez. No se expone ningún endpoint de consumos en esta fase.

- [ ] **Step 1: Añadir el enum y los modelos**

En `apps/api/prisma/schema.prisma`, después del enum `Role`:

```prisma
enum Unit {
  G
  MG
  KG
  ML
  L
  UNIT
}

model Location {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  madeById String
  madeBy   User   @relation("LocationCreatedBy", fields: [madeById], references: [id])

  batches ReagentBatch[]

  @@index([active])
}

model Reagent {
  id           String   @id @default(uuid())
  name         String
  casNumber    String
  reference    String?
  description  String?
  dataSheetUrl String?
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  madeById String
  madeBy   User   @relation("ReagentCreatedBy", fields: [madeById], references: [id])

  batches ReagentBatch[]

  @@index([name])
  @@index([casNumber])
  @@index([active])
}

model ReagentBatch {
  id             String    @id @default(uuid())
  lotNumber      String
  entryDate      DateTime
  expirationDate DateTime?
  initialStock   Decimal   @db.Decimal(12, 4)
  currentStock   Decimal   @db.Decimal(12, 4)
  unit           Unit
  active         Boolean   @default(true)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  reagentId  String
  reagent    Reagent  @relation(fields: [reagentId], references: [id])
  locationId String
  location   Location @relation(fields: [locationId], references: [id])

  madeById String
  madeBy   User   @relation("BatchCreatedBy", fields: [madeById], references: [id])

  consumptions Consumption[]

  @@index([reagentId])
  @@index([expirationDate])
  @@index([locationId])
  @@index([active])
}

model Consumption {
  id         String    @id @default(uuid())
  consumedAt DateTime
  quantity   Decimal   @db.Decimal(12, 4)
  purpose    String
  active     Boolean   @default(true)
  voidReason String?
  voidedAt   DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  batchId String
  batch   ReagentBatch @relation(fields: [batchId], references: [id])

  voidedById String?
  voidedBy   User?   @relation("ConsumptionVoidedBy", fields: [voidedById], references: [id])
  madeById   String
  madeBy     User    @relation("ConsumptionCreatedBy", fields: [madeById], references: [id])

  @@index([batchId])
  @@index([consumedAt])
  @@index([active])
}
```

En `model User`, añade los lados inversos de esas relaciones:

```prisma
  createdLocations    Location[]    @relation("LocationCreatedBy")
  createdReagents     Reagent[]     @relation("ReagentCreatedBy")
  createdBatches      ReagentBatch[] @relation("BatchCreatedBy")
  createdConsumptions Consumption[] @relation("ConsumptionCreatedBy")
  voidedConsumptions  Consumption[] @relation("ConsumptionVoidedBy")
```

- [ ] **Step 2: Generar la migración**

Run, con cwd en `apps/api` para que Prisma encuentre el `.env`:

```bash
cd apps/api && ../../node_modules/.bin/prisma migrate dev --name inventory
```

Expected: crea la migración y regenera el cliente. Revisa el SQL: debe crear el tipo `Unit`, las cuatro tablas, las claves foráneas y los índices declarados.

- [ ] **Step 3: Añadir el índice único parcial de lotes**

El spec §4.3 exige que `(reagentId, lotNumber)` sea único **entre lotes activos**. Prisma no expresa índices únicos parciales, así que va en SQL. Crea una migración vacía y escribe el índice:

```bash
cd apps/api && ../../node_modules/.bin/prisma migrate dev --create-only --name batch_active_lot_unique
```

En el `migration.sql` generado:

```sql
-- A lot number identifies a batch only while it is active: a deactivated batch
-- must not block reusing its number, which a plain unique constraint would.
CREATE UNIQUE INDEX "ReagentBatch_reagentId_lotNumber_active_key"
  ON "ReagentBatch" ("reagentId", "lotNumber")
  WHERE "active";
```

Aplícala:

```bash
cd apps/api && ../../node_modules/.bin/prisma migrate dev
```

- [ ] **Step 4: Escribir la prueba del esquema**

`apps/api/test/inventory-schema.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Inventory schema (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Consumption", "ReagentBatch", "Reagent", "Location", "User" RESTART IDENTITY CASCADE',
    );
    const user = await prisma.user.create({
      data: {
        username: 'admin',
        fullName: 'Admin',
        passwordHash: 'x',
        role: 'ADMIN',
        mustChangePassword: false,
      },
    });
    userId = user.id;
  });

  async function makeBatch(lotNumber: string, active = true) {
    const location = await prisma.location.upsert({
      where: { name: 'Estante A' },
      update: {},
      create: { name: 'Estante A', madeById: userId },
    });
    const reagent = await prisma.reagent.upsert({
      where: { id: 'fixed-reagent' },
      update: {},
      create: {
        id: 'fixed-reagent',
        name: 'Acetona',
        casNumber: '67-64-1',
        madeById: userId,
      },
    });
    return prisma.reagentBatch.create({
      data: {
        reagentId: reagent.id,
        locationId: location.id,
        lotNumber,
        entryDate: new Date('2026-01-10'),
        initialStock: '500.0000',
        currentStock: '500.0000',
        unit: 'ML',
        active,
        madeById: userId,
      },
    });
  }

  it('stores quantities without binary rounding error', async () => {
    const batch = await makeBatch('L-1');
    const stored = await prisma.reagentBatch.findUniqueOrThrow({
      where: { id: batch.id },
    });
    // 0.1 + 0.2 is the classic float trap; Decimal must keep it exact.
    const updated = await prisma.reagentBatch.update({
      where: { id: stored.id },
      data: { currentStock: '0.3000' },
    });
    expect(updated.currentStock.toString()).toBe('0.3');
  });

  it('rejects two active batches sharing a lot number for one reagent', async () => {
    await makeBatch('L-1');
    await expect(makeBatch('L-1')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows reusing a lot number once the previous batch is inactive', async () => {
    const first = await makeBatch('L-1');
    await prisma.reagentBatch.update({
      where: { id: first.id },
      data: { active: false },
    });
    await expect(makeBatch('L-1')).resolves.toBeDefined();
  });
});
```

- [ ] **Step 5: Ejecutar**

Run: `npm run test:e2e -w apps/api -- inventory-schema`
Expected: PASS, 3 pruebas. La segunda demuestra que el índice parcial existe; la tercera, que es parcial y no total.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/test/inventory-schema.e2e-spec.ts
git commit -m "feat(api): add the inventory schema with a partial unique lot index"
```

---

## Task 4: Convención de transacciones

**Files:**
- Create: `apps/api/src/common/prisma/transaction.ts`
- Test: `apps/api/src/common/prisma/transaction.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: el tipo `TransactionClient` y el helper `runInTransaction(prisma, fn, options?)`.

**Por qué ahora:** la Fase 3 registra y anula consumos, dos operaciones con invariantes que abarcan varias sentencias (`quantity <= currentStock`, decremento, reversión). Hoy no hay ninguna convención sobre cómo un service recibe un cliente transaccional, y la Task 5 de la Fase 1 ya la necesitó a medias en `UsersService.update`. Fijarla antes de que tres servicios la improvisen por separado.

- [ ] **Step 1: Escribir la prueba que falla**

`apps/api/src/common/prisma/transaction.spec.ts`:

```ts
import { runInTransaction } from './transaction';

describe('runInTransaction', () => {
  it('passes the transactional client to the callback', async () => {
    const tx = { marker: 'tx-client' };
    const prisma = {
      $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn(tx)),
    };

    const received = await runInTransaction(prisma as never, async (client) => client);

    expect(received).toBe(tx);
  });

  it('uses Serializable isolation by default', async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn({})),
    };

    await runInTransaction(prisma as never, async () => undefined);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('allows overriding the isolation level', async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn({})),
    };

    await runInTransaction(prisma as never, async () => undefined, {
      isolationLevel: 'ReadCommitted',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- transaction`
Expected: FAIL — "Cannot find module './transaction'".

- [ ] **Step 3: Implementar**

`apps/api/src/common/prisma/transaction.ts`:

```ts
import { Prisma } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The client handed to a transactional callback. It exposes the model methods
 * but not `$transaction`, which is what prevents a nested transaction by
 * accident.
 */
export type TransactionClient = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Runs `fn` inside one transaction.
 *
 * Defaults to Serializable because the invariants this project protects are
 * read-then-write: "the last administrator cannot be demoted", "a consumption
 * cannot exceed the stock it reads". Under a weaker level two concurrent
 * requests can both read a state that permits the write and both proceed.
 *
 * A service that needs a transaction takes `TransactionClient` as a parameter
 * rather than reaching for `this.prisma`, so it composes: the same method works
 * standalone and as part of a larger transaction.
 */
export function runInTransaction<T>(
  prisma: PrismaService,
  fn: (client: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: options.isolationLevel ?? 'Serializable',
  });
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/api -- transaction`
Expected: PASS, 3 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/prisma
git commit -m "feat(api): add a transaction convention with Serializable by default"
```

---

## Task 5: Tipos compartidos del inventario

**Files:**
- Create: `packages/shared/src/inventory.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/inventory.spec.ts`

**Interfaces:**
- Consumes: `PaginatedResponse` de `pagination.ts`.
- Produces: `Unit`, `UNITS`, `LocationDto`, `ReagentDto`, `ReagentBatchDto`, `CreateLocationRequest`, `UpdateLocationRequest`, `CreateReagentRequest`, `UpdateReagentRequest`, `CreateBatchRequest`, `UpdateBatchRequest`, `isUnit`.

- [ ] **Step 1: Escribir la prueba que falla**

`packages/shared/src/inventory.spec.ts`:

```ts
import { UNITS, isUnit } from './inventory';

describe('units', () => {
  it('lists every unit the schema allows', () => {
    expect([...UNITS]).toEqual(['G', 'MG', 'KG', 'ML', 'L', 'UNIT']);
  });

  it('recognises a valid unit', () => {
    expect(isUnit('ML')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isUnit('litros')).toBe(false);
    expect(isUnit('')).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w packages/shared`
Expected: FAIL — "Cannot find module './inventory'".

- [ ] **Step 3: Implementar**

`packages/shared/src/inventory.ts`:

```ts
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

export interface UpdateLocationRequest {
  name?: string;
  description?: string;
}

export interface CreateReagentRequest {
  name: string;
  casNumber: string;
  reference?: string;
  description?: string;
  dataSheetUrl?: string;
}

export type UpdateReagentRequest = Partial<CreateReagentRequest>;

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
```

**Nota sobre los decimales:** `initialStock` y `currentStock` viajan como **string**, no como `number`. Un `Decimal(12,4)` no cabe sin pérdida en el `number` de JavaScript, y serializarlo como número reintroduce justo el error de redondeo que el spec §3.3 evita al elegir `Decimal`.

- [ ] **Step 4: Reexportar**

En `packages/shared/src/index.ts`:

```ts
export * from './pagination';
export * from './user';
export * from './inventory';
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm run test -w packages/shared && npm run build -w packages/shared`
Expected: PASS, 5 pruebas en total, y la compilación sin errores.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add the inventory contract types"
```

---

## Task 6: Módulo de ubicaciones

**Files:**
- Create: `apps/api/src/common/mappers/location.mapper.ts`, `apps/api/src/locations/locations.service.ts`, `apps/api/src/locations/locations.controller.ts`, `apps/api/src/locations/locations.module.ts`, `apps/api/src/locations/dto/create-location.dto.ts`, `apps/api/src/locations/dto/update-location.dto.ts`, `apps/api/src/locations/dto/list-locations-query.dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/locations/locations.service.spec.ts`, `apps/api/test/locations.e2e-spec.ts`

**Interfaces:**
- Consumes: `PaginationQueryDto`, `@Roles`, `@CurrentUser`, `AuthenticatedUser`, `buildPaginatedResponse`, `LocationDto`.
- Produces: `toLocationDto(location)`, `LocationsService.list(query)`, `.create(dto, actorId)`, `.update(id, dto)`, `.deactivate(id)`; rutas `GET /locations`, `POST /locations`, `PATCH /locations/:id`, `PATCH /locations/:id/deactivate`.

**Por qué esta primero:** es la entidad más simple de las tres y establece el patrón que reutilizan reactivos y lotes. Un revisor que apruebe esta tarea está aprobando la forma de las dos siguientes.

**Permisos:** crear, editar y desactivar son `@Roles('ADMIN')`. Listar lo puede hacer cualquier usuario autenticado, porque el formulario de alta de lotes necesita el desplegable de ubicaciones. Decóralo por método, no a nivel de controlador.

- [ ] **Step 1: Escribir el spec unitario que falla**

`apps/api/src/locations/locations.service.spec.ts`:

```ts
import { LocationsService } from './locations.service';

function buildService() {
  const prisma = {
    location: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  return { service: new LocationsService(prisma as never), prisma };
}

const baseQuery = { page: 1, pageSize: 20, sortOrder: 'asc', sortBy: 'name', skip: 0 };

describe('LocationsService', () => {
  it('excludes inactive locations unless asked', async () => {
    const { service, prisma } = buildService();
    await service.list(baseQuery as never);
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('includes them when includeInactive is set', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, includeInactive: true } as never);
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('filters by name, case-insensitively', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, search: 'estante' } as never);
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          name: { contains: 'estante', mode: 'insensitive' },
        },
      }),
    );
  });

  it('records the actor when creating', async () => {
    const { service, prisma } = buildService();
    prisma.location.create.mockResolvedValue({
      id: 'l1', name: 'Estante A', description: null, active: true,
      createdAt: new Date(), updatedAt: new Date(), madeById: 'admin-1',
    });

    await service.create({ name: 'Estante A' }, 'admin-1');

    expect(prisma.location.create).toHaveBeenCalledWith({
      data: { name: 'Estante A', description: undefined, madeById: 'admin-1' },
    });
  });

  it('deactivates instead of deleting', async () => {
    const { service, prisma } = buildService();
    prisma.location.update.mockResolvedValue({
      id: 'l1', name: 'Estante A', description: null, active: false,
      createdAt: new Date(), updatedAt: new Date(), madeById: 'admin-1',
    });

    await service.deactivate('l1');

    expect(prisma.location.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { active: false },
    });
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- locations.service`
Expected: FAIL — "Cannot find module './locations.service'".

- [ ] **Step 3: Escribir el mapper y los DTO**

`apps/api/src/common/mappers/location.mapper.ts`:

```ts
import { LocationDto } from '@labtrack/shared';
import { Location } from '../../prisma/client';

export function toLocationDto(location: Location): LocationDto {
  return {
    id: location.id,
    name: location.name,
    description: location.description,
    active: location.active,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}
```

`apps/api/src/locations/dto/create-location.dto.ts`:

```ts
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
```

`apps/api/src/locations/dto/update-location.dto.ts`:

```ts
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
```

`apps/api/src/locations/dto/list-locations-query.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const LOCATION_SORT_COLUMNS = ['name', 'createdAt'] as const;

export class ListLocationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(LOCATION_SORT_COLUMNS)
  sortBy: (typeof LOCATION_SORT_COLUMNS)[number] = 'name';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
```

- [ ] **Step 4: Implementar el service**

`apps/api/src/locations/locations.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { LocationDto, PaginatedResponse, buildPaginatedResponse } from '@labtrack/shared';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toLocationDto } from '../common/mappers/location.mapper';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListLocationsQueryDto): Promise<PaginatedResponse<LocationDto>> {
    const where: Prisma.LocationWhereInput = {};
    if (!query.includeInactive) {
      where.active = true;
    }
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    // The count and the page come from the same transaction, so the total
    // always corresponds to the rows being shown.
    const [data, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.location.count({ where }),
    ]);

    return buildPaginatedResponse(data.map(toLocationDto), total, query.page, query.pageSize);
  }

  async create(dto: CreateLocationDto, actorId: string): Promise<LocationDto> {
    const location = await this.prisma.location.create({
      data: { name: dto.name, description: dto.description, madeById: actorId },
    });
    return toLocationDto(location);
  }

  async update(id: string, dto: UpdateLocationDto): Promise<LocationDto> {
    const location = await this.prisma.location.update({
      where: { id },
      data: { name: dto.name, description: dto.description },
    });
    return toLocationDto(location);
  }

  async deactivate(id: string): Promise<LocationDto> {
    const location = await this.prisma.location.update({
      where: { id },
      data: { active: false },
    });
    return toLocationDto(location);
  }
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/api -- locations.service`
Expected: PASS, 5 pruebas.

- [ ] **Step 6: Controlador y módulo**

`apps/api/src/locations/locations.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { LocationDto, PaginatedResponse } from '@labtrack/shared';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  // Any authenticated user may list: the batch form needs the location picker.
  @Get()
  list(@Query() query: ListLocationsQueryDto): Promise<PaginatedResponse<LocationDto>> {
    return this.locations.list(query);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @Body() dto: CreateLocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<LocationDto> {
    return this.locations.create(dto, actor.id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<LocationDto> {
    return this.locations.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles('ADMIN')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<LocationDto> {
    return this.locations.deactivate(id);
  }
}
```

`apps/api/src/locations/locations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
```

Importa `LocationsModule` en `AppModule`.

- [ ] **Step 7: Escribir el e2e**

`apps/api/test/locations.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LocationDto, PaginatedResponse } from '@labtrack/shared';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Locations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    passwords = app.get(PasswordService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Consumption", "ReagentBatch", "Reagent", "Location", "User" RESTART IDENTITY CASCADE',
    );
    const passwordHash = await passwords.hash('initial-password');
    await prisma.user.createMany({
      data: [
        { username: 'admin', fullName: 'Admin', passwordHash, role: 'ADMIN', mustChangePassword: false },
        { username: 'ana', fullName: 'Ana Ruiz', passwordHash, role: 'USER', mustChangePassword: false },
      ],
    });
  });

  async function tokenFor(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body<{ accessToken: string }>(response).accessToken;
  }

  it('lets an admin create a location and records the actor', async () => {
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Estante A', description: 'Pasillo 1' })
      .expect(201);

    const created = body<LocationDto>(response);
    expect(created.name).toBe('Estante A');

    const stored = await prisma.location.findUniqueOrThrow({ where: { id: created.id } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(stored.madeById).toBe(admin.id);
  });

  it('blocks a non-admin from creating one', async () => {
    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .send({ name: 'Estante B' })
      .expect(403);
  });

  it('lets any authenticated user list them', async () => {
    await request(app.getHttpServer())
      .get('/locations')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .expect(200);
  });

  it('rejects a duplicated name with 409', async () => {
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Estante A' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Estante A' })
      .expect(409);
  });

  it('rejects a forged madeById with 400', async () => {
    await request(app.getHttpServer())
      .post('/locations')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ name: 'Estante C', madeById: 'forged-id' })
      .expect(400);
  });

  it('deactivates without deleting the row', async () => {
    const token = await tokenFor('admin');
    const created = body<LocationDto>(
      await request(app.getHttpServer())
        .post('/locations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Estante D' }),
    );

    await request(app.getHttpServer())
      .patch(`/locations/${created.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const stored = await prisma.location.findUnique({ where: { id: created.id } });
    expect(stored?.active).toBe(false);
  });

  it('hides inactive locations from the default listing', async () => {
    const token = await tokenFor('admin');
    const created = body<LocationDto>(
      await request(app.getHttpServer())
        .post('/locations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Estante E' }),
    );
    await request(app.getHttpServer())
      .patch(`/locations/${created.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);

    const listed = body<PaginatedResponse<LocationDto>>(
      await request(app.getHttpServer())
        .get('/locations')
        .set('Authorization', `Bearer ${token}`),
    );
    expect(listed.total).toBe(0);

    const withInactive = body<PaginatedResponse<LocationDto>>(
      await request(app.getHttpServer())
        .get('/locations?includeInactive=true')
        .set('Authorization', `Bearer ${token}`),
    );
    expect(withInactive.total).toBe(1);
  });

  it('exposes no DELETE route', async () => {
    await request(app.getHttpServer())
      .delete('/locations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(404);
  });
});
```

- [ ] **Step 8: Ejecutar**

Run: `npm run test:e2e -w apps/api -- locations`
Expected: PASS, 8 pruebas.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/locations apps/api/src/common/mappers/location.mapper.ts apps/api/src/app.module.ts apps/api/test/locations.e2e-spec.ts
git commit -m "feat(api): add the locations module"
```

---

## Task 7: Módulo de reactivos, con el hueco para el filtro compuesto

**Files:**
- Create: `apps/api/src/common/mappers/reagent.mapper.ts`, `apps/api/src/reagents/reagents.service.ts`, `apps/api/src/reagents/reagent-ids.query.ts`, `apps/api/src/reagents/reagents.controller.ts`, `apps/api/src/reagents/reagents.module.ts`, `apps/api/src/reagents/dto/create-reagent.dto.ts`, `apps/api/src/reagents/dto/update-reagent.dto.ts`, `apps/api/src/reagents/dto/list-reagents-query.dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/reagents/reagents.service.spec.ts`, `apps/api/test/reagents.e2e-spec.ts`

**Interfaces:**
- Consumes: lo mismo que la Task 6, más `ReagentDto`.
- Produces: `toReagentDto(reagent)`, `ReagentsService.list(query)`, `.findOne(id)`, `.create(dto, actorId)`, `.update(id, dto)`, `.deactivate(id)`; `buildReagentWhere(query)`; rutas `GET /reagents`, `GET /reagents/:id`, `POST /reagents`, `PATCH /reagents/:id`, `PATCH /reagents/:id/deactivate`.

**El hueco, y por qué existe.** El spec §6.2 pide filtrar por "reactivos cuyo consumo haya sido mayor a X en un rango de fechas". Eso no es un `where` sobre `Reagent`: es un `HAVING` sobre consumos agrupados. Copiar la forma de `UsersService.list` —construir un `where` y meterlo en `$transaction([findMany, count])`— no deja sitio para que los ids vengan de otra consulta.

Por eso `list()` se escribe **desde el principio** en dos pasos: primero se resuelve **qué ids** califican, después se hidratan. En esta fase el primer paso es un `findMany` que solo selecciona ids; en la Fase 4 se le añade la rama con `$queryRaw` sin tocar el segundo paso ni el controlador.

- [ ] **Step 1: Escribir el spec unitario que falla**

`apps/api/src/reagents/reagents.service.spec.ts`:

```ts
import { ReagentsService } from './reagents.service';

function buildService(ids: { id: string }[] = [], rows: unknown[] = []) {
  const prisma = {
    reagent: {
      findMany: jest.fn()
        .mockResolvedValueOnce(ids)   // step 1: which ids qualify
        .mockResolvedValueOnce(rows), // step 2: hydrate them
      count: jest.fn().mockResolvedValue(ids.length),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  return { service: new ReagentsService(prisma as never), prisma };
}

const baseQuery = { page: 1, pageSize: 20, sortOrder: 'asc', sortBy: 'name', skip: 0 };

describe('ReagentsService.list', () => {
  it('resolves ids first and hydrates them second', async () => {
    const { service, prisma } = buildService([{ id: 'r1' }]);
    await service.list(baseQuery as never);

    const [idCall, hydrateCall] = prisma.reagent.findMany.mock.calls;
    // Step 1 asks only for ids — it is the seam the composite filter replaces.
    expect(idCall[0]).toMatchObject({ select: { id: true } });
    // Step 2 fetches the rows for exactly those ids.
    expect(hydrateCall[0]).toMatchObject({ where: { id: { in: ['r1'] } } });
  });

  it('filters by name, case-insensitively', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, name: 'aceto' } as never);
    expect(prisma.reagent.findMany.mock.calls[0][0].where).toMatchObject({
      active: true,
      name: { contains: 'aceto', mode: 'insensitive' },
    });
  });

  it('filters by CAS number exactly', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, casNumber: '67-64-1' } as never);
    expect(prisma.reagent.findMany.mock.calls[0][0].where).toMatchObject({
      casNumber: '67-64-1',
    });
  });

  it('filters by the location of its batches', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, locationId: 'loc-1' } as never);
    expect(prisma.reagent.findMany.mock.calls[0][0].where).toMatchObject({
      batches: { some: { active: true, locationId: 'loc-1' } },
    });
  });

  it('counts with the same where the ids came from', async () => {
    const { service, prisma } = buildService([{ id: 'r1' }]);
    await service.list({ ...baseQuery, name: 'aceto' } as never);
    expect(prisma.reagent.count).toHaveBeenCalledWith({
      where: prisma.reagent.findMany.mock.calls[0][0].where,
    });
  });
});

describe('ReagentsService.deactivate', () => {
  it('deactivates the reagent and its batches in one transaction', async () => {
    const tx = {
      reagent: { update: jest.fn().mockResolvedValue({ id: 'r1' }) },
      reagentBatch: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    // runInTransaction delegates to prisma.$transaction, so mocking it here
    // exercises the real path the convention takes.
    const prisma = {
      $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn(tx)),
      reagent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'r1', name: 'Acetona', casNumber: '67-64-1', reference: null,
          description: null, dataSheetUrl: null, active: false,
          createdAt: new Date(), updatedAt: new Date(), batches: [],
        }),
      },
    };
    const service = new ReagentsService(prisma as never);

    await service.deactivate('r1');

    expect(tx.reagent.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { active: false },
    });
    expect(tx.reagentBatch.updateMany).toHaveBeenCalledWith({
      where: { reagentId: 'r1', active: true },
      data: { active: false },
    });
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- reagents.service`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: El mapper**

`apps/api/src/common/mappers/reagent.mapper.ts`:

```ts
import { ReagentDto, Unit } from '@labtrack/shared';
import { Reagent, ReagentBatch } from '../../prisma/client';

type ReagentWithBatches = Reagent & { batches: ReagentBatch[] };

/**
 * Stock is reported per unit rather than as one number: a reagent may hold
 * batches measured in millilitres and litres at once, and adding those together
 * would invent a quantity nobody can act on.
 */
export function toReagentDto(reagent: ReagentWithBatches): ReagentDto {
  const totals = new Map<Unit, string>();
  for (const batch of reagent.batches) {
    if (!batch.active) continue;
    const previous = totals.get(batch.unit as Unit);
    const sum = previous ? batch.currentStock.add(previous) : batch.currentStock;
    totals.set(batch.unit as Unit, sum.toString());
  }

  return {
    id: reagent.id,
    name: reagent.name,
    casNumber: reagent.casNumber,
    reference: reagent.reference,
    description: reagent.description,
    dataSheetUrl: reagent.dataSheetUrl,
    active: reagent.active,
    createdAt: reagent.createdAt.toISOString(),
    updatedAt: reagent.updatedAt.toISOString(),
    stockByUnit: [...totals].map(([unit, total]) => ({ unit, total })),
    batchCount: reagent.batches.filter((batch) => batch.active).length,
  };
}
```

- [ ] **Step 4: Los DTO**

Instala primero la dependencia que usa el DTO de actualización: `npm install -w apps/api @nestjs/mapped-types`.

`apps/api/src/reagents/dto/create-reagent.dto.ts`:

```ts
import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateReagentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  // CAS numbers are 2-7 digits, 2 digits and a check digit, e.g. 67-64-1.
  @IsString()
  @Matches(/^\d{2,7}-\d{2}-\d$/, { message: 'casNumber must look like 67-64-1' })
  casNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  dataSheetUrl?: string;
}
```

`apps/api/src/reagents/dto/update-reagent.dto.ts`:

```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateReagentDto } from './create-reagent.dto';

export class UpdateReagentDto extends PartialType(CreateReagentDto) {}
```

`apps/api/src/reagents/dto/list-reagents-query.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const REAGENT_SORT_COLUMNS = ['name', 'casNumber', 'createdAt'] as const;

export class ListReagentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  casNumber?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsIn(REAGENT_SORT_COLUMNS)
  sortBy: (typeof REAGENT_SORT_COLUMNS)[number] = 'name';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
```

- [ ] **Step 5: El hueco, en su propio archivo**

`apps/api/src/reagents/reagent-ids.query.ts`:

```ts
import { Prisma } from '../prisma/client';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

/**
 * Translates the simple filters into a Prisma `where`.
 *
 * This is deliberately separate from the service: spec §6.2 adds a filter that
 * cannot be expressed as a `where` at all — "reagents whose consumption exceeded
 * X in a date range" is a HAVING over grouped consumptions, and it will arrive
 * as a second strategy that returns ids from a raw query. Keeping id selection
 * apart from hydration means that arrives as a new branch here rather than as a
 * rewrite of list().
 */
export function buildReagentWhere(query: ListReagentsQueryDto): Prisma.ReagentWhereInput {
  const where: Prisma.ReagentWhereInput = {};

  if (!query.includeInactive) {
    where.active = true;
  }
  if (query.name) {
    where.name = { contains: query.name, mode: 'insensitive' };
  }
  if (query.casNumber) {
    where.casNumber = query.casNumber;
  }
  if (query.locationId) {
    // A reagent matches a location when any of its active batches sits there.
    where.batches = { some: { active: true, locationId: query.locationId } };
  }

  return where;
}
```

- [ ] **Step 6: El service**

`apps/api/src/reagents/reagents.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PaginatedResponse, ReagentDto, buildPaginatedResponse } from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { runInTransaction } from '../common/prisma/transaction';
import { toReagentDto } from '../common/mappers/reagent.mapper';
import { buildReagentWhere } from './reagent-ids.query';
import { CreateReagentDto } from './dto/create-reagent.dto';
import { UpdateReagentDto } from './dto/update-reagent.dto';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

@Injectable()
export class ReagentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListReagentsQueryDto): Promise<PaginatedResponse<ReagentDto>> {
    const where = buildReagentWhere(query);

    // Step 1 — which reagents qualify, and how many in total. The count uses the
    // same `where` as the page, so the paginator can never disagree with the rows.
    const [ids, total] = await this.prisma.$transaction([
      this.prisma.reagent.findMany({
        where,
        select: { id: true },
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.reagent.count({ where }),
    ]);

    // Step 2 — hydrate exactly those ids with their batches. The ordering is
    // repeated because `where: { id: { in } }` does not preserve the id order.
    const rows = await this.prisma.reagent.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      include: { batches: true },
      orderBy: { [query.sortBy]: query.sortOrder },
    });

    return buildPaginatedResponse(rows.map(toReagentDto), total, query.page, query.pageSize);
  }

  async findOne(id: string): Promise<ReagentDto> {
    const reagent = await this.prisma.reagent.findUniqueOrThrow({
      where: { id },
      include: { batches: true },
    });
    return toReagentDto(reagent);
  }

  async create(dto: CreateReagentDto, actorId: string): Promise<ReagentDto> {
    const reagent = await this.prisma.reagent.create({
      data: {
        name: dto.name,
        casNumber: dto.casNumber,
        reference: dto.reference,
        description: dto.description,
        dataSheetUrl: dto.dataSheetUrl,
        madeById: actorId,
      },
      include: { batches: true },
    });
    return toReagentDto(reagent);
  }

  async update(id: string, dto: UpdateReagentDto): Promise<ReagentDto> {
    const reagent = await this.prisma.reagent.update({
      where: { id },
      data: {
        name: dto.name,
        casNumber: dto.casNumber,
        reference: dto.reference,
        description: dto.description,
        dataSheetUrl: dto.dataSheetUrl,
      },
      include: { batches: true },
    });
    return toReagentDto(reagent);
  }

  // Deactivating a reagent deactivates its batches too (spec §3.1), in one
  // transaction so the two can never disagree. Uses the convention from Task 4;
  // ReadCommitted is enough here because nothing is read before the writes.
  async deactivate(id: string): Promise<ReagentDto> {
    await runInTransaction(
      this.prisma,
      async (tx) => {
        await tx.reagent.update({ where: { id }, data: { active: false } });
        await tx.reagentBatch.updateMany({
          where: { reagentId: id, active: true },
          data: { active: false },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );

    return this.findOne(id);
  }
}
```

- [ ] **Step 7: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/api -- reagents.service`
Expected: PASS, 6 pruebas.

- [ ] **Step 8: Controlador y módulo**

`apps/api/src/reagents/reagents.controller.ts` sigue exactamente la forma del de ubicaciones: `GET /reagents` y `GET /reagents/:id` abiertos a cualquier usuario autenticado; `POST`, `PATCH /:id` y `PATCH /:id/deactivate` con `@Roles('ADMIN')`; `@CurrentUser()` para el `actorId` en la creación; `ParseUUIDPipe` en los parámetros de ruta.

`apps/api/src/reagents/reagents.module.ts` declara controlador y servicio y exporta el servicio. Impórtalo en `AppModule`.

- [ ] **Step 9: El e2e**

`apps/api/test/reagents.e2e-spec.ts`, con la misma estructura de fixtures que el de ubicaciones (mismo `TRUNCATE`, mismos dos usuarios, mismo helper `tokenFor`). Cubre:

- un ADMIN crea un reactivo y queda registrado el `madeById`;
- un no-ADMIN recibe 403 al crear, y 200 al listar;
- `casNumber` mal formado devuelve 400 (envía `{ casNumber: '1234' }`);
- `dataSheetUrl` sin protocolo devuelve 400 (envía `{ dataSheetUrl: 'ejemplo.com/ficha.pdf' }`);
- filtrar por `name` parcial encuentra el reactivo con distinta capitalización (`?name=aceto` encuentra "Acetona");
- filtrar por `casNumber` exacto lo encuentra;
- `total` y `data.length` son coherentes al paginar con `pageSize=1` sobre dos reactivos: `total` vale 2 y `data` trae 1;
- desactivar un reactivo desactiva también sus lotes activos — créalos directamente con Prisma en el fixture y compruébalo leyendo la tabla;
- `stockByUnit` agrupa por unidad y no suma unidades distintas: un reactivo con un lote de `500 ML` y otro de `2 L` devuelve dos entradas;
- no existe ruta `DELETE`.

- [ ] **Step 10: Ejecutar**

Run: `npm run test:e2e -w apps/api -- reagents`
Expected: PASS, 10 pruebas.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/reagents apps/api/src/common/mappers/reagent.mapper.ts apps/api/src/app.module.ts apps/api/test/reagents.e2e-spec.ts
git commit -m "feat(api): add the reagents module with a seam for the composite filter"
```

---

## Task 8: Lotes como sub-recurso de reactivos

**Files:**
- Create: `apps/api/src/common/mappers/batch.mapper.ts`, `apps/api/src/reagents/batches.service.ts`, `apps/api/src/reagents/batches.controller.ts`, `apps/api/src/reagents/dto/create-batch.dto.ts`, `apps/api/src/reagents/dto/update-batch.dto.ts`, `apps/api/src/reagents/dto/list-batches-query.dto.ts`
- Modify: `apps/api/src/reagents/reagents.module.ts`
- Test: `apps/api/src/reagents/batches.service.spec.ts`, `apps/api/test/batches.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ReagentBatchDto`, `UNITS`.
- Produces: `toBatchDto(batch)`, `BatchesService.listForReagent(reagentId, query)`, `.create(reagentId, dto, actorId)`, `.update(id, dto)`, `.deactivate(id)`; rutas `GET /reagents/:id/batches`, `POST /reagents/:id/batches`, `PATCH /batches/:id`, `PATCH /batches/:id/deactivate`.

**Reglas que las pruebas deben fijar:**

- `currentStock` nace igual a `initialStock`. **No se acepta desde el cuerpo de la petición**: el stock solo cambia por consumos, y dejar que el cliente lo fije abriría un camino para descuadrar el inventario sin traza.
- `expirationDate`, si existe, debe ser posterior a `entryDate` (spec §4.3) — validado en el service, no solo en el DTO, porque son dos campos que se comparan entre sí.
- Un lote solo se crea sobre un reactivo **activo** y en una ubicación **activa**; si no, `BadRequestException`.
- `lotNumber` duplicado sobre el mismo reactivo activo devuelve **409** (lo impone el índice parcial de la Task 3, traducido por `PrismaExceptionFilter`).
- `unit` se valida contra `UNITS` de `@labtrack/shared`.
- `initialStock` llega como **string** decimal positivo, no como número.

- [ ] **Step 1: Escribir el spec unitario que falla**

`apps/api/src/reagents/batches.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { BatchesService } from './batches.service';

const activeReagent = { id: 'r1', active: true };
const activeLocation = { id: 'loc1', active: true };

function buildService(overrides: { reagent?: unknown; location?: unknown } = {}) {
  const prisma = {
    reagent: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.reagent === undefined ? activeReagent : overrides.reagent,
      ),
    },
    location: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.location === undefined ? activeLocation : overrides.location,
      ),
    },
    reagentBatch: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  return { service: new BatchesService(prisma as never), prisma };
}

const validDto = {
  lotNumber: 'L-1',
  entryDate: '2026-01-10',
  expirationDate: '2027-01-10',
  initialStock: '500.0000',
  unit: 'ML' as const,
  locationId: 'loc1',
};

describe('BatchesService.create', () => {
  it('sets currentStock from initialStock and never from the request', async () => {
    const { service, prisma } = buildService();
    prisma.reagentBatch.create.mockResolvedValue({});

    await service.create('r1', validDto as never, 'admin-1');

    expect(prisma.reagentBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          initialStock: '500.0000',
          currentStock: '500.0000',
          madeById: 'admin-1',
        }),
      }),
    );
  });

  it('rejects an expiration date at or before the entry date', async () => {
    const { service } = buildService();
    await expect(
      service.create('r1', { ...validDto, expirationDate: '2026-01-10' } as never, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a batch on an inactive reagent', async () => {
    const { service } = buildService({ reagent: { id: 'r1', active: false } });
    await expect(service.create('r1', validDto as never, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a batch in an inactive location', async () => {
    const { service } = buildService({ location: { id: 'loc1', active: false } });
    await expect(service.create('r1', validDto as never, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a batch with no expiration date', async () => {
    const { service, prisma } = buildService();
    prisma.reagentBatch.create.mockResolvedValue({});
    const { expirationDate, ...withoutExpiry } = validDto;
    await expect(
      service.create('r1', withoutExpiry as never, 'admin-1'),
    ).resolves.toBeDefined();
    expect(prisma.reagentBatch.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- batches.service`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: DTO y mapper**

`apps/api/src/reagents/dto/create-batch.dto.ts`:

```ts
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { UNITS, Unit } from '@labtrack/shared';

export class CreateBatchDto {
  @IsString()
  @MaxLength(60)
  lotNumber!: string;

  @IsDateString()
  entryDate!: string;

  @IsOptional()
  @IsDateString()
  expirationDate?: string;

  // A decimal string, not a number: Decimal(12,4) does not survive a round trip
  // through JavaScript's number type without losing precision.
  @Matches(/^\d{1,8}(\.\d{1,4})?$/, {
    message: 'initialStock must be a positive decimal with up to 4 decimal places',
  })
  initialStock!: string;

  @IsIn(UNITS)
  unit!: Unit;

  @IsUUID()
  locationId!: string;
}
```

`apps/api/src/reagents/dto/update-batch.dto.ts`:

```ts
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

// lotNumber, entryDate, initialStock and unit are facts about a physical
// delivery: they do not change. currentStock changes only through consumptions.
export class UpdateBatchDto {
  @IsOptional()
  @IsDateString()
  expirationDate?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
```

`apps/api/src/reagents/dto/list-batches-query.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const BATCH_SORT_COLUMNS = ['entryDate', 'expirationDate', 'lotNumber'] as const;

export class ListBatchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(BATCH_SORT_COLUMNS)
  sortBy: (typeof BATCH_SORT_COLUMNS)[number] = 'entryDate';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
```

`apps/api/src/common/mappers/batch.mapper.ts`:

```ts
import { ReagentBatchDto, Unit } from '@labtrack/shared';
import { Location, Reagent, ReagentBatch } from '../../prisma/client';

type BatchWithRelations = ReagentBatch & {
  reagent: Pick<Reagent, 'name'>;
  location: Pick<Location, 'name'>;
};

export function toBatchDto(batch: BatchWithRelations): ReagentBatchDto {
  return {
    id: batch.id,
    reagentId: batch.reagentId,
    reagentName: batch.reagent.name,
    lotNumber: batch.lotNumber,
    entryDate: batch.entryDate.toISOString(),
    expirationDate: batch.expirationDate ? batch.expirationDate.toISOString() : null,
    // Decimal is stringified rather than converted to a number: the whole point
    // of Decimal(12,4) is that it does not fit a JS number without loss.
    initialStock: batch.initialStock.toString(),
    currentStock: batch.currentStock.toString(),
    unit: batch.unit as Unit,
    locationId: batch.locationId,
    locationName: batch.location.name,
    active: batch.active,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Implementar el service**

`apps/api/src/reagents/batches.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PaginatedResponse,
  ReagentBatchDto,
  buildPaginatedResponse,
} from '@labtrack/shared';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toBatchDto } from '../common/mappers/batch.mapper';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { ListBatchesQueryDto } from './dto/list-batches-query.dto';

const WITH_RELATIONS = {
  reagent: { select: { name: true } },
  location: { select: { name: true } },
} as const;

@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForReagent(
    reagentId: string,
    query: ListBatchesQueryDto,
  ): Promise<PaginatedResponse<ReagentBatchDto>> {
    const where: Prisma.ReagentBatchWhereInput = { reagentId };
    if (!query.includeInactive) {
      where.active = true;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.reagentBatch.findMany({
        where,
        include: WITH_RELATIONS,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.reagentBatch.count({ where }),
    ]);

    return buildPaginatedResponse(data.map(toBatchDto), total, query.page, query.pageSize);
  }

  async create(
    reagentId: string,
    dto: CreateBatchDto,
    actorId: string,
  ): Promise<ReagentBatchDto> {
    const reagent = await this.prisma.reagent.findUnique({ where: { id: reagentId } });
    if (!reagent || !reagent.active) {
      throw new BadRequestException('Cannot add a batch to an inactive reagent');
    }

    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
    });
    if (!location || !location.active) {
      throw new BadRequestException('Cannot store a batch in an inactive location');
    }

    const entryDate = new Date(dto.entryDate);
    if (dto.expirationDate && new Date(dto.expirationDate) <= entryDate) {
      throw new BadRequestException('expirationDate must be later than entryDate');
    }

    const batch = await this.prisma.reagentBatch.create({
      data: {
        reagentId,
        locationId: dto.locationId,
        lotNumber: dto.lotNumber,
        entryDate,
        expirationDate: dto.expirationDate ? new Date(dto.expirationDate) : null,
        // currentStock is derived here and never read from the request: stock
        // moves only through consumptions, and letting a client set it would
        // open a way to change the inventory with no trace of who or why.
        initialStock: dto.initialStock,
        currentStock: dto.initialStock,
        unit: dto.unit,
        madeById: actorId,
      },
      include: WITH_RELATIONS,
    });

    return toBatchDto(batch);
  }

  async update(id: string, dto: UpdateBatchDto): Promise<ReagentBatchDto> {
    const current = await this.prisma.reagentBatch.findUniqueOrThrow({ where: { id } });

    if (dto.expirationDate && new Date(dto.expirationDate) <= current.entryDate) {
      throw new BadRequestException('expirationDate must be later than entryDate');
    }

    if (dto.locationId) {
      const location = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
      });
      if (!location || !location.active) {
        throw new BadRequestException('Cannot move a batch to an inactive location');
      }
    }

    const batch = await this.prisma.reagentBatch.update({
      where: { id },
      data: {
        expirationDate: dto.expirationDate ? new Date(dto.expirationDate) : undefined,
        locationId: dto.locationId,
      },
      include: WITH_RELATIONS,
    });

    return toBatchDto(batch);
  }

  async deactivate(id: string): Promise<ReagentBatchDto> {
    const batch = await this.prisma.reagentBatch.update({
      where: { id },
      data: { active: false },
      include: WITH_RELATIONS,
    });
    return toBatchDto(batch);
  }
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/api -- batches.service`
Expected: PASS, 5 pruebas.

- [ ] **Step 6: Controlador**

`apps/api/src/reagents/batches.controller.ts` expone las cuatro rutas. Ojo con las rutas: `GET` y `POST` cuelgan de `@Controller('reagents')` como sub-recurso (`:id/batches`), mientras que `PATCH /batches/:id` y `PATCH /batches/:id/deactivate` cuelgan de `@Controller('batches')`, tal como el spec §5.1 las lista. Son dos clases de controlador o una con rutas absolutas; declara lo que uses en `ReagentsModule`.

- [ ] **Step 7: El e2e**

`apps/api/test/batches.e2e-spec.ts` cubre:

- crear un lote sobre un reactivo activo devuelve 201, con `currentStock` igual a `initialStock`;
- enviar `currentStock` en el cuerpo devuelve **400** por `forbidNonWhitelisted` — es la prueba que impide descuadrar el stock desde el cliente;
- `lotNumber` repetido en el mismo reactivo activo devuelve **409**;
- el mismo `lotNumber` se acepta tras desactivar el lote anterior;
- `expirationDate` anterior a `entryDate` devuelve 400;
- `unit` inválida (`'litros'`) devuelve 400;
- `initialStock` como número (`500`) en vez de string devuelve 400;
- un no-ADMIN recibe 403 al crear y 200 al listar;
- desactivar un lote no borra la fila;
- no existe ruta `DELETE`.

- [ ] **Step 8: Ejecutar la suite completa**

Run: `npm run test -w apps/api && npm run test:e2e -w apps/api`
Expected: todo en verde, incluidas las suites de la Fase 1.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/reagents apps/api/src/common/mappers/batch.mapper.ts apps/api/test/batches.e2e-spec.ts
git commit -m "feat(api): add reagent batches with stock set only at creation"
```

---

## Task 9: Extraer las piezas compartidas del cliente

**Files:**
- Create: `apps/web/src/app/core/api/api.service.ts`, `apps/web/src/app/shared/paginated-store.ts`
- Modify: `apps/web/src/app/features/users/users.store.ts`
- Test: `apps/web/src/app/core/api/api.service.spec.ts`, `apps/web/src/app/shared/paginated-store.spec.ts`

**Interfaces:**
- Consumes: `API_URL`, `PaginatedResponse`.
- Produces: `ApiService.get<T>(path)`, `.getPage<T>(path, params)`, `.post<T>(path, body)`, `.patch<T>(path, body)`; la clase abstracta `PaginatedStore<T, F>` con señales `items`, `total`, `loading`, `error`, `page`, `pageSize`, `filters` y los métodos `setPage`, `setPageSize`, `setFilters`, `reload`.

**Por qué antes de las pantallas.** `UsersStore` construye a mano sus `HttpParams`, decodifica el contrato paginado y gestiona sus señales de carga y error. Copiar eso dos veces más deja el contrato `{data,total,page,pageSize,totalPages}` decodificado en tres sitios. Se extrae ahora, con una sola instancia de la que extraer, y las pantallas nuevas nacen ya encima.

- [ ] **Step 1: Escribir la prueba de ApiService que falla**

`apps/web/src/app/core/api/api.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { API_URL } from './api.config';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('builds the URL from the token and the path', () => {
    api.get('/locations').subscribe();
    http.expectOne('http://api.test/locations').flush({});
  });

  it('omits empty and undefined params instead of sending blanks', () => {
    api.getPage('/reagents', { page: 1, name: '', casNumber: undefined }).subscribe();
    const request = http.expectOne((req) => req.url === 'http://api.test/reagents');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.has('name')).toBe(false);
    expect(request.request.params.has('casNumber')).toBe(false);
    request.flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  });

  it('serialises booleans and numbers', () => {
    api.getPage('/reagents', { includeInactive: true, pageSize: 50 }).subscribe();
    const request = http.expectOne((req) => req.url === 'http://api.test/reagents');
    expect(request.request.params.get('includeInactive')).toBe('true');
    expect(request.request.params.get('pageSize')).toBe('50');
    request.flush({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 });
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/web -- api.service`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar ApiService**

`apps/web/src/app/core/api/api.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PaginatedResponse } from '@labtrack/shared';
import { API_URL } from './api.config';

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_URL);

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${path}`);
  }

  getPage<T>(path: string, params: QueryParams = {}): Observable<PaginatedResponse<T>> {
    return this.http.get<PaginatedResponse<T>>(`${this.baseUrl}${path}`, {
      params: toHttpParams(params),
    });
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body);
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${path}`, body);
  }
}

// An empty filter must not become `?name=`: the API would read that as a filter
// for the empty string rather than as no filter at all.
function toHttpParams(params: QueryParams): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    httpParams = httpParams.set(key, String(value));
  }
  return httpParams;
}
```

- [ ] **Step 4: Escribir la prueba de PaginatedStore que falla**

`apps/web/src/app/shared/paginated-store.spec.ts` define una subclase mínima sobre `/things` y verifica que:

- la primera carga pide `page=1` y `pageSize=20`;
- `setPage(3)` pide `page=3`;
- `setPageSize(50)` vuelve a `page=1`;
- `setFilters({ name: 'x' })` vuelve a `page=1` y envía `name=x`;
- un error deja `error()` en `true` y `loading()` en `false`;
- una recarga posterior con éxito deja `error()` en `false`.

- [ ] **Step 5: Implementar PaginatedStore**

`apps/web/src/app/shared/paginated-store.ts` — clase abstracta con las señales y la mecánica de recarga. Las subclases declaran su `path` y el tipo de sus filtros. Conserva las dos reglas que ya tenía `UsersStore`: cambiar filtros o tamaño de página vuelve a la página 1, y `error` se limpia al inicio de cada `reload()` para que no quede pegajoso.

- [ ] **Step 6: Refactorizar UsersStore encima**

`UsersStore` pasa a extender `PaginatedStore<UserDto, { search?: string }>`, conservando su API pública (`users`, `total`, `loading`, `error`, `page`, `pageSize`, `search`, `setPage`, `setPageSize`, `setSearch`, `create`, `deactivate`). `users` queda como alias de `items`.

**Las pruebas existentes de `users.store.spec.ts` no se tocan.** Son la red que demuestra que el refactor no cambió el comportamiento observable; si hay que modificarlas para que pasen, es señal de que sí lo cambió — para y repórtalo.

- [ ] **Step 7: Ejecutar**

Run: `npm run test -w apps/web`
Expected: PASS. Las pruebas previas de `UsersStore` siguen verdes sin cambios, más las nuevas de `ApiService` y `PaginatedStore`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/core/api apps/web/src/app/shared/paginated-store.ts apps/web/src/app/features/users/users.store.ts
git commit -m "refactor(web): extract the api client and the paginated store"
```

---

## Task 10: Pantalla de ubicaciones

**Files:**
- Create: `apps/web/src/app/features/locations/locations.store.ts`, `locations.component.ts`, `location-form.dialog.ts`, `i18n.es.ts`
- Modify: `apps/web/src/app/app.routes.ts`, `apps/web/src/app/app.component.ts`, `apps/web/src/app/features/home/home.component.ts`
- Test: `apps/web/src/app/features/locations/locations.store.spec.ts`

**Interfaces:**
- Consumes: `ApiService`, `PaginatedStore`, `LocationDto`, `authGuard`, `adminGuard`.
- Produces: `LocationsStore` (extiende `PaginatedStore<LocationDto, { search?: string }>`, expone `locations` como alias de `items`, más `create`, `update`, `deactivate`); ruta `/ubicaciones` con `canActivate: [authGuard, adminGuard]`.

Sigue exactamente la forma de la pantalla de usuarios: tabla paginada, búsqueda con 300 ms de retardo, diálogo de alta y edición, desactivación con confirmación, y todas las cadenas en `i18n.es.ts`. El store extiende `PaginatedStore` y no vuelve a construir `HttpParams` a mano.

Añade el enlace "Ubicaciones" a la barra superior, visible solo si `auth.isAdmin()`, y una tarjeta o enlace en la pantalla de inicio.

- [ ] **Step 1: Escribir la prueba del store, verla fallar, implementar el store.**
- [ ] **Step 2: Componente, diálogo, diccionario, ruta y enlaces.**
- [ ] **Step 3: Verificar** — `npm run test -w apps/web` y `npm run build -w apps/web` en verde.
- [ ] **Step 4: Commit** — `feat(web): add the locations screen`.

---

## Task 11: Pantalla de reactivos con filtros y lotes

**Files:**
- Create: `apps/web/src/app/features/reagents/reagents.store.ts`, `batches.store.ts`, `reagents.component.ts`, `reagent-form.dialog.ts`, `batch-form.dialog.ts`, `i18n.es.ts`
- Modify: `apps/web/src/app/app.routes.ts`, `apps/web/src/app/app.component.ts`, `apps/web/src/app/features/home/home.component.ts`
- Test: `apps/web/src/app/features/reagents/reagents.store.spec.ts`

**Interfaces:**
- Consumes: `ApiService`, `PaginatedStore`, `ReagentDto`, `ReagentBatchDto`, `LocationsStore` (para el desplegable de ubicaciones), `authGuard`.
- Produces: ruta `/reactivos` con `canActivate: [authGuard]`.

**Lo que las pruebas del store deben fijar:**

- El panel de filtros envía `name`, `casNumber` y `locationId`; un campo vacío **no** viaja como parámetro (lo garantiza `ApiService`, pero la prueba lo ancla desde el store).
- Cambiar cualquier filtro vuelve a la página 1.
- La búsqueda por nombre aplica 300 ms de retardo antes de escribir en el store.

**Lo que la interfaz debe cumplir:**

- La columna de existencias muestra `stockByUnit` como una línea por unidad (`500 mL`, `2 L`), **nunca sumadas entre sí**: sumar mililitros con litros inventa una cantidad sobre la que nadie puede actuar.
- La fila de un reactivo se expande —o abre un diálogo— con sus lotes: número, ingreso, vencimiento, existencia y ubicación.
- Un lote vencido o próximo a vencer se distingue visualmente. El umbral va en el diccionario, no incrustado en la plantilla.
- Alta de reactivo y alta de lote son diálogos separados, ambos visibles solo para administradores.
- Un `409` con `code: 'UNIQUE_CONSTRAINT'` al crear un lote muestra "Ese número de lote ya existe para este reactivo"; cualquier otro error muestra `COMMON_ES.unexpectedError`.

- [ ] **Step 1: Escribir la prueba del store, verla fallar, implementar el store.**
- [ ] **Step 2: Componentes, diálogos, diccionario, ruta y enlaces.**
- [ ] **Step 3: Verificar** — `npm run test -w apps/web` y `npm run build -w apps/web` en verde, con el bundle inicial por debajo de 500 kB.
- [ ] **Step 4: Recorrido manual completo.** Con el API y el cliente en marcha: entrar como administrador → crear una ubicación → crear un reactivo → añadirle dos lotes en unidades distintas → comprobar que la columna de existencias muestra las dos por separado → filtrar por nombre parcial y por CAS → desactivar el reactivo y comprobar que desaparece del listado y que sus lotes quedaron inactivos → entrar como usuario no administrador y comprobar que ve el listado pero no los botones de alta, y que `/ubicaciones` le rechaza al teclear la URL. **Reporta lo que observes, incluido lo que no funcione.**
- [ ] **Step 5: Commit** — `feat(web): add the reagents screen with filters and batches`.

---

## Verificación final de la fase

- [ ] `npm test` pasa en la raíz.
- [ ] `npm run test:e2e -w apps/api` pasa contra la base local.
- [ ] `npm run lint -w apps/api` termina con código 0.
- [ ] `grep -rn "\.delete\|deleteMany" apps/api/src` no devuelve nada.
- [ ] `grep -rn "@Delete" apps/api/src` no devuelve nada.
- [ ] `grep -rn "@prisma/client" apps/api/src` no devuelve nada: todo pasa por `src/prisma/client`.
- [ ] El recorrido manual de la Task 11 se completó y quedó reportado.
- [ ] El bundle inicial del cliente sigue por debajo del presupuesto de 500 kB.

Con esto, la Fase 3 (consumos) encuentra el modelo `Consumption` ya creado, la convención de transacciones fijada y el patrón de listado en dos pasos listo para reutilizar.
