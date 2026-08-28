# LabTrack — Diseño del MVP

Fecha: 2026-08-23
Estado: aprobado para planificación

## 1. Propósito

Plataforma para gestionar el inventario de reactivos de un laboratorio: qué
reactivos hay, en qué cantidad llegaron, dónde están, y qué consumo se hace de
ellos. Cada consumo registra fecha, cantidad y propósito, de modo que cada
reactivo tiene una traza de uso completa.

La usan varias personas. Hay inicio de sesión pero no registro público: un
administrador crea los usuarios con una contraseña inicial, y cada usuario la
cambia después de entrar.

**Convención de idioma.** Código, nombres de tablas, columnas, rutas y mensajes
de log en inglés. Toda cadena visible en la interfaz, en español.

## 2. Stack y despliegue

| Capa | Tecnología | Destino |
|---|---|---|
| Cliente | Angular (última versión), signals, standalone components, Angular Material | Netlify |
| Servidor | NestJS, arquitectura modular por capas | Railway |
| Base de datos | PostgreSQL + Prisma ORM | Neon |

Monorepo con `apps/api`, `apps/web` y `packages/shared` para los tipos del
contrato HTTP, de modo que un cambio de DTO rompa la compilación del cliente en
lugar de descubrirse en ejecución.

## 3. Reglas transversales

### 3.1 Sin borrado físico

Ninguna operación de base de datos elimina filas. Los servicios usan
exclusivamente consulta, inserción y actualización; `delete` y `deleteMany` de
Prisma no aparecen en el código. Cada tabla tiene un campo `active` (1 = activo,
0 = borrado lógico), modelado como `Boolean` en Prisma y `boolean` en Postgres.

La restricción se refleja en la superficie HTTP: no existe ningún verbo `DELETE`
en el API. La desactivación se expresa como `PATCH /:id/deactivate`.

Desactivar un reactivo desactiva sus lotes dentro de la misma transacción.
Desactivar un lote no toca sus consumos: el historial se conserva.

### 3.2 Auditoría

Todos los modelos llevan `createdAt`, `updatedAt` y `madeById` (referencia a
`User`). `madeById` nunca se acepta desde el cuerpo de la petición: un
interceptor de NestJS lo inyecta a partir del usuario del JWT, de modo que el
cliente no puede falsificar la autoría.

### 3.3 Cantidades

Las cantidades (`initialStock`, `currentStock`, `quantity`) son `Decimal(12,4)`.
No se usa `Float`: con gramos y mililitros el redondeo binario acumula error en
los totales de consumo, que son la base de los filtros compuestos.

## 4. Modelo de datos

Un reactivo es la **sustancia** (catálogo); cada ingreso físico al laboratorio es
un **lote**. El consumo se registra siempre contra un lote. Así el CAS, el nombre
y la ficha de datos no se duplican en cada compra, la existencia total de una
sustancia es la suma de sus lotes, y el filtrado por nombre no depende de que el
nombre se haya escrito igual en cada ingreso.

```prisma
enum Role { ADMIN USER }
enum Unit { G MG KG ML L UNIT }

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
  madeById           String?
}

model Location {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  madeById    String
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
  madeById     String
  batches      ReagentBatch[]

  @@index([name])
  @@index([casNumber])
}

model ReagentBatch {
  id             String    @id @default(uuid())
  reagentId      String
  lotNumber      String
  entryDate      DateTime
  expirationDate DateTime?
  initialStock   Decimal   @db.Decimal(12, 4)
  currentStock   Decimal   @db.Decimal(12, 4)
  unit           Unit
  locationId     String
  active         Boolean   @default(true)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  madeById       String
  consumptions   Consumption[]

  @@index([reagentId])
  @@index([expirationDate])
  @@index([locationId])
}

model Consumption {
  id         String    @id @default(uuid())
  batchId    String
  consumedAt DateTime
  quantity   Decimal   @db.Decimal(12, 4)
  purpose    String
  active     Boolean   @default(true)
  voidReason String?
  voidedById String?
  voidedAt   DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  madeById   String

  @@index([batchId])
  @@index([consumedAt])
}
```

Por brevedad el esquema muestra los campos escalares; los campos de relación
(`reagent`, `location`, `madeBy`, `voidedBy` y sus `@relation`) se declaran junto
a cada clave foránea.

### 4.1 Unidades

