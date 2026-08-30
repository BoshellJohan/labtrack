# LabTrack — Importación de reactivos desde Excel

**Fecha:** 2026-08-30
**Estado:** aprobado en diseño, pendiente de plan de implementación
**Relación con el MVP:** segunda de las dos funcionalidades que el §11 del diseño
del MVP (`2026-08-23-labtrack-mvp-design.md`) dejó fuera. La primera, la
exportación de consumos, ya está implementada
(`2026-08-30-labtrack-exportacion-consumos-design.md`).

## 1. Propósito

Un laboratorio que empieza a usar LabTrack tiene su inventario en una hoja de
cálculo. Teclear cientos de reactivos y lotes a mano es el trabajo que impide
adoptar el sistema, y es exactamente el trabajo que una máquina hace bien.

Esta funcionalidad escribe en el inventario, que la distingue de todo lo demás
que se ha construido hasta ahora: un error en la exportación produce un archivo
feo; un error aquí produce un inventario que no coincide con el estante, y nadie
lo descubre hasta que alguien va a buscar un reactivo.

De ahí que el diseño esté organizado alrededor de una sola idea: **el usuario ve
exactamente qué va a pasar antes de que pase, y si algo está mal no pasa nada**.

## 2. Qué es una fila

Una fila describe **un lote**, y con él los datos del reactivo al que pertenece.

- Si ese reactivo ya existe, se le añade el lote.
- Si no existe, se crea el reactivo y después su lote.

Esto es lo que hace útil una carga inicial. La alternativa —solo lotes de
reactivos que ya existen— obliga a dar de alta a mano cada reactivo antes de
poder importar nada, que es el trabajo que esta funcionalidad venía a evitar.

## 3. Cómo se decide si un reactivo ya existe

**Nada identifica un reactivo de forma única en la base**: ni `name` ni
`casNumber` tienen restricción de unicidad, y el §4.3 del MVP lo dice
explícitamente — un mismo CAS admite presentaciones distintas.

**La coincidencia es por nombre y CAS juntos.** Coinciden los dos, es el mismo
reactivo; difiere cualquiera, es uno nuevo.

La comparación de nombres ignora mayúsculas y acentos, reutilizando la columna
generada `nameNormalized` que ya existe para el buscador (§6.1 del MVP). Un caso
menos de duplicado silencioso, sin código nuevo.

**El riesgo de esta regla, dicho antes de que muerda:** un error de tecleo en el
nombre —`Acetona ` con espacio, `Acetóna`— no produce un error. Produce un
reactivo nuevo casi idéntico al que ya había. Nadie detecta eso leyendo una lista
de filas marcadas como válidas.

Por eso el §5 no es un adorno.

## 4. Sin estado entre los dos pasos

`POST /reagents/import/preview` recibe el archivo, lo parsea, lo valida y **no
escribe nada**. Devuelve las filas validadas con su veredicto.

`POST /reagents/import/confirm` recibe esas filas como JSON, **las vuelve a
validar** con la misma función, y escribe.

La revalidación es lo que hace segura esta arquitectura. El servidor nunca confía
en lo que el cliente le devuelve; y como es la misma función en ambos pasos, no
pueden divergir — la misma disciplina que el `where` compartido de la
exportación.

La objeción evidente —"¿y si el cliente manipula lo que reenvía?"— se disuelve
sola: ese usuario está autenticado y autorizado para crear reactivos y lotes,
así que podría hacer esas peticiones directamente. Manipular el reenvío no le
concede nada que no tuviera ya.

**Alternativas descartadas.** Guardar el lote parseado en el servidor bajo un
identificador introduce un concepto nuevo con ciclo de vida —dónde vive, cuándo
caduca, quién lo limpia— para un dato que dura dos minutos. Reenviar el archivo
en la confirmación parece más limpio y tiene un fallo que la vacía: nada
garantiza que sea el mismo archivo que se previsualizó, de modo que podría
importarse algo que nadie vio, en una funcionalidad cuyo propósito entero es
confirmar antes de escribir.

### 4.1 Autorización

**Solo ADMIN**, en ambos endpoints. Crear reactivos y lotes ya lo es; la
importación no debe ser una puerta lateral a algo que el alta manual restringe.

### 4.2 Topes

- **1.000 filas.** Más bajo que el de la exportación a propósito: la importación
  mantiene los datos en memoria dos veces —el parseo y la transacción— y, sobre
  todo, nadie revisa de verdad una vista previa más larga. Un tope que también
  protege al usuario de aprobar a ciegas.
- **Un límite de bytes en la subida**, obligatorio. Un endpoint que acepta
  archivos es superficie de ataque nueva; el límite de tamaño y la validación de
  tipo no son opcionales.

## 5. La vista previa

Por cada fila, el veredicto dice si va a **crear** un reactivo o **reutilizar**
uno existente, nombrando cuál reutilizará.

Esa columna es lo que convierte el riesgo del §3 en algo visible. Un "creará
reactivo nuevo" junto a una fila donde el usuario esperaba que reutilizara uno
existente salta a la vista; una lista de filas válidas no dice nada.

Encabezando la vista, el resumen: cuántos reactivos se crearán, cuántos se
reutilizarán, cuántos lotes entran y cuántas filas están mal.

**Con una sola fila inválida, confirmar queda deshabilitado.** Se corrige el
archivo y se vuelve a subir. Una importación es una transacción: o entra entera o
no entra, y así nunca hay que averiguar qué quedó dentro.

