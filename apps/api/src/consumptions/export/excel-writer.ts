import { Writable } from 'node:stream';
import * as ExcelJS from 'exceljs';
import { ConsumptionDto } from '@labtrack/shared';

const BASE_COLUMNS = [
  { header: 'Fecha', key: 'consumedAt', width: 12 },
  { header: 'Reactivo', key: 'reagentName', width: 28 },
  { header: 'Lote', key: 'lotNumber', width: 16 },
  { header: 'Cantidad', key: 'quantity', width: 12 },
  { header: 'Unidad', key: 'unit', width: 10 },
  { header: 'Propósito', key: 'purpose', width: 40 },
  { header: 'Registrado por', key: 'madeByName', width: 24 },
  { header: 'Estado', key: 'status', width: 12 },
];

const VOID_COLUMNS = [
  { header: 'Motivo de anulación', key: 'voidReason', width: 40 },
  { header: 'Anulado por', key: 'voidedByName', width: 24 },
  { header: 'Fecha de anulación', key: 'voidedAt', width: 18 },
];

/**
 * Writes the rows straight to `stream` rather than building a workbook in
 * memory — the row cap exists because of the container's memory, and holding
 * the whole file would spend it anyway.
 */
export async function writeConsumptionsWorkbook(
  rows: ConsumptionDto[],
  includeVoidColumns: boolean,
  stream: Writable,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream });
  const sheet = workbook.addWorksheet('Consumos');
  sheet.columns = includeVoidColumns
    ? [...BASE_COLUMNS, ...VOID_COLUMNS]
    : BASE_COLUMNS;

  for (const row of rows) {
    sheet
      .addRow({
        consumedAt: new Date(row.consumedAt),
        reagentName: row.reagentName,
        lotNumber: row.lotNumber,
        // A number, not a string. This is the one place the project's
        // decimal-as-string rule is broken, and deliberately: the destination
        // is a spreadsheet, and a text column cannot be summed or pivoted, so
        // the file would not do the only job it exists for. Excel stores every
        // number as a float regardless, so this adds no loss the format did not
        // already have. Do not copy this exception anywhere else.
        quantity: Number(row.quantity),
        // Its own column, never appended to the quantity: joined, the cell
        // stops being numeric and the point above is lost. Separate, it lets a
        // pivot group by reagent AND unit — the only grouping with physical
        // meaning, since consumption never converts between units.
        unit: row.unit,
        purpose: row.purpose,
        madeByName: row.madeByName,
        status: row.active ? 'Vigente' : 'Anulado',
        ...(includeVoidColumns
          ? {
              voidReason: row.voidReason ?? '',
              voidedByName: row.voidedByName ?? '',
              voidedAt: row.voidedAt ? new Date(row.voidedAt) : '',
            }
          : {}),
      })
      .commit();
  }

  sheet.commit();
  await workbook.commit();
}