Cada lote declara su unidad (enum `Unit`). El consumo se registra en la unidad de
su lote; no hay conversiones. Los filtros por cantidad consumida se interpretan
dentro de la unidad del reactivo, y la interfaz muestra siempre la unidad junto a
la cifra para que un umbral no se lea fuera de contexto.

### 4.2 Existencia

`currentStock` es un valor materializado, no un agregado calculado en cada
consulta. Registrar un consumo es una transacción que valida
`quantity <= currentStock`, inserta el `Consumption` y decrementa el lote. Anular
un consumo revierte exactamente eso.

Alternativa descartada: derivar la existencia sumando consumos en cada lectura.
Es más puro, pero convierte cada listado paginado en un agregado costoso.

### 4.3 Unicidad y validación

- `(reagentId, lotNumber)` único entre lotes activos. Prisma no expresa índices
  únicos parciales, así que se crea en SQL dentro de una migración:
  `CREATE UNIQUE INDEX ... ON "ReagentBatch" ("reagentId", "lotNumber") WHERE active`.
- `casNumber` no es único: un mismo CAS admite presentaciones distintas. Se valida
  su formato con el dígito de verificación estándar.
- `expirationDate`, cuando existe, debe ser posterior a `entryDate`.

### 4.4 Anulación de consumos

Solo un ADMIN puede anular, y la justificación es obligatoria. La anulación marca
`active = false`, guarda `voidReason`, `voidedById` y `voidedAt` en la misma fila,
y devuelve la cantidad al `currentStock` del lote, todo en una transacción. El
motivo vive junto al consumo: no hace falta un join a una tabla de auditoría para
explicar por qué desapareció un registro.

## 5. API (NestJS)

```
apps/api/src/
  common/        guards, interceptors, filters, decorators, dto de paginación
  prisma/        PrismaModule (global), PrismaService
  auth/          controller · service · module · dto · strategies/jwt.strategy.ts
  users/         controller · service · module · dto
  locations/     controller · service · module · dto
  reagents/      controller · service · module · dto  (batches como sub-recurso)
  consumptions/  controller · service · module · dto
```

El controller valida la entrada y delega; el service contiene la regla de negocio
y es el único que toca Prisma; los DTO definen el contrato con `class-validator`.
`ValidationPipe` global con `whitelist: true` y `forbidNonWhitelisted: true`.

### 5.1 Endpoints

| Módulo | Rutas |
|---|---|
| auth | `POST /auth/login` · `GET /auth/me` · `PATCH /auth/password` |
| users | `GET /users` · `POST /users` · `PATCH /users/:id` · `PATCH /users/:id/deactivate` — todo ADMIN |
| locations | `GET /locations` · `POST /locations` · `PATCH /locations/:id` · `PATCH /locations/:id/deactivate` |
| reagents | `GET /reagents` · `GET /reagents/:id` · `POST /reagents` · `PATCH /reagents/:id` · `PATCH /reagents/:id/deactivate` · `POST /reagents/:id/batches` · `PATCH /batches/:id` · `PATCH /batches/:id/deactivate` |
| consumptions | `GET /consumptions` · `POST /consumptions` · `PATCH /consumptions/:id/void` (ADMIN, exige `voidReason`) |

### 5.2 Autenticación y autorización

JWT de vida media (8 h) firmado con `JWT_SECRET`, guardado en `localStorage` y
enviado por un interceptor de Angular. Sin refresh token: para un laboratorio
interno el costo de rotación y revocación no se justifica en el MVP.

`JwtAuthGuard` es global vía `APP_GUARD`; solo el login se marca `@Public()`.
`RolesGuard` lee el decorador `@Roles(...)`. La estrategia JWT revalida en cada
petición que el usuario siga `active`, de modo que desactivar a alguien lo expulsa
de inmediato en lugar de esperar a que expire su token. Ese chequeo es lo que
compensa la ausencia de refresh token.

Contraseñas con bcrypt, coste 12. Un usuario con `mustChangePassword` solo puede
llamar a `GET /auth/me` y `PATCH /auth/password` hasta que la cambie.

### 5.3 Paginación y ordenamiento

Todas las listas responden:

```json
{ "data": [], "total": 0, "page": 1, "pageSize": 20, "totalPages": 0 }
```