## 6. La plantilla y la validación

Columnas, con los encabezados en español y los mismos nombres que usa la
exportación, para que un archivo exportado sirva de plantilla:

| Columna | Obligatoria | Regla |
|---|---|---|
| Reactivo | sí | no vacío |
| CAS | sí | formato y dígito de verificación (§6.4) |
| Referencia | no | texto |
| Lote | sí | no vacío, máx. 60 |
| Fecha de entrada | sí | fecha |
| Fecha de vencimiento | no | posterior a la de entrada |
| Cantidad | sí | decimal, hasta 4 decimales (§6.1) |
| Unidad | sí | valor del enum (§6.2) |
| Ubicación | sí | nombre de una ubicación activa |

### 6.1 La cantidad se lee del valor de la celda, no de su texto

Una primera versión de esta spec decía lo contrario —leer el texto— con el
argumento de que un `Decimal(12,4)` no sobrevive a un `double`. **Ese argumento
era falso y la medición lo desmintió**, así que la decisión cambió con él.

No hay pérdida de precisión por ninguna de las dos vías: `Decimal(12,4)` admite
como mucho 12 dígitos significativos y un `double` los redondea sin ambigüedad
hasta 15 o 17, de modo que convertir el número a cadena recupera el decimal
exacto que el usuario escribió.

Lo que sí cambia entre las dos vías es la robustez frente al formato. Medido
contra ExcelJS: una celda numérica con formato `0.0000` devuelve `text = "2.5"`,
es decir, **el texto depende de cómo se muestre la celda**, y en una
configuración regional que use coma decimal podría llegar como `"2,5"` — un valor
correcto que nuestra validación rechazaría.

Por eso se lee `cell.value`: si es número, se convierte a cadena; si es texto, se
usa tal cual. Después se valida con el mismo patrón que aplica el API
(`/^\d{1,8}(\.\d{1,4})?$/`).

Consecuencia aceptada: una celda **de texto** que contenga `2,5` se rechaza con
un mensaje claro en lugar de interpretarse. Adivinar la intención de un separador
decimal en una importación de inventario es cómo entra una cantidad que nadie
escribió.

### 6.2 Las unidades se aceptan literales

El enum es `G, MG, KG, ML, L, UNIT`. Se acepta el valor exacto sin distinguir
mayúsculas, y **se rechaza todo lo demás** con un mensaje que enumera las
opciones válidas.

No se traduce "litros" a `L` ni "ml." a `ML`. Traducir es adivinar, y el coste de
acertar a medias en la unidad de un inventario es una cantidad correcta colgada
de la magnitud equivocada.

### 6.3 Lotes repetidos dentro del mismo archivo

Dos filas con el mismo reactivo y el mismo número de lote chocan con el índice
único parcial `(reagentId, lotNumber) WHERE active` que ya existe.

Dejarlo a la base significa que la transacción entera falla a mitad de escritura
con un error de Postgres. **Se detecta en la validación**, y el mensaje señala
**las dos filas**: quien corrige necesita saber cuál es la otra.

### 6.4 El dígito de verificación del CAS

**El §4.3 del MVP dice que el CAS se valida con su dígito de verificación
estándar. El código no lo hace**: `create-reagent.dto.ts` comprueba solo la forma
`\d{2,7}-\d{2}-\d`, así que hoy `12345-67-9` se acepta aunque su dígito sea
incorrecto.

La discrepancia es tolerable dando de alta reactivos de uno en uno. Deja de serlo
en una importación masiva, que es precisamente donde entran cientos de CAS
copiados de un catálogo.

Se cierra como parte de este trabajo, en un validador compartido que aplica
también al alta manual: una sola definición de qué es un CAS válido. El cálculo
es la suma de cada dígito multiplicado por su posición desde la derecha, módulo
10.

## 7. Escritura

**Una sola transacción**, con el nivel Serializable que usa el resto de las
escrituras read-then-write del proyecto.

Cada reactivo y cada lote registran su autor igual que un alta manual:
`madeById` sale del usuario autenticado, **nunca del archivo**.

## 8. Pruebas

Tres cargan con esta funcionalidad. El resto es cobertura.

**Una fila inválida impide escribir cualquier cosa.** Con tres filas buenas y una
mala, la base queda exactamente como estaba. Verifica que "todo o nada" es un
comportamiento y no una intención.

**Confirmar no confía en la vista previa.** Enviar al endpoint de confirmación
filas manipuladas —una cantidad negativa, una ubicación inexistente— las
revalida y las rechaza. Sin esta prueba, la arquitectura sin estado del §4 sería
insegura y nadie lo notaría.

**La regla de identidad, en sus cuatro casos.** Nombre y CAS iguales reutiliza;
nombre igual y CAS distinto crea; nombre distinto y CAS igual crea; nombre igual
salvo acentos y mayúsculas reutiliza. Es la regla del §3, y equivocarse duplica
inventario en silencio.

Además: el tope de filas rechaza sin escribir; un no administrador recibe 403 en
ambos endpoints; un archivo que no es Excel se rechaza; y dos filas con el mismo
lote se señalan mutuamente.

## 9. Fuera del alcance de esta spec

- Actualizar reactivos o lotes existentes. Esta importación **solo crea**; una
  fila que coincide con un reactivo existente le añade un lote, nunca modifica
  sus datos.
- Importar consumos, ubicaciones o usuarios.
- Deshacer una importación ya confirmada.
- CSV u otros formatos.
