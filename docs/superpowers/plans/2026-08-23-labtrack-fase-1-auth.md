# LabTrack — Plan de Implementación, Fase 1: Monorepo, Autenticación y Usuarios

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar funcionando de punta a punta el monorepo con inicio de sesión, gestión de usuarios por parte del administrador y los tres despliegues reales (Neon, Railway, Netlify).

**Architecture:** Monorepo con npm workspaces: `apps/api` (NestJS modular por capas sobre Prisma/PostgreSQL), `apps/web` (Angular standalone con signals y Angular Material) y `packages/shared` (tipos del contrato HTTP compartidos por ambos). La autenticación usa JWT sin refresh token, revalidando en cada petición que el usuario siga activo.

**Tech Stack:** Node 20+, npm workspaces, NestJS 11, Prisma, PostgreSQL (Neon), Passport-JWT, bcrypt, Zod, Angular (última versión) con Angular Material, Jest, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-23-labtrack-mvp-design.md`

## Global Constraints

Estas reglas aplican a **todas** las tareas de este plan y de los planes siguientes:

- **Idioma:** código, tablas, columnas, rutas, mensajes de log y commits en inglés. Toda cadena visible en la interfaz, en español.
- **Sin borrado físico:** ningún servicio usa `delete` ni `deleteMany` de Prisma. No existe ningún verbo HTTP `DELETE` en el API. La desactivación es `PATCH /:id/deactivate`.
- **Campo `active`:** todas las tablas lo tienen, `Boolean` con `@default(true)`.
- **Auditoría:** todas las tablas llevan `createdAt`, `updatedAt` y `madeById`. `madeById` jamás se lee del cuerpo de la petición; lo inyecta el servidor desde el JWT.
  - **Desviación deliberada respecto al spec §3.2:** el spec preveía un interceptor global que inyectara `madeById`. Este plan usa en su lugar el decorador `@CurrentUser()` en el controller, que pasa `actorId` como argumento explícito al service. La garantía es la misma —el valor sale del JWT y `forbidNonWhitelisted` rechaza con 400 cualquier `madeById` enviado por el cliente, lo que la Task 8 prueba explícitamente— pero la dependencia queda visible en la firma del método en vez de escondida en un interceptor que muta el cuerpo de la petición. Si en la Fase 2 el número de puntos de escritura hace repetitivo el patrón, se puede reconsiderar.
- **Cantidades:** `Decimal(12,4)`, nunca `Float` (aplica desde la Fase 2).
- **Contraseñas:** bcrypt con coste 12.
- **Paginación:** toda lista responde `{ data, total, page, pageSize, totalPages }`; `pageSize` máximo 100, por defecto 20.
- **JWT:** vigencia 8 h, firmado con `JWT_SECRET`.
- **Commits:** frecuentes, uno por tarea como mínimo, en inglés y con prefijo convencional (`feat:`, `test:`, `chore:`).

---

## Estructura de archivos de esta fase

```
package.json                      workspaces raíz, scripts agregados
docker-compose.test.yml           Postgres local para pruebas de integración
packages/shared/
  package.json                    @labtrack/shared
  tsconfig.json
  src/index.ts                    reexporta todo
  src/pagination.ts               PaginatedResponse<T>, PaginationQuery
  src/user.ts                     Role, UserDto, LoginRequest, LoginResponse, ...
apps/api/
  .env.example
  prisma/schema.prisma            enum Role, model User
  prisma/seed.ts                  administrador inicial
  src/main.ts                     bootstrap, CORS, ValidationPipe, filtro global
  src/app.module.ts
  src/config/env.ts               esquema Zod de variables de entorno
  src/health/health.controller.ts
  src/prisma/prisma.module.ts
  src/prisma/prisma.service.ts
  src/common/dto/pagination-query.dto.ts
  src/common/filters/prisma-exception.filter.ts
  src/common/decorators/public.decorator.ts
  src/common/decorators/roles.decorator.ts
  src/common/decorators/current-user.decorator.ts
  src/common/guards/jwt-auth.guard.ts
  src/common/guards/roles.guard.ts
  src/common/guards/password-change.guard.ts
  src/auth/{auth.module,auth.controller,auth.service}.ts
  src/auth/password.service.ts
  src/auth/strategies/jwt.strategy.ts
  src/auth/dto/{login.dto,change-password.dto}.ts
  src/users/{users.module,users.controller,users.service}.ts
  src/users/dto/{create-user.dto,update-user.dto,list-users-query.dto}.ts
  test/auth.e2e-spec.ts
  test/users.e2e-spec.ts
  test/utils/test-app.ts
apps/web/src/app/
  app.config.ts, app.routes.ts, app.component.ts
  core/auth/{auth.service,auth.interceptor,auth.guard,admin.guard}.ts
  core/api/api.config.ts
  shared/i18n/es.ts               diccionario de cadenas comunes
  features/login/login.component.ts
  features/profile/change-password.component.ts
  features/users/{users.store,users.component,user-form.dialog}.ts
  features/users/i18n.es.ts
netlify.toml, apps/web/public/_redirects
```

**Responsabilidad por archivo:** un servicio por dominio, un guard por regla, un diccionario de cadenas por feature. Ningún componente Angular consulta `HttpClient` directamente: siempre a través del servicio o store de su feature.

---

## Task 1: Monorepo y paquete compartido

**Files:**
- Create: `package.json`, `.gitignore`, `.nvmrc`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/pagination.ts`, `packages/shared/src/user.ts`
- Test: `packages/shared/src/pagination.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: paquete `@labtrack/shared` que exporta `Role`, `UserDto`, `LoginRequest`, `LoginResponse`, `ChangePasswordRequest`, `CreateUserRequest`, `UpdateUserRequest`, `PaginationQuery`, `PaginatedResponse<T>`, y la función `buildPaginatedResponse<T>(data, total, page, pageSize)`.

- [ ] **Step 1: Crear el package.json raíz con workspaces**

```json
{
  "name": "labtrack",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build:shared": "npm run build -w packages/shared",
    "test": "npm run test -w packages/shared && npm run test -w apps/api"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.14.0"
  }
}
```

Crear `.nvmrc` con el contenido `20` y `.gitignore` con:

```
node_modules/
dist/
.env
*.log
.angular/
coverage/
```

- [ ] **Step 2: Crear el paquete compartido**

`packages/shared/package.json`:

```json
{
  "name": "@labtrack/shared",
  "version": "1.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "declaration": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts"]
}
```

`packages/shared/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
};
```

- [ ] **Step 3: Escribir la prueba que falla**

`packages/shared/src/pagination.spec.ts`:

```ts
import { buildPaginatedResponse } from './pagination';

describe('buildPaginatedResponse', () => {
  it('calculates totalPages rounding up', () => {
    const result = buildPaginatedResponse(['a', 'b'], 21, 1, 20);
    expect(result).toEqual({
      data: ['a', 'b'],
      total: 21,
      page: 1,
      pageSize: 20,
      totalPages: 2,
    });
  });

  it('reports zero pages when there is no data', () => {
    const result = buildPaginatedResponse([], 0, 1, 20);
    expect(result.totalPages).toBe(0);
  });
});
```

- [ ] **Step 4: Ejecutar la prueba y verificar que falla**

Run: `npm install && npm run test -w packages/shared`
Expected: FAIL — "Cannot find module './pagination'".

- [ ] **Step 5: Implementar los tipos compartidos**

`packages/shared/src/pagination.ts`:

```ts
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResponse<T> {
  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
```

`packages/shared/src/user.ts`:

```ts
export type Role = 'ADMIN' | 'USER';

export interface UserDto {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: UserDto;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateUserRequest {
  username: string;
  fullName: string;
  password: string;
  role: Role;
}

export interface UpdateUserRequest {
  fullName?: string;
  role?: Role;
}
```

`packages/shared/src/index.ts`:

```ts
export * from './pagination';
export * from './user';
```

- [ ] **Step 6: Ejecutar la prueba y verificar que pasa**

Run: `npm run test -w packages/shared`
Expected: PASS, 2 pruebas.

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore .nvmrc packages/
git commit -m "chore: set up monorepo with shared contract package"
```

---

## Task 2: API NestJS con validación de entorno y health check

**Files:**
- Create: `apps/api/` (scaffolding de NestJS), `apps/api/src/config/env.ts`, `apps/api/src/health/health.controller.ts`, `apps/api/.env.example`
- Modify: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/src/config/env.spec.ts`, `apps/api/test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: `@labtrack/shared` (Task 1).
- Produces: `parseEnv(raw: Record<string, string | undefined>): Env` donde `Env = { DATABASE_URL: string; JWT_SECRET: string; JWT_EXPIRES_IN: string; CORS_ORIGIN: string; PORT: number }`. Endpoint `GET /health` → `{ status: 'ok' }`.

- [ ] **Step 1: Generar el proyecto NestJS**

```bash
npx @nestjs/cli@latest new api --directory apps/api --package-manager npm --skip-git --strict
npm install -w apps/api @nestjs/config zod @labtrack/shared
```

En `apps/api/package.json`, dejar `"name": "@labtrack/api"` para que el workspace lo resuelva sin ambigüedad.

- [ ] **Step 2: Escribir la prueba de validación de entorno que falla**

`apps/api/src/config/env.spec.ts`:

```ts
import { parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/labtrack',
  JWT_SECRET: 'a-secret-long-enough-for-signing',
  JWT_EXPIRES_IN: '8h',
  CORS_ORIGIN: 'http://localhost:4200',
  PORT: '3000',
};

describe('parseEnv', () => {
  it('returns a typed configuration when every variable is present', () => {
    expect(parseEnv(valid)).toEqual({ ...valid, PORT: 3000 });
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET, ...withoutSecret } = valid;
    expect(() => parseEnv(withoutSecret)).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT_SECRET is too short to be safe', () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- env.spec`
Expected: FAIL — "Cannot find module './env'".

- [ ] **Step 4: Implementar la validación de entorno**

`apps/api/src/config/env.ts`:

```ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:4200'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration -> ${details}`);
  }
  return result.data;
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/api -- env.spec`
Expected: PASS, 3 pruebas.

- [ ] **Step 6: Conectar la validación y el health check**

`apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
```

`apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv } from './config/env';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: parseEnv })],
  controllers: [HealthController],
})
export class AppModule {}
```

`apps/api/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }), credentials: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
```

`apps/api/.env.example`:

```
DATABASE_URL=postgresql://labtrack:labtrack@localhost:5432/labtrack
JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:4200
PORT=3000
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=change-me
```

- [ ] **Step 7: Escribir la prueba e2e del health check**

`apps/api/test/health.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });
});
```

- [ ] **Step 8: Ejecutar la prueba e2e**

Run: `cp apps/api/.env.example apps/api/.env && npm run test:e2e -w apps/api -- health`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): scaffold NestJS app with env validation and health check"
```

