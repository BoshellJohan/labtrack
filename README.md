# LabTrack

Plataforma de inventario de reactivos para laboratorio: qué reactivos hay, en qué cantidad llegaron, dónde están y en qué se han consumido.

Nace de un problema concreto: un laboratorio universitario necesita justificar en qué se fue cada reactivo, y esa trazabilidad vive normalmente en una hoja de cálculo que nadie mantiene al día.

> **Convención de idioma.** El código, el esquema de base de datos y los mensajes de log están en **inglés**. La interfaz de usuario está íntegramente en **español**, y cada cadena visible vive en un diccionario `i18n.es.ts` — nunca incrustada en una plantilla.

<!-- IMAGEN: pantalla principal de la aplicación en uso.
     Pendiente: se añadirá una captura real cuando el laboratorio empiece a
     usarla con datos propios, y después del rediseño visual. -->

---

## Estado

Alcance planificado **completo** y desplegado: las cuatro fases del MVP más las dos funcionalidades que el diseño había dejado explícitamente fuera.

| Fase | Contenido |
|---|---|
| 1 | Monorepo, autenticación JWT, administración de usuarios, despliegue de punta a punta |
| 2 | Ubicaciones, reactivos y lotes; listados paginados con filtros simples |
| 3 | Consumos: registro, listado descendente y anulación con justificación |
| 4 | Filtro compuesto por consumo y deuda de interfaz |
| — | Exportación de consumos a Excel y PDF |
| — | Importación de reactivos desde Excel con vista previa |

**Suites:** 129 pruebas unitarias de API · 148 end-to-end contra PostgreSQL real · 113 en el cliente.

---

## Stack y versiones

| Capa | Tecnología | Versión |
|---|---|---|
| Runtime | Node.js | `>= 24` |
| API | NestJS | 11 |
| ORM | Prisma (con driver adapter) | 7.9 |
| Base de datos | PostgreSQL | 18 |
| Cliente | Angular (standalone + signals) | 22.1 |
| Componentes | Angular Material 3 | 22.1 |
| Lenguaje | TypeScript | 6.0 |
| Validación | class-validator · zod | 0.15 · 4.4 |
| Documentos | ExcelJS · PDFKit | 4.4 · 0.20 |
| Pruebas | Jest + Supertest · Vitest | 30 · 4 |

**Despliegue:** cliente en Netlify, API en Railway, base de datos en Neon.

---

## Arquitectura

Monorepo con workspaces de npm y un paquete compartido que ambos extremos consumen, de modo que un cambio de contrato rompe la compilación en los dos lados a la vez en lugar de aparecer en tiempo de ejecución en uno.

```
apps/
  api/        NestJS · controller · service · module · dto por módulo
  web/        Angular · componentes standalone, un store con signals por pantalla
packages/
  shared/     DTOs y tipos que cruzan el cable
docs/
  superpowers/specs/   documentos de diseño
  superpowers/plans/   planes de implementación
```

### Decisiones que explican el resto del código

**Nada se borra físicamente.** Cada tabla lleva un campo `active`, y "eliminar" es ponerlo en `false`. Un registro desactivado es invisible para todo el mundo salvo un administrador, y esa regla se aplica en el servidor en las cuatro superficies de filtrado del sistema.

**Las cantidades son `Decimal(12,4)` y viajan como cadenas.** Un `number` de JavaScript no las representa con fidelidad. Hay una sola excepción, deliberada y acotada: la celda numérica del Excel exportado, porque una columna de texto no se puede sumar y el archivo no cumpliría su único propósito.

**Las unidades no se convierten nunca.** Un reactivo puede tener lotes en mililitros y en litros a la vez, así que las existencias se agrupan **por unidad** y nunca se suman entre ellas. Una cifra sin su unidad no aparece en ninguna pantalla.

**Toda escritura de lectura-y-después-escritura ocurre en una transacción Serializable.** Registrar un consumo valida las existencias y las decrementa en el mismo bloque; con un aislamiento más débil, dos peticiones simultáneas podrían leer un stock que permite ambas y sobregirar el lote.

**La aritmética decimal la hace Postgres**, no Node: los movimientos de existencias usan `increment` y `decrement` sobre la columna.

---

## Funcionalidades

### Autenticación y usuarios

Sin registro público. Un administrador crea los usuarios con una contraseña inicial, y el sistema obliga a cambiarla en el primer acceso. La estrategia JWT **revalida el usuario en cada petición**, de modo que desactivar a alguien lo expulsa de inmediato en lugar de esperar a que caduque su token.

<!-- IMAGEN: pantalla de login y de administración de usuarios. -->

### Inventario

Ubicaciones, reactivos y lotes. Un reactivo es la sustancia; un **lote** es una entrega física concreta, con su número, sus fechas, su unidad y su ubicación. El consumo se registra siempre contra un lote, y de ahí sale la unidad sin ambigüedad.

