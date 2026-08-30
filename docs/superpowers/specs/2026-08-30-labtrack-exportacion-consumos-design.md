# LabTrack — Exportación de consumos a PDF y Excel

**Fecha:** 2026-08-30
**Estado:** aprobado en diseño, pendiente de plan de implementación
**Relación con el MVP:** primera de las dos funcionalidades que el §11 del diseño
del MVP (`2026-08-23-labtrack-mvp-design.md`) dejó explícitamente fuera. La otra,
la importación de reactivos desde Excel, es un proyecto independiente con su
propia spec; no se aborda aquí.

## 1. Propósito

Un laboratorio necesita justificar en qué se fue un reactivo. Hoy esa información
existe en la pantalla de consumos pero solo se puede mirar, no llevar: no hay
forma de entregar un respaldo a una auditoría ni de analizar el consumo de un
periodo en una hoja de cálculo.

Los dos formatos cubren usos distintos y por eso no son el mismo documento en dos
envoltorios:

- **PDF** — un informe que se imprime, se archiva y sirve de respaldo. Declara
  qué periodo cubre, qué filtros se aplicaron, quién lo generó y cuándo.
- **Excel** — la tabla plana para analizar: tablas dinámicas, gráficos, sumas.

## 2. Alcance

Se exporta **todo el conjunto que casa con los filtros vigentes**, no la página
visible. Un informe de "la página 3 de 7" no le sirve a nadie.

Fuera de alcance: exportar reactivos, ubicaciones o usuarios; programar envíos;
guardar los archivos generados en el servidor.

## 3. Decisión de arquitectura: la generación ocurre en el servidor

Se evaluó generar los archivos en el navegador. Se descarta por dos razones, y la
primera pesa más que cualquier consideración de rendimiento.

**Un documento que atestigua no puede generarlo quien no puede atestiguar.** El
PDF afirma quién lo generó y cuándo. Si eso lo escribe el cliente, es texto que el
navegador decidió poner ahí. Solo el servidor conoce al usuario autenticado y
puede afirmarlo con autoridad.

**La regla de visibilidad vive en el servidor.** `ConsumptionsService.list()`
oculta a quien no es administrador los consumos de reactivos y lotes
desactivados. Generar en el cliente obligaría a pedir el conjunto completo por el
API de todos modos, y dejaría la regla en un sitio y su consumidor en otro.

Consideración secundaria: las librerías de PDF son pesadas y el presupuesto de
bundle del cliente está en 416 kB de 500 kB.

Costo aceptado: memoria y tiempo de respuesta en Railway. Se mitiga con streaming
y un tope explícito de filas (§7), no fingiendo que escala.

## 4. La extracción que hace posible todo lo demás

Hoy el `where` de los consumos se construye **dentro** de `list()`
(`apps/api/src/consumptions/consumptions.service.ts`), y ahí vive la regla que
oculta reactivos y lotes desactivados a los no administradores.

**Primer trabajo, antes de exportar nada:** extraer

```ts
export function buildConsumptionWhere(
  query: ListConsumptionsQueryDto,
  isAdmin: boolean,
): Prisma.ConsumptionWhereInput
```

a su propio módulo, siguiendo el precedente de `buildReagentWhere` en reactivos, y
hacer que `list()` la use sin cambiar su comportamiento.

Esto no es higiene opcional. La revisión final de la Fase 3 encontró que
`GET /consumptions` filtraba solo la fila del consumo y no su lote ni su
reactivo, exponiendo nombres de reactivos desactivados a usuarios normales. La
Fase 3 había blindado esa misma regla en tres sitios donde no era alcanzable, y la
alcanzable llegó dos tareas después. Una exportación que construya su propio
`where` es exactamente ese error otra vez, en un formato nuevo.

Tras la extracción, la diferencia entre listar y exportar queda reducida a lo que
de verdad las distingue: `list()` pagina y cuenta; la exportación recorre el
conjunto ordenado completo.

## 5. Endpoints