---

## Task 3: Prisma, modelo User y PrismaService

**Files:**
- Create: `apps/api/prisma/schema.prisma`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/prisma/prisma.module.ts`, `docker-compose.test.yml`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/utils/test-app.ts`, `apps/api/test/prisma.e2e-spec.ts`

**Interfaces:**
- Consumes: `parseEnv` (Task 2).
- Produces: `PrismaService` (extiende `PrismaClient`, implementa `OnModuleInit`), `PrismaModule` global, modelo `User` con los campos del spec §4, y el helper de pruebas `createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }>`.

- [ ] **Step 1: Levantar Postgres local para desarrollo y pruebas**

`docker-compose.test.yml` en la raíz:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: labtrack
      POSTGRES_PASSWORD: labtrack
      POSTGRES_DB: labtrack
    ports:
      - '5432:5432'
```

Run: `docker compose -f docker-compose.test.yml up -d`

- [ ] **Step 2: Instalar Prisma y definir el esquema**

```bash
npm install -w apps/api @prisma/client
npm install -w apps/api -D prisma
```

`apps/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  USER
}

model User {
  id                 String   @id @default(uuid())
  username           String   @unique
  passwordHash       String
  fullName           String
  role               Role     @default(USER)
  mustChangePassword Boolean  @default(true)
  active             Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  madeById String?
  madeBy   User?   @relation("UserCreatedBy", fields: [madeById], references: [id])
  created  User[]  @relation("UserCreatedBy")

  @@index([active])
}
```

`madeById` es opcional solo en `User`: el administrador semilla no tiene creador. En el resto de tablas (Fase 2) es obligatorio.

- [ ] **Step 3: Generar la migración**

Run:

```bash
npx prisma migrate dev --name init_user --schema apps/api/prisma/schema.prisma
```

Expected: crea `apps/api/prisma/migrations/<timestamp>_init_user/` y genera el cliente.

- [ ] **Step 4: Escribir la prueba que falla**

`apps/api/test/prisma.e2e-spec.ts`:

```ts
import { createTestApp } from './utils/test-app';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PrismaService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('connects to the database and reads the user table', async () => {
    await expect(prisma.user.count()).resolves.toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 5: Ejecutar y verificar que falla**

Run: `npm run test:e2e -w apps/api -- prisma`
Expected: FAIL — no existe `./utils/test-app` ni `PrismaService`.

- [ ] **Step 6: Implementar PrismaService, PrismaModule y el helper de pruebas**

`apps/api/src/prisma/prisma.service.ts`:

```ts
import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
```

`apps/api/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Añadir `PrismaModule` a los `imports` de `AppModule`.

`apps/api/test/utils/test-app.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
}
```

`resetDatabase` usa `TRUNCATE` en SQL crudo: es una utilidad exclusiva de pruebas y no viola la regla de no borrado, que aplica al código de producción.

- [ ] **Step 7: Ejecutar y verificar que pasa**

Run: `npm run test:e2e -w apps/api -- prisma`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api docker-compose.test.yml
git commit -m "feat(api): add Prisma with User model and test harness"
```

---

## Task 4: Infraestructura común (paginación, filtro de errores, decoradores)

**Files:**
- Create: `apps/api/src/common/dto/pagination-query.dto.ts`, `apps/api/src/common/filters/prisma-exception.filter.ts`, `apps/api/src/common/decorators/public.decorator.ts`, `apps/api/src/common/decorators/roles.decorator.ts`, `apps/api/src/common/decorators/current-user.decorator.ts`
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/src/common/dto/pagination-query.dto.spec.ts`, `apps/api/src/common/filters/prisma-exception.filter.spec.ts`

**Interfaces:**
- Consumes: `buildPaginatedResponse` (Task 1).
- Produces: `PaginationQueryDto` con `page`, `pageSize`, `sortOrder` y el getter `skip`; `PrismaExceptionFilter`; decoradores `@Public()`, `@Roles(...roles)`, `@CurrentUser()`; constante `IS_PUBLIC_KEY`; interfaz `AuthenticatedUser { id: string; username: string; role: Role; mustChangePassword: boolean }`.

- [ ] **Step 1: Escribir las pruebas que fallan**

`apps/api/src/common/dto/pagination-query.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

async function build(raw: Record<string, unknown>) {
  const dto = plainToInstance(PaginationQueryDto, raw, { enableImplicitConversion: true });
  return { dto, errors: await validate(dto) };
}

describe('PaginationQueryDto', () => {
  it('defaults to page 1 with 20 items', async () => {
    const { dto, errors } = await build({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
    expect(dto.skip).toBe(0);
  });

  it('computes skip from page and pageSize', async () => {
    const { dto } = await build({ page: 3, pageSize: 10 });
    expect(dto.skip).toBe(20);
  });

  it('rejects a pageSize above 100', async () => {
    const { errors } = await build({ pageSize: 500 });
    expect(errors).not.toHaveLength(0);
  });

  it('rejects a page below 1', async () => {
    const { errors } = await build({ page: 0 });
    expect(errors).not.toHaveLength(0);
  });
});
```

`apps/api/src/common/filters/prisma-exception.filter.spec.ts`:

```ts
import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function hostWith(json: jest.Mock, status: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
}

describe('PrismaExceptionFilter', () => {
  it('maps a unique constraint violation to 409', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });

    new PrismaExceptionFilter().catch(error, hostWith(json, status));

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNIQUE_CONSTRAINT' }));
  });

  it('maps a missing record to 404', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const error = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: '5.0.0',
    });

    new PrismaExceptionFilter().catch(error, hostWith(json, status));

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `npm run test -w apps/api -- common`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar el DTO de paginación**

```bash
npm install -w apps/api class-validator class-transformer
```

`apps/api/src/common/dto/pagination-query.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
}
```

`sortBy` no vive aquí: cada módulo declara el suyo con su propia lista blanca de columnas, porque una lista blanca genérica no existe.

- [ ] **Step 4: Implementar el filtro de excepciones**

`apps/api/src/common/filters/prisma-exception.filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    this.logger.warn(`Prisma error ${exception.code}: ${exception.message}`);

    switch (exception.code) {
      case 'P2002':
        response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          code: 'UNIQUE_CONSTRAINT',
        });
        return;
      case 'P2025':
        response.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
        });
        return;
      default:
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'INTERNAL_ERROR',
        });
    }
  }
}
```

La respuesta lleva un `code` estable y ningún texto de Prisma: el cliente traduce ese código al español.

- [ ] **Step 5: Implementar los decoradores**

`apps/api/src/common/decorators/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`apps/api/src/common/decorators/roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

`apps/api/src/common/decorators/current-user.decorator.ts`:

```ts
import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: Role;
  mustChangePassword: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest().user,
);
```

- [ ] **Step 6: Registrar el filtro globalmente**

En `apps/api/src/main.ts`, después de `useGlobalPipes`:

```ts
app.useGlobalFilters(new PrismaExceptionFilter());
```

- [ ] **Step 7: Ejecutar y verificar que pasan**

Run: `npm run test -w apps/api -- common`
Expected: PASS, 6 pruebas.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common apps/api/src/main.ts
git commit -m "feat(api): add pagination dto, prisma exception filter and decorators"
```

---

## Task 5: Hash de contraseñas y AuthService.login

**Files:**
- Create: `apps/api/src/auth/password.service.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/dto/login.dto.ts`
- Test: `apps/api/src/auth/password.service.spec.ts`, `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (Task 3), `Env` (Task 2).
- Produces: `PasswordService.hash(plain: string): Promise<string>` y `PasswordService.verify(plain: string, hash: string): Promise<boolean>`; `AuthService.login(dto: LoginDto): Promise<LoginResponse>`; `AuthService.toUserDto(user: User): UserDto`.

- [ ] **Step 1: Escribir la prueba del servicio de contraseñas**

`apps/api/src/auth/password.service.spec.ts`:

```ts
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces a hash that is not the plain text', async () => {
    const hash = await service.hash('super-secret');
    expect(hash).not.toBe('super-secret');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('verifies a correct password', async () => {
    const hash = await service.hash('super-secret');
    await expect(service.verify('super-secret', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('super-secret');
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- password.service`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar PasswordService**

```bash
npm install -w apps/api bcrypt @nestjs/jwt @nestjs/passport passport passport-jwt
npm install -w apps/api -D @types/bcrypt @types/passport-jwt
```

`apps/api/src/auth/password.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/api -- password.service`
Expected: PASS, 3 pruebas. Puede tardar unos segundos: bcrypt con coste 12 es lento a propósito.

- [ ] **Step 5: Escribir la prueba de AuthService con Prisma simulado**

`apps/api/src/auth/auth.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

const activeUser = {
  id: 'user-1',
  username: 'ana',
  passwordHash: 'hashed',
  fullName: 'Ana Ruiz',
  role: 'USER' as const,
  mustChangePassword: false,
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  madeById: null,
};

function buildService(overrides: {
  user?: typeof activeUser | null;
  passwordMatches?: boolean;
}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(overrides.user ?? null),
      update: jest.fn(),
    },
  };
  const passwords = {
    verify: jest.fn().mockResolvedValue(overrides.passwordMatches ?? true),
    hash: jest.fn().mockResolvedValue('new-hash'),
  } as unknown as PasswordService;
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };

  const service = new AuthService(prisma as never, passwords, jwt as never);
  return { service, prisma, jwt };
}

describe('AuthService.login', () => {
  it('returns a token and the user profile on valid credentials', async () => {
    const { service, jwt } = buildService({ user: activeUser });

    const result = await service.login({ username: 'ana', password: 'right' });

    expect(result.accessToken).toBe('signed-token');
    expect(result.user).toEqual(
      expect.objectContaining({ id: 'user-1', username: 'ana', role: 'USER' }),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'user-1', username: 'ana', role: 'USER' });
  });

  it('never exposes the password hash', async () => {
    const { service } = buildService({ user: activeUser });
    const result = await service.login({ username: 'ana', password: 'right' });
    expect(JSON.stringify(result)).not.toContain('hashed');
  });

  it('rejects an unknown username', async () => {
    const { service } = buildService({ user: null });
    await expect(service.login({ username: 'ghost', password: 'x' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a wrong password', async () => {
    const { service } = buildService({ user: activeUser, passwordMatches: false });
    await expect(service.login({ username: 'ana', password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a deactivated user', async () => {
    const { service } = buildService({ user: { ...activeUser, active: false } });
    await expect(service.login({ username: 'ana', password: 'right' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 6: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- auth.service`
Expected: FAIL — `AuthService` no existe.

- [ ] **Step 7: Implementar el DTO y AuthService**

`apps/api/src/auth/dto/login.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
```

`apps/api/src/auth/auth.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { LoginResponse, UserDto } from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });

    // Se verifica el estado y la contraseña con el mismo error para no revelar
    // si el usuario existe ni si está desactivado.
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await this.passwords.verify(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    return { accessToken, user: this.toUserDto(user) };
  }

  toUserDto(user: User): UserDto {
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      active: user.active,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
```

`apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { Env } from '../config/env';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }) },
      }),
    }),
  ],
  providers: [AuthService, PasswordService],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
```

- [ ] **Step 8: Ejecutar y verificar que pasan**

Run: `npm run test -w apps/api -- auth.service`
Expected: PASS, 5 pruebas.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): add password hashing and login service"
```

---

## Task 6: Estrategia JWT y guards globales

**Files:**
- Create: `apps/api/src/auth/strategies/jwt.strategy.ts`, `apps/api/src/common/guards/jwt-auth.guard.ts`, `apps/api/src/common/guards/roles.guard.ts`
- Modify: `apps/api/src/auth/auth.module.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/src/common/guards/roles.guard.spec.ts`, `apps/api/src/auth/strategies/jwt.strategy.spec.ts`

**Interfaces:**
- Consumes: `IS_PUBLIC_KEY`, `ROLES_KEY`, `AuthenticatedUser` (Task 4); `PrismaService` (Task 3).
- Produces: `JwtStrategy.validate(payload)` que devuelve `AuthenticatedUser` y lanza `UnauthorizedException` si el usuario ya no está activo; `JwtAuthGuard` registrado como `APP_GUARD`; `RolesGuard` registrado como `APP_GUARD`.

- [ ] **Step 1: Escribir la prueba de la estrategia**

`apps/api/src/auth/strategies/jwt.strategy.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

