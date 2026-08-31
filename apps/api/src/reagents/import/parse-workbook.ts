import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, IMPORT_ROW_LIMIT, ImportRow } from '@labtrack/shared';

/**
 * Reads a cell into the string an ImportRow carries, from `cell.value`
 * rather than `cell.text`. For a plain numeric or string cell the two are
 * equivalent in this library — the choice does not protect against a
 * locale-formatted display string. It matters for a formula cell: `value`
 * there is `{ formula, result }`, while `text` already reports the computed
 * result as a string. A laboratory technician writing `=250*4` or a unit
 * conversion is ordinary, so a formula's `result` is unwrapped through the
 * same conversion as a plain cell — a numeric result becomes its string, a
 * text result is used as-is — rather than being treated as unreadable.
 */
function cellString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && 'result' in value) {
    return cellString(value.result);
  }
  // Other rich cell types (hyperlinks, rich text, errors) fall back to an
  // empty string rather than stringifying an object.
  return '';
}

/**
 * Parses an import workbook into rows, pure and database-free. Both the
 * preview and the confirm endpoints call this, so they can never disagree
 * about what a well-formed file looks like.
 */
export async function parseWorkbook(buffer: Buffer): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    // ExcelJS throws a bare Error on a corrupt or non-Excel buffer — one
    // that would otherwise escape every exception filter as an uncaught
    // 500. The controller's fileFilter is the first line of defence, on
    // the declared MIME type; this is the second, for a file whose bytes
    // do not match whatever type it claimed to be.
    throw new BadRequestException(
      'El archivo no se pudo leer. Verifica que sea un archivo de Excel (.xlsx) válido.',
    );
  }

  const sheet = workbook.worksheets[0];
  const headerRow = sheet?.getRow(1);
  const headers = headerRow
    ? (headerRow.values as ExcelJS.CellValue[])
        .slice(1)
        .map((value) => cellString(value))
    : [];

  const matchesTemplate =
    headers.length === IMPORT_COLUMNS.length &&
    IMPORT_COLUMNS.every((column, index) => headers[index] === column);

  if (!matchesTemplate) {
    throw new BadRequestException(
      'El archivo no coincide con la plantilla (template) de importación.',
    );
  }

  const totalDataRows = sheet.rowCount - 1;
  if (totalDataRows > IMPORT_ROW_LIMIT) {
    throw new BadRequestException(
      `El archivo supera el límite de ${IMPORT_ROW_LIMIT} filas.`,
    );
  }

  const rows: ImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const sheetRow = sheet.getRow(rowNumber);
    if (sheetRow.actualCellCount === 0) {
      continue;
    }

    rows.push({
      rowNumber,
      reagentName: cellString(sheetRow.getCell(1).value),
      casNumber: cellString(sheetRow.getCell(2).value),
      reference: cellString(sheetRow.getCell(3).value),
      lotNumber: cellString(sheetRow.getCell(4).value),
      entryDate: cellString(sheetRow.getCell(5).value),
      expirationDate: cellString(sheetRow.getCell(6).value),
      quantity: cellString(sheetRow.getCell(7).value),
      unit: cellString(sheetRow.getCell(8).value),
      locationName: cellString(sheetRow.getCell(9).value),
    });
  }

  return rows;
}