| Ruta | Devuelve |
|---|---|
| `GET /consumptions/export.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `GET /consumptions/export.pdf` | `application/pdf` |

Ambos aceptan **exactamente los mismos parámetros** que `GET /consumptions`
(`reagentId`, `batchId`, `madeById`, `purpose`, `from`, `to`, `includeVoided`,
`sortBy`, `sortOrder`), reutilizando `ListConsumptionsQueryDto` sin sus campos de
paginación.

`Content-Disposition: attachment` con un nombre que incluye el rango cubierto:
`consumos-2026-08-01-a-2026-08-31.xlsx`. Sin rango de fechas, se usa la fecha de
generación. El archivo termina en la carpeta de descargas de alguien junto a
otros cinco iguales; el nombre es lo único que los distingue.

### 5.1 Autorización

La misma que ver el listado: cualquier usuario autenticado. Quien puede leer un
consumo puede exportarlo, y `includeVoided` sigue restringido a administradores
por el mismo `assertIncludeInactiveAllowed` que ya gobierna las cuatro superficies
de filtrado del sistema (reactivos, ubicaciones, lotes y consumos). La exportación
no abre ninguna puerta nueva ni añade una quinta copia de esa regla.

## 6. Los documentos

### 6.1 Excel — ExcelJS, escrito en streaming

Una hoja, una fila por consumo, con encabezados de columna:

| Columna | Tipo de celda |
|---|---|
| Fecha | fecha |
| Reactivo | texto |
| Lote | texto |
| Cantidad | **numérica** |
| Unidad | texto |
| Propósito | texto |
| Registrado por | texto |
| Estado | texto |

Cuando quien exporta es administrador **y** pidió `includeVoided`, se añaden
*Motivo de anulación*, *Anulado por* y *Fecha de anulación*. Con filtros que no
pueden devolver anulados, esas columnas no aparecen: una columna siempre vacía
enseña al lector a ignorarla.

**La cantidad va como celda numérica, no como texto.** Esto contradice la
disciplina que el proyecto sostiene desde la Fase 2 —los `Decimal(12,4)` viajan
como cadenas— y la contradice a propósito. El destino de este archivo es una hoja
de cálculo: una columna de texto no se suma ni entra en una tabla dinámica, y el
archivo no cumpliría su único propósito.

La salvedad, dicha entera para que nadie la descubra después: Excel representa
todo número como coma flotante. La conversión no introduce una pérdida que Excel
no tuviera ya; el formato de destino no sabe representar un decimal exacto. No se
está degradando el dato por comodidad, se está aceptando el límite del destino.

**La unidad va en columna propia, nunca pegada a la cantidad.** Pegadas, la celda
deja de ser numérica y se pierde lo anterior. Separadas, permiten agrupar por
reactivo *y unidad*, la única agrupación con sentido físico — la misma regla que
sostiene `stockByUnit` y el filtro compuesto del §6.2 del MVP.

### 6.2 PDF — PDFKit, escrito en streaming

Encabezado:

- Nombre del laboratorio (§8)
- Periodo cubierto
- **Filtros aplicados en texto legible**: "Reactivo: Acetona · Propósito contiene
  'titulación'". Un informe que no dice qué excluye no sirve como respaldo.
- Generado por *(nombre completo del usuario autenticado)* el *(fecha y hora)*

Después, la tabla paginada con numeración de página.

Aquí la cantidad **sí** se formatea junto a su unidad, porque un PDF se lee y no
se suma, y un número sin unidad es ambiguo entre mililitros y litros (§4.1 del
MVP).

Se elige PDFKit sobre pdfmake por una razón concreta: pdfmake necesita un árbol
de definición del documento completo, ya maquetado, antes de escribir un solo
byte. PDFKit escribe cada página según la dibuja — pero la numeración "página N
de <total>" exige conocer el total, que no existe hasta dibujar la última fila,
así que PDFKit la retiene con `bufferPages: true` para poder volver atrás y
sellarla al final. Eso no es streaming sin búfer; es un búfer más liviano que el
de pdfmake (páginas ya renderizadas, no un árbol de definición completo). Lo que
de verdad acota la memoria de este camino es el tope de filas del §7, no el modo
de escritura de PDFKit.

## 7. El conteo va primero

Una vez empieza a escribirse el archivo, las cabeceras HTTP ya se enviaron: un
fallo a mitad de stream no se puede reportar limpiamente y el usuario recibe un
archivo truncado que parece válido.

Por eso el flujo cuenta antes de escribir, con el mismo `where`:

1. `count` sobre `buildConsumptionWhere(query, isAdmin)`.
2. Si supera el tope, **400** indicando cuántas filas casan y que hay que acotar
   el rango. Un error legible es mejor que un contenedor caído en silencio.
3. Si no, se escriben las cabeceras y se transmite el archivo.

**Tope: 10.000 filas.** Es una cifra elegida, no derivada: sobra para el periodo
que un laboratorio universitario exporta de una vez y queda muy por debajo de lo
que compromete un contenedor pequeño. Si resulta baja en uso real, se sube; lo que
no se hace es quitarla.

## 8. Configuración

`LAB_NAME` entra en el esquema de zod de `apps/api/src/config/env.ts` **con valor
por defecto**, no como obligatoria.

La razón es operativa: `main` despliega automáticamente, y una variable requerida
dejaría el API sin arrancar en el siguiente despliegue por culpa de una cadena de
encabezado. Costo aceptado y dicho: si nadie la configura, el PDF sale con el
nombre por defecto.

## 9. Pruebas

Dos pruebas cargan con esta funcionalidad. El resto es cobertura.

**Exportación y listado devuelven el mismo conjunto.** Para unos filtros dados, el
número de filas exportadas es igual al `total` que devuelve `GET /consumptions`.
Esto ancla el `where` compartido y falla en cuanto alguien lo duplique o lo deje
divergir — que es el modo de fallo del §4.

**Un usuario no administrador exporta y el archivo no contiene el nombre de un
reactivo desactivado.** Es la fuga de la Fase 3 un formato más allá, y el sitio
exacto donde reaparecería si la extracción del `where` se hiciera mal. Debe
comprobarse sobre el contenido del archivo generado, no sobre la consulta.

Además: tipo de contenido y `Content-Disposition` correctos en ambos formatos; el
tope de filas devuelve 400 y no un archivo; `includeVoided` sigue rechazándose a
un no administrador con 403; y las columnas de anulación aparecen solo cuando
corresponde.

## 10. El cliente

Esta spec definió los endpoints (§5) y nunca describió cómo alguien llega a
ellos — una omisión detectada al escribir el plan y cerrada solo al construir
la pantalla. Se deja constancia aquí de lo que la rama construyó, no de una
decisión tomada de antemano.

**La exportación cubre lo que la persona está viendo, nunca la página.** Los
dos botones ("Descargar Excel", "Descargar PDF") se arman a partir de los
mismos filtros que la tabla de consumos tiene aplicados en ese momento —
propósito, reactivo, rango de fechas, `includeVoided` — pero nunca de la
página ni el tamaño de página. Enviarlos sería invitar a que alguien los
respetara más adelante, y de todos modos los endpoints los ignoran (§5):
mandarlos sin que hagan nada es peor que no mandarlos, porque parece una
promesa que no se cumple.

**La descarga pasa por el mismo cliente HTTP que todo lo demás, nunca por un
enlace plano.** Ambas rutas exigen `JwtAuthGuard`, y el interceptor que añade
el token solo actúa sobre las llamadas de `HttpClient` — una navegación de
`<a href>` llegaría sin cabecera `Authorization` y recibiría 401. La
alternativa habría sido aceptar el token como parámetro de consulta, y se
descartó: un token en una URL queda escrito en el historial del navegador, en
los registros del servidor y en cualquier proxy intermedio, sin forma de
retirarlo después. En su lugar, el botón pide el archivo por `HttpClient` (con
el token puesto por el interceptor), recibe la respuesta como `Blob` y
descarga desde una URL de objeto temporal, revocada apenas se dispara la
descarga. Cuesta algo más de código a cambio de que la credencial nunca toque
una URL.

**El 400 por exceso de filas (§7) tiene su propio mensaje.** Es el único fallo
que la persona puede corregir por sí misma — acotar el rango de fechas — así
que decirle "no se pudo generar el archivo" desperdiciaría lo único útil que
el servidor ya dijo. Cualquier otro fallo cae al mensaje genérico.

**CORS debe exponer `Content-Disposition`, o el navegador no puede leer el
nombre del archivo.** Por la propia especificación de CORS, el JavaScript de
una página solo puede leer, entre orígenes distintos, una lista corta de
cabeceras por defecto — `Content-Disposition` no está en ella salvo que el
servidor la declare explícitamente en `exposedHeaders`. Sin eso, la descarga
funciona (el archivo llega íntegro) pero el nombre que calculó el servidor
(§5) es invisible para el navegador, que cae a uno genérico sin que nada lo
señale como error. Esto no es un detalle de entorno local: Netlify y Railway
separan el cliente y el API en orígenes distintos por definición, así que sin
esta cabecera expuesta el problema existe también en producción.

## 11. Fuera del alcance de esta spec

- Importación de reactivos desde Excel — proyecto independiente, spec propia.
- Exportar cualquier entidad que no sean consumos.
- Envío programado o por correo de los informes.
- Almacenar en el servidor los archivos generados.