const payload = { sub: 'user-1', username: 'ana', role: 'USER' as const };

function buildStrategy(user: unknown) {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  const config = { get: jest.fn().mockReturnValue('a-secret-long-enough-for-signing') };
  return new JwtStrategy(config as never, prisma as never);
}

describe('JwtStrategy.validate', () => {
  it('returns the authenticated user for an active account', async () => {
    const strategy = buildStrategy({
      id: 'user-1',
      username: 'ana',
      role: 'USER',
      mustChangePassword: false,
      active: true,
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'user-1',
      username: 'ana',
      role: 'USER',
      mustChangePassword: false,
    });
  });

  it('rejects a token whose user was deactivated', async () => {
    const strategy = buildStrategy({
      id: 'user-1',
      username: 'ana',
      role: 'USER',
      mustChangePassword: false,
      active: false,
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose user no longer exists', async () => {
    const strategy = buildStrategy(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Escribir la prueba de RolesGuard**

`apps/api/src/common/guards/roles.guard.spec.ts`:

```ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function contextFor(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: string[] | undefined) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no role is required', () => {
    expect(guardRequiring(undefined).canActivate(contextFor({ role: 'USER' }))).toBe(true);
  });

  it('allows a user whose role is required', () => {
    expect(guardRequiring(['ADMIN']).canActivate(contextFor({ role: 'ADMIN' }))).toBe(true);
  });

  it('blocks a user whose role is not required', () => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextFor({ role: 'USER' }))).toThrow(
      ForbiddenException,
    );
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que fallan**

Run: `npm run test -w apps/api -- jwt.strategy roles.guard`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 4: Implementar la estrategia JWT**

`apps/api/src/auth/strategies/jwt.strategy.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Env } from '../../config/env';

export interface JwtPayload {
  sub: string;
  username: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  // Se relee el usuario en cada petición: desactivar a alguien lo expulsa de
  // inmediato en lugar de esperar a que expire su token.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, mustChangePassword: true, active: true },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('Account is no longer active');
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
```

- [ ] **Step 5: Implementar los guards**

`apps/api/src/common/guards/jwt-auth.guard.ts`:

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }
}
```

`apps/api/src/common/guards/roles.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const user: AuthenticatedUser | undefined = context.switchToHttp().getRequest().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
```

- [ ] **Step 6: Registrar los guards globalmente**

Añadir `JwtStrategy` a los `providers` de `AuthModule` e importar `PassportModule`. En `AppModule`:

```ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

// dentro de providers:
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

El orden importa: `JwtAuthGuard` primero, porque `RolesGuard` necesita el usuario ya resuelto en la petición.

Marcar `HealthController` con `@Public()` para que el health check siga respondiendo sin token.

- [ ] **Step 7: Ejecutar y verificar que pasan**

Run: `npm run test -w apps/api -- jwt.strategy roles.guard` y luego `npm run test:e2e -w apps/api -- health`
Expected: PASS en ambos; el health check sigue devolviendo 200 gracias a `@Public()`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): add jwt strategy with global auth and roles guards"
```

---

## Task 7: Controlador de autenticación y cambio de contraseña

**Files:**
- Create: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/dto/change-password.dto.ts`, `apps/api/src/common/guards/password-change.guard.ts`
- Modify: `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `AuthService`, `PasswordService` (Task 5); guards y decoradores (Tasks 4 y 6); `createTestApp`, `resetDatabase` (Task 3).
- Produces: `POST /auth/login`, `GET /auth/me`, `PATCH /auth/password`; `AuthService.changePassword(userId, dto): Promise<void>`; `PasswordChangeGuard` que bloquea cualquier ruta distinta de `/auth/me` y `/auth/password` mientras `mustChangePassword` sea verdadero.

- [ ] **Step 1: Escribir las pruebas e2e que fallan**

`apps/api/test/auth.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Auth (e2e)', () => {
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
    await resetDatabase(prisma);
    await prisma.user.create({
      data: {
        username: 'ana',
        fullName: 'Ana Ruiz',
        passwordHash: await passwords.hash('initial-password'),
        role: 'USER',
        mustChangePassword: false,
      },
    });
  });

  async function login(username: string, password: string) {
    return request(app.getHttpServer()).post('/auth/login').send({ username, password });
  }

  it('logs in with valid credentials and returns a token', async () => {
    const response = await login('ana', 'initial-password').expect(201);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user.username).toBe('ana');
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it('rejects invalid credentials with 401', async () => {
    await login('ana', 'wrong-password').expect(401);
  });

  it('rejects a request to /auth/me without a token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('returns the profile of the authenticated user', async () => {
    const { body } = await login('ana', 'initial-password');
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(response.body.username).toBe('ana');
  });

  it('changes the password and clears mustChangePassword', async () => {
    await prisma.user.update({ where: { username: 'ana' }, data: { mustChangePassword: true } });
    const { body } = await login('ana', 'initial-password');

    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ currentPassword: 'initial-password', newPassword: 'a-brand-new-password' })
      .expect(200);

    await login('ana', 'initial-password').expect(401);
    const response = await login('ana', 'a-brand-new-password').expect(201);
    expect(response.body.user.mustChangePassword).toBe(false);
  });

  it('rejects a password change with the wrong current password', async () => {
    const { body } = await login('ana', 'initial-password');
    await request(app.getHttpServer())
      .patch('/auth/password')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ currentPassword: 'not-my-password', newPassword: 'a-brand-new-password' })
      .expect(401);
  });

  it('blocks other endpoints while the user must change the password', async () => {
    await prisma.user.update({ where: { username: 'ana' }, data: { mustChangePassword: true } });
    const { body } = await login('ana', 'initial-password');

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(403);
  });

  it('rejects a token belonging to a deactivated user', async () => {
    const { body } = await login('ana', 'initial-password');
    await prisma.user.update({ where: { username: 'ana' }, data: { active: false } });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(401);
  });
});
```

La penúltima prueba de la lista (la que llama a `/users`) se apoya en la ruta de la Task 8. Hasta entonces devolvería 404 en lugar de 403: se deja marcada con `it.skip` y se reactiva en la Task 8, cuyo Step 1 lo recuerda explícitamente.

- [ ] **Step 2: Ejecutar y verificar que fallan**

Run: `npm run test:e2e -w apps/api -- auth`
Expected: FAIL — no existe la ruta `/auth/login`.

- [ ] **Step 3: Implementar el DTO de cambio de contraseña**

`apps/api/src/auth/dto/change-password.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
```

- [ ] **Step 4: Añadir changePassword a AuthService**

En `apps/api/src/auth/auth.service.ts`:

```ts
async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await this.passwords.verify(dto.currentPassword, user.passwordHash))) {
    throw new UnauthorizedException('Invalid credentials');
  }

  await this.prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await this.passwords.hash(dto.newPassword),
      mustChangePassword: false,
    },
  });
}

async findProfile(userId: string): Promise<UserDto> {
  const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return this.toUserDto(user);
}
```

- [ ] **Step 5: Implementar el guard de cambio obligatorio**

`apps/api/src/common/guards/password-change.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

const ALLOWED_PATHS = ['/auth/me', '/auth/password'];

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;

    if (!user?.mustChangePassword) {
      return true;
    }
    if (ALLOWED_PATHS.includes(request.path)) {
      return true;
    }
    throw new ForbiddenException('Password change required');
  }
}
```

Registrarlo en `AppModule` como tercer `APP_GUARD`, después de `JwtAuthGuard` y `RolesGuard`.

- [ ] **Step 6: Implementar el controlador**

`apps/api/src/auth/auth.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { LoginResponse, UserDto } from '@labtrack/shared';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserDto> {
    return this.auth.findProfile(user.id);
  }

  @Patch('password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(user.id, dto);
  }
}
```

Registrar `AuthController` en `AuthModule` e importar `AuthModule` en `AppModule`.

- [ ] **Step 7: Ejecutar las pruebas e2e**

Run: `npm run test:e2e -w apps/api -- auth`
Expected: PASS (7 pruebas activas, 1 marcada como skip hasta la Task 8).

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add auth endpoints with forced password change"
```

---

## Task 8: Módulo de usuarios (solo administrador)

**Files:**
- Create: `apps/api/src/users/users.service.ts`, `apps/api/src/users/users.controller.ts`, `apps/api/src/users/users.module.ts`, `apps/api/src/users/dto/create-user.dto.ts`, `apps/api/src/users/dto/update-user.dto.ts`, `apps/api/src/users/dto/list-users-query.dto.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/auth.e2e-spec.ts` (reactivar la prueba en skip)
- Test: `apps/api/src/users/users.service.spec.ts`, `apps/api/test/users.e2e-spec.ts`

**Interfaces:**
- Consumes: `PaginationQueryDto` (Task 4), `PasswordService`, `AuthService.toUserDto` (Task 5), guards (Task 6).
- Produces: `UsersService.list(query)`, `UsersService.create(dto, actorId)`, `UsersService.update(id, dto)`, `UsersService.deactivate(id, actorId)`; rutas `GET /users`, `POST /users`, `PATCH /users/:id`, `PATCH /users/:id/deactivate`.

- [ ] **Step 1: Reactivar la prueba pendiente de la Task 7**

En `apps/api/test/auth.e2e-spec.ts`, cambiar `it.skip('blocks other endpoints...` por `it('blocks other endpoints...`. Ahora `/users` existe y el guard puede devolver 403 en lugar de 404.

- [ ] **Step 2: Escribir la prueba unitaria del servicio**

`apps/api/src/users/users.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

function buildService() {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations as Promise<unknown>[])),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed') };
  const service = new UsersService(prisma as never, passwords as never);
  return { service, prisma, passwords };
}

describe('UsersService', () => {
  it('excludes inactive users unless explicitly requested', async () => {
    const { service, prisma } = buildService();
    await service.list({ page: 1, pageSize: 20, sortOrder: 'desc', skip: 0 } as never);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('includes inactive users when includeInactive is set', async () => {
    const { service, prisma } = buildService();
    await service.list({
      page: 1,
      pageSize: 20,
      sortOrder: 'desc',
      skip: 0,
      includeInactive: true,
    } as never);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('hashes the password before storing a new user', async () => {
    const { service, prisma, passwords } = buildService();
    prisma.user.create.mockResolvedValue({
      id: 'u2',
      username: 'luis',
      fullName: 'Luis Paz',
      role: 'USER',
      mustChangePassword: true,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash: 'hashed',
      madeById: 'admin-1',
    });

    await service.create(
      { username: 'luis', fullName: 'Luis Paz', password: 'temporary1', role: 'USER' },
      'admin-1',
    );

    expect(passwords.hash).toHaveBeenCalledWith('temporary1');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passwordHash: 'hashed',
          mustChangePassword: true,
          madeById: 'admin-1',
        }),
      }),
    );
    expect(prisma.user.create.mock.calls[0][0].data.password).toBeUndefined();
  });

  it('refuses to deactivate the account performing the request', async () => {
    const { service } = buildService();
    await expect(service.deactivate('admin-1', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deactivates instead of deleting', async () => {
    const { service, prisma } = buildService();
    prisma.user.update.mockResolvedValue({
      id: 'u2',
      username: 'luis',
      fullName: 'Luis Paz',
      role: 'USER',
      mustChangePassword: false,
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash: 'hashed',
      madeById: 'admin-1',
    });

    await service.deactivate('u2', 'admin-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { active: false },
    });
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `npm run test -w apps/api -- users.service`
Expected: FAIL — `UsersService` no existe.

- [ ] **Step 4: Implementar los DTO**

`apps/api/src/users/dto/create-user.dto.ts`:

```ts
import { IsIn, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @Matches(/^[a-z0-9._-]{3,32}$/, { message: 'username must be 3-32 lowercase characters' })
  username!: string;

  @IsString()
  @MinLength(3)
  fullName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(['ADMIN', 'USER'])
  role!: Role;
}
```

`apps/api/src/users/dto/update-user.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  fullName?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'USER'])
  role?: Role;
}
```

El nombre de usuario no se puede cambiar: es la identidad con la que se firmaron los tokens y con la que se relacionan los registros de auditoría.

`apps/api/src/users/dto/list-users-query.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const USER_SORT_COLUMNS = ['username', 'fullName', 'role', 'createdAt'] as const;

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(USER_SORT_COLUMNS)
  sortBy: (typeof USER_SORT_COLUMNS)[number] = 'createdAt';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
```

`sortBy` se valida contra `USER_SORT_COLUMNS`: sin esa lista blanca, el parámetro llegaría crudo a `orderBy` de Prisma.

- [ ] **Step 5: Implementar el servicio**

`apps/api/src/users/users.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PaginatedResponse, UserDto, buildPaginatedResponse } from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<PaginatedResponse<UserDto>> {
    const where: Prisma.UserWhereInput = {};
    if (!query.includeInactive) {
      where.active = true;
    }
    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // El conteo y la página salen de la misma transacción para que el total
    // siempre corresponda a los datos mostrados.
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResponse(data.map(toUserDto), total, query.page, query.pageSize);
  }

  async create(dto: CreateUserDto, actorId: string): Promise<UserDto> {
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        fullName: dto.fullName,
        role: dto.role,
        passwordHash: await this.passwords.hash(dto.password),
        mustChangePassword: true,
        madeById: actorId,
      },
    });
    return toUserDto(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDto> {
    const user = await this.prisma.user.update({ where: { id }, data: { ...dto } });
    return toUserDto(user);
  }

  async deactivate(id: string, actorId: string): Promise<UserDto> {
    if (id === actorId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.prisma.user.update({ where: { id }, data: { active: false } });
    return toUserDto(user);
  }
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
```

`toUserDto` se extrae aquí como función libre y `AuthService.toUserDto` pasa a delegar en ella, para que exista una sola definición del mapeo `User → UserDto`. Actualizar `auth.service.ts` en consecuencia.

- [ ] **Step 6: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/api -- users.service`
Expected: PASS, 5 pruebas.

- [ ] **Step 7: Implementar el controlador y el módulo**

`apps/api/src/users/users.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PaginatedResponse, UserDto } from '@labtrack/shared';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersQueryDto): Promise<PaginatedResponse<UserDto>> {
    return this.users.list(query);
  }

  @Post()
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserDto> {
    return this.users.create(dto, actor.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    return this.users.update(id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserDto> {
    return this.users.deactivate(id, actor.id);
  }
}
```

`apps/api/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

Importar `UsersModule` en `AppModule`.

- [ ] **Step 8: Escribir la prueba e2e de permisos**

`apps/api/test/users.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, resetDatabase } from './utils/test-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Users (e2e)', () => {
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
    await resetDatabase(prisma);
    const passwordHash = await passwords.hash('initial-password');
    await prisma.user.createMany({
      data: [
        { username: 'admin', fullName: 'Admin', passwordHash, role: 'ADMIN', mustChangePassword: false },
        { username: 'ana', fullName: 'Ana Ruiz', passwordHash, role: 'USER', mustChangePassword: false },
      ],
    });
  });

  async function tokenFor(username: string): Promise<string> {
    const { body } = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body.accessToken;
  }

  it('lets an admin list users with pagination metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/users?page=1&pageSize=1')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.total).toBe(2);
    expect(response.body.totalPages).toBe(2);
  });

  it('blocks a non-admin from listing users', async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${await tokenFor('ana')}`)
      .expect(403);
  });

  it('creates a user who must change the password on first login', async () => {
    const response = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ username: 'luis', fullName: 'Luis Paz', password: 'temporary1', role: 'USER' })
      .expect(201);

    expect(response.body.mustChangePassword).toBe(true);
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('rejects a duplicated username with 409', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({ username: 'ana', fullName: 'Otra Ana', password: 'temporary1', role: 'USER' })
      .expect(409);
  });

  it('rejects unknown fields in the payload', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .send({
        username: 'luis',
        fullName: 'Luis Paz',
        password: 'temporary1',
        role: 'USER',
        madeById: 'forged-id',
      })
      .expect(400);
  });

  it('deactivates a user without deleting the row', async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });

    await request(app.getHttpServer())
      .patch(`/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(200);

    const stored = await prisma.user.findUnique({ where: { id: target.id } });
    expect(stored?.active).toBe(false);
  });

  it('exposes no DELETE route for users', async () => {
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });
    await request(app.getHttpServer())
      .delete(`/users/${target.id}`)
      .set('Authorization', `Bearer ${await tokenFor('admin')}`)
      .expect(404);
  });
});
```

La prueba de `madeById` es la que demuestra que el cliente no puede falsificar la autoría: `forbidNonWhitelisted` la rechaza con 400.

- [ ] **Step 9: Ejecutar toda la suite e2e**

Run: `npm run test:e2e -w apps/api`
Expected: PASS — health, prisma, auth (8 pruebas, ninguna en skip) y users (7 pruebas).

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): add admin-only users module with logical deactivation"
```

---

## Task 9: Semilla del administrador inicial

**Files:**
- Create: `apps/api/prisma/seed.ts`
- Modify: `apps/api/package.json` (bloque `prisma.seed` y script `db:seed`)
- Test: `apps/api/test/seed.e2e-spec.ts`

**Interfaces:**
- Consumes: `PasswordService` (Task 5), modelo `User` (Task 3).
- Produces: `seedAdmin(prisma: PrismaClient, env: { username: string; password: string }): Promise<void>`, idempotente.

- [ ] **Step 1: Escribir la prueba que falla**

`apps/api/test/seed.e2e-spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { seedAdmin } from '../prisma/seed';

describe('seedAdmin', () => {
  const prisma = new PrismaClient();

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the admin with a forced password change', async () => {
    await seedAdmin(prisma, { username: 'admin', password: 'seed-password' });

    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(admin.role).toBe('ADMIN');
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.passwordHash).not.toBe('seed-password');
  });

  it('is idempotent and does not overwrite an existing password', async () => {
    await seedAdmin(prisma, { username: 'admin', password: 'seed-password' });
    const first = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });

    await seedAdmin(prisma, { username: 'admin', password: 'a-different-password' });

    const second = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
    expect(await prisma.user.count()).toBe(1);
    expect(second.passwordHash).toBe(first.passwordHash);
  });
});
```

La segunda prueba fija una decisión importante: volver a ejecutar la semilla no reescribe la contraseña de un administrador que ya la cambió.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test:e2e -w apps/api -- seed`
Expected: FAIL — `../prisma/seed` no existe.

