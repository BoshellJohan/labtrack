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
  exportExcel: 'Descargar Excel',
  exportPdf: 'Descargar PDF',
  exportFailed: 'No se pudo generar el archivo.',
  exportTooLarge: 'El filtro devuelve demasiadas filas. Acota el rango de fechas.',
} as const;

export const VOID_CONSUMPTION_ES = {
  title: 'Anular consumo',
  explanation:
    'La cantidad volverá a las existencias del lote y el consumo quedará marcado como anulado. Esta acción queda registrada con tu usuario.',
  reason: 'Justificación',
  reasonRequired: 'La justificación es obligatoria.',
  confirm: 'Anular',
  failure: 'No se pudo anular el consumo.',
  conflict: 'Otro administrador anuló este consumo al mismo tiempo. Actualiza la lista.',
  alreadyVoided: 'Este consumo ya estaba anulado.',
} as const;
