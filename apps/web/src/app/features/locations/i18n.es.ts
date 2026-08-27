export const LOCATIONS_ES = {
  title: 'Ubicaciones',
  searchPlaceholder: 'Buscar por nombre',
  newLocation: 'Nueva ubicación',
  editLocation: 'Editar ubicación',
  columns: {
    name: 'Nombre',
    description: 'Descripción',
    status: 'Estado',
    actions: 'Acciones',
  },
  status: { active: 'Activa', inactive: 'Inactiva' },
  edit: 'Editar',
  deactivate: 'Desactivar',
  confirmDeactivate:
    '¿Desactivar esta ubicación? Podrá consultarse, pero no podrá asignarse a nuevos lotes.',
  form: {
    name: 'Nombre',
    description: 'Descripción',
    nameTaken: 'Ese nombre ya existe',
  },
  emptyState: 'No hay ubicaciones que coincidan con la búsqueda.',
} as const;