- [ ] **Step 3: Implementar la semilla**

`apps/api/prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function seedAdmin(
  prisma: PrismaClient,
  env: { username: string; password: string },
): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { username: env.username } });
  if (existing) {
    return;
  }

  await prisma.user.create({
    data: {
      username: env.username,
      fullName: 'Administrador',
      passwordHash: await bcrypt.hash(env.password, SALT_ROUNDS),
      role: 'ADMIN',
      mustChangePassword: true,
    },
  });
}

async function main(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error('SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD are required to seed');
  }

  const prisma = new PrismaClient();
  try {
    await seedAdmin(prisma, { username, password });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
```

En `apps/api/package.json`:

```json
"prisma": { "seed": "ts-node prisma/seed.ts" },
"scripts": { "db:seed": "prisma db seed" }
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test:e2e -w apps/api -- seed`
Expected: PASS, 2 pruebas.

- [ ] **Step 5: Ejecutar la semilla en la base local**

Run: `npm run db:seed -w apps/api`
Expected: crea el usuario administrador definido en `apps/api/.env`.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add idempotent admin seed script"
```

---

## Task 10: Cliente Angular, sesión y pantalla de inicio de sesión

**Files:**
- Create: `apps/web/` (scaffolding Angular), `apps/web/src/app/core/api/api.config.ts`, `apps/web/src/app/core/auth/auth.service.ts`, `apps/web/src/app/core/auth/auth.interceptor.ts`, `apps/web/src/app/core/auth/auth.guard.ts`, `apps/web/src/app/core/auth/admin.guard.ts`, `apps/web/src/app/features/login/login.component.ts`, `apps/web/src/app/shared/i18n/es.ts`
- Modify: `apps/web/src/app/app.config.ts`, `apps/web/src/app/app.routes.ts`
- Test: `apps/web/src/app/core/auth/auth.service.spec.ts`, `apps/web/src/app/core/auth/auth.guard.spec.ts`

**Interfaces:**
- Consumes: `@labtrack/shared` (Task 1), endpoints de auth (Task 7).
- Produces: `AuthService` con `currentUser: Signal<UserDto | null>`, `isAuthenticated: Signal<boolean>`, `isAdmin: Signal<boolean>`, `login(credentials): Observable<LoginResponse>`, `logout(): void`, `token(): string | null`; `authInterceptor`; `authGuard`; `adminGuard`; ruta `/login`.

- [ ] **Step 1: Generar el proyecto Angular**

```bash
npx @angular/cli@latest new web --directory apps/web --routing --style=scss --skip-git --standalone
npm install -w apps/web @angular/material @labtrack/shared
npx ng add @angular/material --project web --skip-confirmation
```

En `apps/web/package.json`, dejar `"name": "@labtrack/web"`.

Si el CLI ofrece elegir el ejecutor de pruebas, usar el que proponga por defecto: las pruebas de este plan usan `TestBed`, cuya API es la misma en Karma y en Vitest.

- [ ] **Step 2: Escribir la prueba de AuthService que falla**

`apps/web/src/app/core/auth/auth.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { API_URL } from '../api/api.config';