El listado es paginado —nunca se consulta todo— y filtra por nombre (parcial, **insensible a mayúsculas y acentos**, con índice de trigramas), CAS, ubicación, próximo vencimiento y existencias bajas.

<!-- IMAGEN: listado de reactivos con el panel de filtros y los lotes desplegados. -->

### Consumos

Registro guiado: se elige el reactivo, después el lote —mostrando existencias y vencimiento—, y la cantidad se valida contra el stock antes de enviar nada.

El listado va en orden descendente con filtros por reactivo, lote, autor, propósito y rango de fechas. **La anulación es solo para administradores y exige justificación**: devuelve la cantidad al lote, y el motivo queda en la propia fila, de modo que explicar una desaparición no requiere consultar una tabla de auditoría aparte.

<!-- IMAGEN: registro de consumo y listado con una fila anulada mostrando su motivo. -->

### Filtro compuesto

"Reactivos cuyo consumo superó X en un rango de fechas" no es expresable como un filtro sobre reactivos: es una agregación con `HAVING` sobre consumos agrupados. Se resuelve con una consulta preparada que devuelve los identificadores que califican, y el camino normal de Prisma hidrata el resto.

**El umbral exige una unidad.** Sumar mililitros con litros produciría una cifra que no corresponde a ninguna cantidad física, así que el filtro opera dentro de una unidad.

<!-- IMAGEN: panel de filtro compuesto en la pantalla de reactivos. -->

### Exportación

`GET /consumptions/export.xlsx` y `export.pdf`, sobre exactamente los mismos filtros que el listado.

- **Excel** — tabla plana para analizar. La cantidad es celda numérica y la unidad va en columna propia, de modo que una tabla dinámica pueda agrupar por reactivo *y* unidad.
- **PDF** — informe archivable. Declara el periodo, **los filtros aplicados en texto legible**, quién lo generó y cuándo. Se genera en el servidor porque es el único que puede afirmar con autoridad lo último.

Ambos cuentan antes de escribir: una vez empieza el streaming el código de estado ya se envió, así que un rechazo por exceso de filas llega como error y nunca como archivo truncado.

<!-- IMAGEN: PDF generado, mostrando el encabezado con periodo, filtros y autor. -->

### Importación

Dos pasos sin estado en el servidor. La vista previa parsea, valida y **no escribe nada**; la confirmación revalida con la misma función y aplica todo en una transacción única.

Una fila describe un lote y, con él, su reactivo — que se crea si no existe. Como nada identifica un reactivo de forma única, la coincidencia es por **nombre y CAS juntos**, y un error de tecleo produciría un duplicado casi idéntico sin dar error. Por eso la vista previa dice, fila a fila, si va a **crear o reutilizar** un reactivo: es lo único que hace visible ese riesgo antes de escribir.

**Una sola fila inválida bloquea toda la importación.** Se corrige el archivo y se vuelve a subir; así nunca hay que averiguar qué entró y qué no.

<!-- IMAGEN: vista previa de importación con la columna crear/reutilizar y una fila con error. -->

---

## Puesta en marcha

Requiere Node 24 y un PostgreSQL accesible.

```bash
npm ci
cp apps/api/.env.example apps/api/.env    # y completar los valores
npm run db:seed -w apps/api               # crea el administrador inicial
npm run start:dev -w apps/api             # API en :3000
npm start -w apps/web                     # cliente en :4200
```

El seed toma el usuario y la contraseña de `SEED_ADMIN_USERNAME` y `SEED_ADMIN_PASSWORD`, y crea la cuenta con cambio de contraseña obligatorio. Es idempotente: si el usuario ya existe, no hace nada.

### Pruebas

```bash
npm run test -w apps/api        # unitarias
npm run test:e2e -w apps/api    # contra un PostgreSQL real
npm run test -w apps/web
```

Las suites e2e truncan tablas y se ejecutan en serie. **Conviene no tener un servidor de desarrollo levantado mientras corren**: una conexión viva bloquea el `TRUNCATE` y produce fallos que no dejan rastro en la propia salida.

### Despliegue

En Railway, `start:prod` ejecuta `prisma migrate deploy` antes de arrancar, así que las migraciones se aplican solas. La migración de búsqueda por nombre crea las extensiones `unaccent` y `pg_trgm`, lo que requiere que el rol de base de datos pueda crearlas.

En Netlify, el build genera la configuración del cliente a partir de la variable `API_URL` y **falla si no está definida**, en lugar de publicar un cliente apuntando al host equivocado.

---

## Documentación de diseño

Cada funcionalidad tiene su documento de diseño y su plan de implementación en [`docs/superpowers/`](docs/superpowers/). Los documentos registran también las decisiones que se revisaron y las que resultaron equivocadas, con el motivo — son más útiles leídos como el historial de un razonamiento que como una especificación cerrada.

## Fuera de alcance

Conversión entre unidades, gestión de proveedores o pedidos, y deshacer una importación ya confirmada.

## Licencia

Sin licencia definida todavía.
