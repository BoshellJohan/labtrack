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
    unit: 'Unidad',
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

  // The API sends a stable code per issue and the client turns it into Spanish
  // (§5.4 of the MVP spec). These strings are what a technician reads while
  // fixing a spreadsheet, so they name the cell's problem and, where it helps,
  // what a valid value looks like.
  issues: {
    REQUIRED: () => 'Falta este dato.',
    INVALID_CAS: () => 'El número CAS no es válido. Revisa el dígito final.',
    INVALID_QUANTITY: () =>
      'Escribe la cantidad con punto decimal y hasta 4 decimales, por ejemplo 2.5',
    INVALID_UNIT: (p: { allowed: readonly string[] }) =>
      `Unidad no reconocida. Usa una de: ${p.allowed.join(', ')}`,
    INVALID_DATE: () => 'La fecha no es válida.',
    EXPIRATION_BEFORE_ENTRY: () =>
      'El vencimiento debe ser posterior a la fecha de entrada.',
    TOO_LONG: (p: { max: number }) => `Máximo ${p.max} caracteres.`,
    DUPLICATE_LOT: (p: { rows: readonly number[] }) =>
      `Este lote se repite en la fila ${p.rows.join(', ')}.`,
    LOCATION_NOT_FOUND: () =>
      'Esta ubicación no existe. Créala antes de importar.',
  },
} as const;