const userDto = {
  id: 'user-1',
  username: 'ana',
  fullName: 'Ana Ruiz',
  role: 'USER' as const,
  mustChangePassword: false,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts with no authenticated user', () => {
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('stores the token and user after a successful login', () => {
    service.login({ username: 'ana', password: 'secret' }).subscribe();

    http
      .expectOne('http://api.test/auth/login')
      .flush({ accessToken: 'token-123', user: userDto });

    expect(service.token()).toBe('token-123');
    expect(service.currentUser()?.username).toBe('ana');
    expect(service.isAuthenticated()).toBe(true);
    expect(service.isAdmin()).toBe(false);
  });

  it('reports admin privileges only for the ADMIN role', () => {
    service.login({ username: 'admin', password: 'secret' }).subscribe();

    http
      .expectOne('http://api.test/auth/login')
      .flush({ accessToken: 'token-123', user: { ...userDto, role: 'ADMIN' } });

    expect(service.isAdmin()).toBe(true);
  });

  it('clears the session on logout', () => {
    service.login({ username: 'ana', password: 'secret' }).subscribe();
    http.expectOne('http://api.test/auth/login').flush({ accessToken: 'token-123', user: userDto });

    service.logout();

    expect(service.token()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(localStorage.getItem('labtrack.token')).toBeNull();
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `npm run test -w apps/web`
Expected: FAIL — `AuthService` no existe.

- [ ] **Step 4: Implementar la configuración del API y AuthService**

`apps/web/src/app/core/api/api.config.ts`:

```ts
import { InjectionToken } from '@angular/core';

export const API_URL = new InjectionToken<string>('API_URL');
```

`apps/web/src/app/core/auth/auth.service.ts`:

```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { LoginRequest, LoginResponse, UserDto } from '@labtrack/shared';
import { API_URL } from '../api/api.config';

const TOKEN_KEY = 'labtrack.token';
const USER_KEY = 'labtrack.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);

  private readonly tokenSignal = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  private readonly userSignal = signal<UserDto | null>(readStoredUser());

  readonly token = this.tokenSignal.asReadonly();
  readonly currentUser = this.userSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.tokenSignal() !== null);
  readonly isAdmin = computed(() => this.userSignal()?.role === 'ADMIN');
  readonly mustChangePassword = computed(() => this.userSignal()?.mustChangePassword === true);

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/auth/login`, credentials)
      .pipe(tap((response) => this.storeSession(response)));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.tokenSignal.set(null);
    this.userSignal.set(null);
  }

  setUser(user: UserDto): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.userSignal.set(user);
  }

  private storeSession(response: LoginResponse): void {
    localStorage.setItem(TOKEN_KEY, response.accessToken);
    this.tokenSignal.set(response.accessToken);
    this.setUser(response.user);
  }
}

