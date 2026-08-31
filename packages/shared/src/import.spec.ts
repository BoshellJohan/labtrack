import { IMPORT_COLUMNS, IMPORT_ROW_LIMIT } from './import';

describe('the import contract', () => {
  it('names every column the template requires, in order', () => {
    expect(IMPORT_COLUMNS).toEqual([
      'Reactivo',
      'CAS',
      'Referencia',
      'Lote',
      'Fecha de entrada',
      'Fecha de vencimiento',
      'Cantidad',
      'Unidad',
      'Ubicación',
    ]);
  });

  it('caps an import well below the export, because a human has to read the preview', () => {
    expect(IMPORT_ROW_LIMIT).toBe(1000);
  });
});
