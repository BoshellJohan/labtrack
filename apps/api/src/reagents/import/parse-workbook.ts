import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, IMPORT_ROW_LIMIT, ImportRow } from '@labtrack/shared';

/**
 * Reads a cell into the string an ImportRow carries. Uses `cell.value`, not
 * `cell.text`: `cell.text` follows the cell's display format, so a numeric
 * cell shown with a comma separator (a Spanish locale, or a custom number
 * format) would arrive as e.g. "2,5" and be rejected even though the value
 * is perfectly valid. `cell.value` is robust to that — a number goes through
 * `String()`, a string is used as-is — and there is no precision loss: the
 * quantity column holds at most 12 significant digits, well inside what a
 * double round-trips exactly.
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
  // Rich cell types (formulas, hyperlinks, errors) are not expected in the
  // import template's data cells; fall back to an empty string rather than
  // stringifying an object.
  return '';
}

/**
 * Parses an import workbook into rows, pure and database-free. Both the
 * preview and the confirm endpoints call this, so they can never disagree
 * about what a well-formed file looks like.
 */
export async function parseWorkbook(buffer: Buffer): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

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