`page` (>= 1) y `pageSize` (1..100, por defecto 20). `sortBy` y `sortOrder` se
validan contra una lista blanca de columnas por módulo, para que el ordenamiento
dinámico no se convierta en una vía de inyección a través de `orderBy`. El `total`
se calcula con el mismo `where` que los datos y en la misma transacción, para que
el paginador nunca muestre una cifra que no corresponde a lo que se está viendo.

### 5.4 Errores

`PrismaExceptionFilter` traduce los fallos conocidos a HTTP: P2002 (unicidad) a
409, P2025 (no encontrado) a 404. La respuesta lleva un código estable que el
cliente traduce al español; nunca se expone texto crudo de Prisma en la interfaz.

## 6. Filtros

### 6.1 Filtros simples — `GET /reagents`

`name` (parcial, insensible a mayúsculas y acentos), `casNumber`, `locationId`,
`expiringBefore`, `lowStock` (lotes con `currentStock <= X`) e `includeInactive`
(solo ADMIN). Cada parámetro presente añade una cláusula al `where` de Prisma;
ausente no añade nada. Se combinan con `AND`.

La búsqueda por nombre usa las extensiones `pg_trgm` y `unaccent` con un índice
GIN sobre `unaccent(lower(name))`, habilitadas en una migración de Prisma; Neon
las soporta. Si el despliegue diera problemas, el fallback es `ILIKE` sin índice,
aceptable para el volumen de un laboratorio.

### 6.2 Filtro compuesto por consumo

"Reactivos cuyo consumo haya sido mayor a X, con o sin rango de fechas" no es
expresable como un `where` sobre `Reagent`: es un `HAVING` sobre consumos
agrupados, donde el rango de fechas acota además qué consumos cuentan.

Se resuelve en dos pasos: una consulta cruda tipada (`$queryRaw`, parámetros como
bindings, nunca interpolados) que devuelve los ids paginados, y un `findMany` de
Prisma con `where: { id: { in: ids } }` que hidrata las relaciones. Conserva el
tipado y el `include` de Prisma sin forzar su API de agregación, que no cubre
`HAVING` sobre relaciones anidadas.

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

La unidad (`$unit`) es obligatoria junto con el umbral, no incidental: un reactivo
puede tener existencias en mililitros y en litros a la vez, y sumar consumos de
ambas unidades produciría una cantidad que no corresponde a ninguna magnitud
física real. Por eso el `JOIN` con `ReagentBatch` fija la unidad antes de agrupar,
en vez de agrupar por reactivo solo.

El filtro es opcional. Si `minConsumed` no viene, se toma el camino simple sin el
join de agregación, que es el caso frecuente y el más rápido.

Descartado: traer los reactivos y sumar en Node. Rompe la paginación, porque
habría que traerlos todos para saber cuáles califican.

### 6.3 Filtros de consumos — `GET /consumptions`

Orden descendente por `consumedAt` por defecto. Filtros por `reagentId`,
`batchId`, `madeById`, rango de fechas y `purpose` (parcial). Los consumos
anulados se excluyen salvo que un ADMIN pida `includeVoided`.

## 7. Cliente (Angular)

```
apps/web/src/app/
  core/      auth (AuthService, authGuard, adminGuard, authInterceptor,
             errorInterceptor) · api (ApiService, tipos compartidos)
  shared/    tabla paginada, barra de filtros, confirm-dialog
  features/  login · reagents · consumptions · users · profile
```

Standalone components, `ChangeDetectionStrategy.OnPush`, rutas con
`loadComponent` para que cada sección viaje en su propio chunk.

### 7.1 Estado con signals

Cada feature tiene un store: un servicio con signals privados de escritura y
`computed` públicos de lectura. El listado de reactivos mantiene un signal de
filtros (`name`, `locationId`, `minConsumed`, `from`, `to`, `page`, `pageSize`,
`sortBy`, `sortOrder`) y un resource derivado de él, de modo que cambiar cualquier
filtro dispara la petición sin suscripciones manuales. Los estados de carga y
error salen del propio resource, no de banderas booleanas paralelas que se
desincronizan.

El campo de búsqueda por nombre aplica un retardo de 300 ms antes de escribir en
el signal, para no lanzar una petición por tecla.