function readStoredUser(): UserDto | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as UserDto;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/web`
Expected: PASS, 4 pruebas.

- [ ] **Step 6: Escribir la prueba de los guards**

`apps/web/src/app/core/auth/auth.guard.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { authGuard, adminGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { API_URL } from '../api/api.config';

function setup(user: { role: 'ADMIN' | 'USER' } | null, token: string | null) {
  localStorage.clear();
  if (token) {
    localStorage.setItem('labtrack.token', token);
  }
  if (user) {
    localStorage.setItem('labtrack.user', JSON.stringify({ ...user, mustChangePassword: false }));
  }

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: API_URL, useValue: 'http://api.test' },
      { provide: Router, useValue: { createUrlTree: (commands: string[]) => commands.join('/') } },
    ],
  });
  return TestBed.inject(AuthService);
}

describe('authGuard', () => {
  it('lets an authenticated user through', () => {
    setup({ role: 'USER' }, 'token-123');
    expect(TestBed.runInInjectionContext(() => authGuard())).toBe(true);
  });

  it('redirects an anonymous visitor to login', () => {
    setup(null, null);
    expect(TestBed.runInInjectionContext(() => authGuard())).toBe('/login');
  });
});

describe('adminGuard', () => {
  it('lets an admin through', () => {
    setup({ role: 'ADMIN' }, 'token-123');
    expect(TestBed.runInInjectionContext(() => adminGuard())).toBe(true);
  });

  it('redirects a non-admin to the home page', () => {
    setup({ role: 'USER' }, 'token-123');
    expect(TestBed.runInInjectionContext(() => adminGuard())).toBe('/reactivos');
  });
});
```

- [ ] **Step 7: Implementar guards e interceptor**

`apps/web/src/app/core/auth/auth.guard.ts`:

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  if (auth.mustChangePassword()) {
    return router.createUrlTree(['/cambiar-contrasena']);
  }
  return true;
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAdmin() ? true : router.createUrlTree(['/reactivos']);
};
```

`apps/web/src/app/core/auth/auth.interceptor.ts`:

```ts
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();

  const authorized = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorized).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        auth.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
```

`apps/web/src/app/app.config.ts` debe registrar `provideHttpClient(withInterceptors([authInterceptor]))`, `provideAnimationsAsync()` y `{ provide: API_URL, useValue: environment.apiUrl }`.

- [ ] **Step 8: Implementar la pantalla de inicio de sesión**

`apps/web/src/app/shared/i18n/es.ts`:

```ts
export const COMMON_ES = {
  appName: 'LabTrack',
  save: 'Guardar',
  cancel: 'Cancelar',
  accept: 'Aceptar',
  requiredField: 'Este campo es obligatorio',
  unexpectedError: 'Ocurrió un error inesperado. Intenta de nuevo.',
} as const;

export const LOGIN_ES = {
  title: 'Iniciar sesión',
  username: 'Usuario',
  password: 'Contraseña',
  submit: 'Entrar',
  invalidCredentials: 'Usuario o contraseña incorrectos',
} as const;
```

`apps/web/src/app/features/login/login.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { LOGIN_ES } from '../../shared/i18n/es';

@Component({
  selector: 'lt-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  template: `
    <mat-card class="login-card">
      <h1>{{ text.title }}</h1>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>{{ text.username }}</mat-label>
          <input matInput formControlName="username" autocomplete="username" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.password }}</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="current-password" />
        </mat-form-field>

        @if (errorMessage()) {
          <p class="error">{{ errorMessage() }}</p>
        }

        <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || loading()">
          {{ text.submit }}
        </button>
      </form>
    </mat-card>
  `,
  styles: `
    .login-card { max-width: 24rem; margin: 4rem auto; padding: 2rem; }
    form { display: flex; flex-direction: column; gap: 1rem; }
    .error { color: var(--mat-sys-error, #b3261e); margin: 0; }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly text = LOGIN_ES;
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);

    this.auth.login(this.form.getRawValue()).subscribe({
      next: (response) => {
        this.loading.set(false);
        const destination = response.user.mustChangePassword ? '/cambiar-contrasena' : '/reactivos';
        void this.router.navigate([destination]);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(this.text.invalidCredentials);
      },
    });
  }
}
```

`apps/web/src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';
import { authGuard, adminGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'reactivos' },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'cambiar-contrasena',
    loadComponent: () =>
      import('./features/profile/change-password.component').then((m) => m.ChangePasswordComponent),
  },
  {
    path: 'usuarios',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./features/users/users.component').then((m) => m.UsersComponent),
  },
  { path: '**', redirectTo: 'login' },
];
```

La ruta `reactivos` llega en la Fase 2; por ahora `''` redirige a ella y el `**` final evita una pantalla en blanco.

- [ ] **Step 9: Ejecutar las pruebas del cliente**

Run: `npm run test -w apps/web`
Expected: PASS, 8 pruebas (AuthService y guards).

- [ ] **Step 10: Verificar el flujo real contra el API**

Run, en dos terminales: `npm run start:dev -w apps/api` y `npm start -w apps/web`.
Abrir `http://localhost:4200/login`, entrar con el usuario semilla y comprobar que redirige a cambiar contraseña.

- [ ] **Step 11: Commit**

```bash
git add apps/web
git commit -m "feat(web): add angular client with signal-based auth and login screen"
```

---

## Task 11: Pantallas de cambio de contraseña y administración de usuarios

**Files:**
- Create: `apps/web/src/app/features/profile/change-password.component.ts`, `apps/web/src/app/features/users/users.store.ts`, `apps/web/src/app/features/users/users.component.ts`, `apps/web/src/app/features/users/user-form.dialog.ts`, `apps/web/src/app/features/users/i18n.es.ts`
- Modify: `apps/web/src/app/app.component.ts` (barra de navegación)
- Test: `apps/web/src/app/features/users/users.store.spec.ts`

**Interfaces:**
- Consumes: `AuthService` (Task 10), endpoints de usuarios (Task 8).
- Produces: `UsersStore` con `users: Signal<UserDto[]>`, `total: Signal<number>`, `loading: Signal<boolean>`, `page`, `pageSize`, `search`, y los métodos `setPage(page)`, `setSearch(term)`, `create(request)`, `deactivate(id)`, `reload()`.

- [ ] **Step 1: Escribir la prueba del store que falla**

`apps/web/src/app/features/users/users.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsersStore } from './users.store';
import { API_URL } from '../../core/api/api.config';

const page = {
  data: [
    {
      id: 'user-1',
      username: 'ana',
      fullName: 'Ana Ruiz',
      role: 'USER',
      mustChangePassword: false,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

describe('UsersStore', () => {
  let store: UsersStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    store = TestBed.inject(UsersStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the first page on demand', () => {
    store.reload();
    const request = http.expectOne((req) => req.url === 'http://api.test/users');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('20');
    request.flush(page);

    expect(store.users()).toHaveLength(1);
    expect(store.total()).toBe(1);
    expect(store.loading()).toBe(false);
  });

  it('sends the search term and resets to the first page', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setSearch('ana');
    const request = http.expectOne((req) => req.params.get('search') === 'ana');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(page);
  });

  it('reloads the list after deactivating a user', () => {
    store.deactivate('user-1').subscribe();
    http.expectOne('http://api.test/users/user-1/deactivate').flush({});
    http.expectOne((req) => req.url === 'http://api.test/users').flush(page);

    expect(store.users()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm run test -w apps/web -- users.store`
Expected: FAIL — `UsersStore` no existe.

- [ ] **Step 3: Implementar el store**

`apps/web/src/app/features/users/users.store.ts`:

```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, finalize, tap } from 'rxjs';
import { CreateUserRequest, PaginatedResponse, UserDto } from '@labtrack/shared';
import { API_URL } from '../../core/api/api.config';

interface UsersState {
  page: number;
  pageSize: number;
  search: string;
}

@Injectable({ providedIn: 'root' })
export class UsersStore {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);

  private readonly state = signal<UsersState>({ page: 1, pageSize: 20, search: '' });
  private readonly usersSignal = signal<UserDto[]>([]);
  private readonly totalSignal = signal(0);
  private readonly loadingSignal = signal(false);

  readonly users = this.usersSignal.asReadonly();
  readonly total = this.totalSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly page = computed(() => this.state().page);
  readonly pageSize = computed(() => this.state().pageSize);
  readonly search = computed(() => this.state().search);

  setPage(page: number): void {
    this.state.update((current) => ({ ...current, page }));
    this.reload();
  }

  // Cambiar la búsqueda vuelve a la primera página: mantener la página actual
  // dejaría al usuario mirando una página vacía de un resultado más pequeño.
  setSearch(search: string): void {
    this.state.update((current) => ({ ...current, search, page: 1 }));
    this.reload();
  }

  reload(): void {
    const { page, pageSize, search } = this.state();
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (search) {
      params = params.set('search', search);
    }

    this.loadingSignal.set(true);
    this.http
      .get<PaginatedResponse<UserDto>>(`${this.apiUrl}/users`, { params })
      .pipe(finalize(() => this.loadingSignal.set(false)))
      .subscribe((response) => {
        this.usersSignal.set(response.data);
        this.totalSignal.set(response.total);
      });
  }

  create(request: CreateUserRequest): Observable<UserDto> {
    return this.http
      .post<UserDto>(`${this.apiUrl}/users`, request)
      .pipe(tap(() => this.reload()));
  }

  deactivate(id: string): Observable<UserDto> {
    return this.http
      .patch<UserDto>(`${this.apiUrl}/users/${id}/deactivate`, {})
      .pipe(tap(() => this.reload()));
  }
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm run test -w apps/web -- users.store`
Expected: PASS, 3 pruebas.

- [ ] **Step 5: Implementar el diccionario de la feature**

`apps/web/src/app/features/users/i18n.es.ts`:

```ts
export const USERS_ES = {
  title: 'Usuarios',
  searchPlaceholder: 'Buscar por usuario o nombre',
  newUser: 'Nuevo usuario',
  columns: {
    username: 'Usuario',
    fullName: 'Nombre completo',
    role: 'Rol',
    status: 'Estado',
    actions: 'Acciones',
  },
  roles: { ADMIN: 'Administrador', USER: 'Usuario' },
  status: { active: 'Activo', inactive: 'Inactivo' },
  deactivate: 'Desactivar',
  confirmDeactivate: '¿Desactivar a este usuario? Podrá consultarse, pero no iniciará sesión.',
  form: {
    username: 'Usuario',
    fullName: 'Nombre completo',
    password: 'Contraseña inicial',
    role: 'Rol',
    passwordHint: 'El usuario deberá cambiarla al iniciar sesión.',
    usernameTaken: 'Ese nombre de usuario ya existe',
  },
  emptyState: 'No hay usuarios que coincidan con la búsqueda.',
} as const;

export const CHANGE_PASSWORD_ES = {
  title: 'Cambiar contraseña',
  forcedNotice: 'Debes cambiar tu contraseña antes de continuar.',
  currentPassword: 'Contraseña actual',
  newPassword: 'Nueva contraseña',
  confirmPassword: 'Confirmar nueva contraseña',
  submit: 'Guardar contraseña',
  mismatch: 'Las contraseñas no coinciden',
  tooShort: 'Debe tener al menos 8 caracteres',
  wrongCurrent: 'La contraseña actual es incorrecta',
  success: 'Contraseña actualizada',
} as const;
```

- [ ] **Step 6: Implementar la pantalla de cambio de contraseña**

`apps/web/src/app/features/profile/change-password.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { API_URL } from '../../core/api/api.config';
import { CHANGE_PASSWORD_ES } from '../users/i18n.es';

@Component({
  selector: 'lt-change-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <mat-card class="card">
      <h1>{{ text.title }}</h1>
      @if (forced()) {
        <p class="notice">{{ text.forcedNotice }}</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>{{ text.currentPassword }}</mat-label>
          <input matInput type="password" formControlName="currentPassword" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.newPassword }}</mat-label>
          <input matInput type="password" formControlName="newPassword" />
          @if (form.controls.newPassword.hasError('minlength')) {
            <mat-error>{{ text.tooShort }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.confirmPassword }}</mat-label>
          <input matInput type="password" formControlName="confirmPassword" />
        </mat-form-field>

        @if (errorMessage()) {
          <p class="error">{{ errorMessage() }}</p>
        }

        <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid">
          {{ text.submit }}
        </button>
      </form>
    </mat-card>
  `,
  styles: `
    .card { max-width: 28rem; margin: 3rem auto; padding: 2rem; }
    form { display: flex; flex-direction: column; gap: 1rem; }
    .notice { color: var(--mat-sys-primary, #005cbb); }
    .error { color: var(--mat-sys-error, #b3261e); margin: 0; }
  `,
})
export class ChangePasswordComponent {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly text = CHANGE_PASSWORD_ES;
  readonly errorMessage = signal<string | null>(null);
  readonly forced = computed(() => this.auth.mustChangePassword());