`AuthService` guarda el usuario en un signal; `currentUser()` e `isAdmin()` son
`computed` que los templates consultan para ocultar acciones de administrador.
Ocultar botones es comodidad visual: la autorización real vive en `RolesGuard`.
El interceptor añade el `Authorization` y, ante un 401, limpia la sesión y
redirige al login.

### 7.2 Pantallas del MVP

1. **Login.** Si el usuario tiene `mustChangePassword`, va directo a cambiar
   contraseña.
2. **Reactivos.** Tabla paginada con panel de filtros, incluido el compuesto por
   consumo. Alta y edición de reactivo y de lote en diálogo. Desactivación con
   confirmación.
3. **Registrar consumo.** Selección de reactivo, luego de lote (mostrando
   existencia y vencimiento), cantidad validada contra la existencia, fecha y
   propósito.
4. **Consumos.** Tabla en orden descendente con filtros. Anulación con
   justificación obligatoria, visible solo para ADMIN.
5. **Usuarios.** Solo ADMIN: crear con contraseña inicial, editar, desactivar.
6. **Cambiar contraseña.**

### 7.3 Interfaz en español

Las cadenas visibles se centralizan en un diccionario `es.ts` por feature, no como
literales sueltos en los templates. No se monta `@angular/localize` en el MVP
—hay un solo idioma de interfaz—, pero el diccionario permite añadirlo después sin
reescribir templates.

Formularios reactivos tipados. La validación del cliente refleja la del DTO, no la
sustituye.

## 8. Pruebas

- **Unitarias** (Jest, Prisma mockeado): transición de existencia al consumir y al
  anular, construcción del `where` según los filtros presentes, reglas de rol.
- **Integración** (Supertest, Postgres real en Docker, base por suite): login →
  registrar consumo → verificar existencia; anular → verificar reversión; usuario
  desactivado → 401 inmediato; filtro compuesto `minConsumed` con y sin rango de
  fechas.
- **Cliente**: stores de signals (derivación de filtros, estados de carga) y
  guards. No se prueban templates componente por componente: a esta escala el
  costo de mantenimiento supera al valor.

Se trabaja con TDD por fase: prueba en rojo, implementación, verde.

## 9. Configuración y despliegue

Las variables de entorno se validan con un esquema al arrancar: si falta
`JWT_SECRET` o `DATABASE_URL`, el proceso muere en el arranque en vez de fallar en
el primer login.

| Variable | Servicio | Uso |
|---|---|---|
| `DATABASE_URL` | api | Conexión a Neon |
| `JWT_SECRET` | api | Firma de tokens |
| `JWT_EXPIRES_IN` | api | Vigencia del token (8h) |
| `CORS_ORIGIN` | api | Dominio de Netlify |
| `SEED_ADMIN_USERNAME` | api | Semilla del primer administrador |
| `SEED_ADMIN_PASSWORD` | api | Semilla del primer administrador |
| `API_URL` | web | Base del API en Railway |

- **Neon**: dos ramas, `main` para producción y una de desarrollo para probar
  migraciones.
- **Railway**: `prisma migrate deploy` al arrancar el servicio.
- **Netlify**: build de `apps/web` desde la subcarpeta, con un archivo
  `_redirects` que enruta todas las rutas a `index.html` con código 200, para que
  el enrutado del cliente sobreviva a una recarga de página.

### 9.1 Primer administrador

Un script `prisma/seed.ts` idempotente lee `SEED_ADMIN_USERNAME` y
`SEED_ADMIN_PASSWORD` del entorno y crea el usuario ADMIN con
`mustChangePassword: true`. Ninguna credencial queda en el repositorio y el primer
inicio de sesión obliga a cambiarla.

## 10. Fases de implementación

1. Monorepo, Prisma, auth y usuarios, con los tres despliegues (Neon, Railway,
   Netlify) funcionando de punta a punta. El riesgo de infraestructura se paga
   temprano.
2. Locations, reagents y batches, con listado paginado y filtros simples.
3. Consumos: registro, listado descendente y anulación con justificación.
4. Filtros compuestos y refinamiento de la interfaz.

## 11. Fuera del alcance del MVP

- Importación de reactivos desde Excel, con verificación previa del usuario.
- Exportación de consumos a PDF y Excel.

El modelo las anticipa: `ReagentBatch` mapea fila a fila una plantilla de
importación, y los filtros de consumo ya devuelven exactamente el conjunto que se
exportaría. No se escribe código para ellas en el MVP.