  readonly form = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  submit(): void {
    const { currentPassword, newPassword, confirmPassword } = this.form.getRawValue();
    if (newPassword !== confirmPassword) {
      this.errorMessage.set(this.text.mismatch);
      return;
    }

    this.http.patch(`${this.apiUrl}/auth/password`, { currentPassword, newPassword }).subscribe({
      next: () => {
        const user = this.auth.currentUser();
        if (user) {
          this.auth.setUser({ ...user, mustChangePassword: false });
        }
        void this.router.navigate(['/reactivos']);
      },
      error: () => this.errorMessage.set(this.text.wrongCurrent),
    });
  }
}
```

- [ ] **Step 7: Implementar la pantalla de usuarios**

`apps/web/src/app/features/users/user-form.dialog.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CreateUserRequest } from '@labtrack/shared';
import { USERS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

@Component({
  selector: 'lt-user-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ text.newUser }}</h2>
    <mat-dialog-content [formGroup]="form">
      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.username }}</mat-label>
        <input matInput formControlName="username" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.fullName }}</mat-label>
        <input matInput formControlName="fullName" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.password }}</mat-label>
        <input matInput type="password" formControlName="password" />
        <mat-hint>{{ text.form.passwordHint }}</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.role }}</mat-label>
        <mat-select formControlName="role">
          <mat-option value="USER">{{ text.roles.USER }}</mat-option>
          <mat-option value="ADMIN">{{ text.roles.ADMIN }}</mat-option>
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">{{ common.cancel }}</button>
      <button mat-flat-button color="primary" [disabled]="form.invalid" (click)="confirm()">
        {{ common.save }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { display: flex; flex-direction: column; gap: 1rem; padding-top: 0.5rem; }
  `,
})
export class UserFormDialog {
  readonly dialogRef = inject(MatDialogRef<UserFormDialog, CreateUserRequest>);
  readonly text = USERS_ES;
  readonly common = COMMON_ES;

  readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', [Validators.required, Validators.pattern(/^[a-z0-9._-]{3,32}$/)]],
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['USER' as const, Validators.required],
  });

  confirm(): void {
    if (this.form.valid) {
      this.dialogRef.close(this.form.getRawValue());
    }
  }
}
```

`apps/web/src/app/features/users/users.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { CreateUserRequest } from '@labtrack/shared';
import { UsersStore } from './users.store';
import { UserFormDialog } from './user-form.dialog';
import { USERS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

@Component({
  selector: 'lt-users',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDialogModule,
    MatProgressBarModule,
  ],
  template: `
    <section class="page">
      <header>
        <h1>{{ text.title }}</h1>
        <button mat-flat-button color="primary" (click)="openForm()">{{ text.newUser }}</button>
      </header>

      <mat-form-field appearance="outline" class="search">
        <mat-label>{{ text.searchPlaceholder }}</mat-label>
        <input matInput [formControl]="searchControl" />
      </mat-form-field>

      @if (store.loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <table mat-table [dataSource]="store.users()">
        <ng-container matColumnDef="username">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.username }}</th>
          <td mat-cell *matCellDef="let user">{{ user.username }}</td>
        </ng-container>

        <ng-container matColumnDef="fullName">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.fullName }}</th>
          <td mat-cell *matCellDef="let user">{{ user.fullName }}</td>
        </ng-container>

        <ng-container matColumnDef="role">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.role }}</th>
          <td mat-cell *matCellDef="let user">{{ text.roles[user.role] }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.status }}</th>
          <td mat-cell *matCellDef="let user">
            {{ user.active ? text.status.active : text.status.inactive }}
          </td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.actions }}</th>
          <td mat-cell *matCellDef="let user">
            @if (user.active) {
              <button mat-button color="warn" (click)="deactivate(user.id)">
                {{ text.deactivate }}
              </button>
            }
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>

      @if (!store.loading() && store.users().length === 0) {
        <p class="empty">{{ text.emptyState }}</p>
      }

      <mat-paginator
        [length]="store.total()"
        [pageSize]="store.pageSize()"
        [pageIndex]="store.page() - 1"
        [pageSizeOptions]="[10, 20, 50]"
        (page)="onPage($event)"
      />
    </section>
  `,
  styles: `
    .page { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
    header { display: flex; align-items: center; justify-content: space-between; }
    .search { max-width: 24rem; }
    table { width: 100%; }
    .empty { color: rgba(0, 0, 0, 0.6); }
  `,
})
export class UsersComponent implements OnInit {
  readonly store = inject(UsersStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly text = USERS_ES;
  readonly columns = ['username', 'fullName', 'role', 'status', 'actions'];
  readonly searchControl = new FormControl('', { nonNullable: true });

  constructor() {
    // El retardo evita una petición por tecla mientras se escribe.
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => this.store.setSearch(term));
  }

  ngOnInit(): void {
    this.store.reload();
  }

  onPage(event: PageEvent): void {
    this.store.setPage(event.pageIndex + 1);
  }

  openForm(): void {
    this.dialog
      .open(UserFormDialog, { width: '28rem' })
      .afterClosed()
      .subscribe((request: CreateUserRequest | undefined) => {
        if (!request) {
          return;
        }
        this.store.create(request).subscribe({
          error: (error: HttpErrorResponse) => {
            const message =
              error.error?.code === 'UNIQUE_CONSTRAINT'
                ? this.text.form.usernameTaken
                : COMMON_ES.unexpectedError;
            this.snackBar.open(message, COMMON_ES.accept, { duration: 5000 });
          },
        });
      });
  }

  deactivate(id: string): void {
    if (!confirm(this.text.confirmDeactivate)) {
      return;
    }
    this.store.deactivate(id).subscribe({
      error: () =>
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 }),
    });
  }
}
```

`confirm()` del navegador es suficiente en esta fase; la Fase 2 introduce un `ConfirmDialog` de Material en `shared/` cuando haya tres o cuatro confirmaciones distintas que justifiquen el componente.

`apps/web/src/app/app.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from './core/auth/auth.service';
import { COMMON_ES } from './shared/i18n/es';

@Component({
  selector: 'lt-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, MatToolbarModule, MatButtonModule],
  template: `
    @if (auth.isAuthenticated()) {
      <mat-toolbar color="primary">
        <span class="brand">{{ common.appName }}</span>
        @if (auth.isAdmin()) {
          <a mat-button routerLink="/usuarios">Usuarios</a>
        }
        <span class="spacer"></span>
        <span class="user">{{ auth.currentUser()?.fullName }}</span>
        <button mat-button (click)="logout()">Cerrar sesión</button>
      </mat-toolbar>
    }
    <router-outlet />
  `,
  styles: `
    .brand { font-weight: 600; margin-right: 1.5rem; }
    .spacer { flex: 1 1 auto; }
    .user { margin-right: 1rem; }
  `,
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly common = COMMON_ES;

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
```

Al cambiar el selector a `lt-root`, actualizar también la etiqueta correspondiente en `apps/web/src/index.html`, o la aplicación arrancará con la página en blanco.

- [ ] **Step 8: Verificar el flujo completo a mano**

Con el API y el cliente en marcha: entrar como administrador, cambiar la contraseña inicial, crear un usuario, cerrar sesión, entrar con el nuevo usuario, comprobar que obliga a cambiar la contraseña, y verificar que ese usuario no ve el enlace "Usuarios" ni puede abrir `/usuarios` escribiéndolo en la barra de direcciones.

- [ ] **Step 9: Ejecutar toda la suite**

Run: `npm test && npm run test:e2e -w apps/api && npm run test -w apps/web`
Expected: PASS en todo.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): add password change and user administration screens"
```

---

## Task 12: Despliegue en Neon, Railway y Netlify

**Files:**
- Create: `netlify.toml`, `apps/web/public/_redirects`, `apps/web/src/environments/environment.ts`, `apps/web/src/environments/environment.production.ts`, `README.md` (sección de despliegue)
- Modify: `apps/api/package.json` (script `start:prod` con migraciones)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la aplicación accesible en el dominio de Netlify, hablando con el API de Railway sobre la base de datos de Neon.

- [ ] **Step 1: Crear el proyecto en Neon**

Crear el proyecto y la rama `development` además de `main`. Copiar la cadena de conexión con *pooling* de cada rama.

- [ ] **Step 2: Aplicar las migraciones en la rama de desarrollo**

Run: `DATABASE_URL=<neon-development-url> npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`
Expected: aplica la migración `init_user` sin errores.

- [ ] **Step 3: Preparar el arranque de producción del API**

En `apps/api/package.json`:

```json
"scripts": {
  "start:prod": "prisma migrate deploy && node dist/main"
}
```

Las migraciones corren al arrancar el servicio, de modo que un despliegue nunca queda con el esquema desfasado respecto al código.

- [ ] **Step 4: Desplegar el API en Railway**

Crear el servicio apuntando al repositorio, con directorio raíz `/` y comandos:

- Build: `npm ci && npm run build:shared && npm run build -w apps/api`
- Start: `npm run start:prod -w apps/api`

Variables: `DATABASE_URL` (rama `main` de Neon), `JWT_SECRET` (cadena aleatoria de 32+ caracteres), `JWT_EXPIRES_IN=8h`, `CORS_ORIGIN` (dominio de Netlify, se completa tras el Step 6), `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `PORT` (lo inyecta Railway).

- [ ] **Step 5: Verificar el API desplegado**

Run: `curl https://<railway-domain>/health`
Expected: `{"status":"ok"}`.

- [ ] **Step 6: Configurar el cliente y desplegarlo en Netlify**

`apps/web/src/environments/environment.ts`:

```ts
export const environment = { production: false, apiUrl: 'http://localhost:3000' };
```

`apps/web/src/environments/environment.production.ts`:

```ts
export const environment = { production: true, apiUrl: 'https://<railway-domain>' };
```

`apps/web/public/_redirects`:

```
/*    /index.html   200
```

`netlify.toml` en la raíz:

```toml
[build]
  command = "npm ci && npm run build:shared && npm run build -w apps/web"
  publish = "apps/web/dist/web/browser"
```

Verificar la ruta exacta de `publish` con la salida de `npm run build -w apps/web`: el subdirectorio depende de la versión del CLI.

- [ ] **Step 7: Cerrar el círculo de CORS**

Actualizar `CORS_ORIGIN` en Railway con el dominio real de Netlify y reiniciar el servicio.

- [ ] **Step 8: Sembrar el administrador en producción**

Run, desde la consola de Railway: `npm run db:seed -w apps/api`
Expected: crea el administrador. Iniciar sesión en el dominio de Netlify, comprobar que obliga a cambiar la contraseña, y cambiarla de inmediato.

- [ ] **Step 9: Documentar el arranque en el README**

Escribir en `README.md`: requisitos (Node 20, Docker), pasos para el entorno local (`npm ci`, `docker compose up -d`, copiar `.env.example`, `prisma migrate dev`, `db:seed`, arrancar ambas apps), cómo correr las pruebas, y la lista de variables de entorno de cada servicio con su significado.

- [ ] **Step 10: Commit**

```bash
git add netlify.toml apps/web README.md apps/api/package.json
git commit -m "chore: configure Neon, Railway and Netlify deployments"
```

---

## Verificación final de la fase

- [ ] `npm test` pasa en la raíz (shared + api).
- [ ] `npm run test:e2e -w apps/api` pasa con la base de datos de Docker en marcha.
- [ ] `npm run test -w apps/web` pasa.
- [ ] `grep -rn "\.delete\|deleteMany" apps/api/src` no devuelve nada.
- [ ] `grep -rn "@Delete" apps/api/src` no devuelve nada.
- [ ] El dominio de Netlify permite iniciar sesión, cambiar contraseña, crear un usuario y desactivarlo.
- [ ] Desactivar a un usuario con sesión abierta lo expulsa en su siguiente petición.

Cuando esto se cumpla, la Fase 1 está terminada y se planifica la Fase 2 (locations, reagents y batches) sobre el código ya existente.
