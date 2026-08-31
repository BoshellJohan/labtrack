import * as ExcelJS from 'exceljs';
import { parseWorkbook } from './parse-workbook';
import { IMPORT_COLUMNS } from '@labtrack/shared';

async function workbookWith(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Reactivos');
  sheet.addRow([...IMPORT_COLUMNS]);
  rows.forEach((row) => sheet.addRow(row));
  return (await workbook.xlsx.writeBuffer()) as Buffer;
}

describe('parseWorkbook', () => {
  it('reads a text-formatted quantity exactly as written', async () => {
    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-1',
        '2026-08-01',
        '',
        '2.5000',
        'ML',
        'Estante A1',
      ],
    ]);
    expect((await parseWorkbook(buffer))[0].quantity).toBe('2.5000');
  });

  it('reads a numeric quantity the same from cell value or cell text', async () => {
    // For a plain numeric cell, ExcelJS's `value` and `text` produce the
    // same string regardless of number format — this does not exercise a
    // locale or display-format guarantee, it just documents that a numeric
    // cell's quantity survives the round trip.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Reactivos');
    sheet.addRow([...IMPORT_COLUMNS]);
    sheet.addRow([
      'Acetona',
      '67-64-1',
      '',
      'L-1',
      '2026-08-01',
      '',
      2.5,
      'ML',
      'Estante A1',
    ]);
    sheet.getCell('G2').numFmt = '0.0000';
    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;

    // '2.5' and not '2.5000': the trailing zeros are display scale, and
    // Decimal(12,4) stores 2.5 and 2.5000 as the same number anyway.
    expect((await parseWorkbook(buffer))[0].quantity).toBe('2.5');
  });

  it('reads a formula cell by its computed result, not as an unreadable object', async () => {
    // A technician computing a quantity with `=250*4` or a unit conversion
    // is ordinary. A formula cell's `value` is `{ formula, result }`, which
    // must be unwrapped to its numeric result rather than falling through to
    // an empty string and misreporting the row as missing a quantity.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Reactivos');
    sheet.addRow([...IMPORT_COLUMNS]);
    sheet.addRow([
      'Acetona',
      '67-64-1',
      '',
      'L-1',
      '2026-08-01',
      '',
      '1',
      'ML',
      'Estante A1',
    ]);
    sheet.getCell('G2').value = {
      formula: '1+1.5',
      result: 2.5,
    };
    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;

    expect((await parseWorkbook(buffer))[0].quantity).toBe('2.5');
  });

  it('reads a formula cell whose result is text, intact', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Reactivos');
    sheet.addRow([...IMPORT_COLUMNS]);
    sheet.addRow([
      'Acetona',
      '67-64-1',
      '',
      'L-1',
      '2026-08-01',
      '',
      '1',
      'ML',
      'Estante A1',
    ]);
    sheet.getCell('A2').value = {
      formula: '"Ace"&"tona"',
      result: 'Acetona',
    };
    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;

    expect((await parseWorkbook(buffer))[0].reagentName).toBe('Acetona');
  });

  it('numbers rows as the spreadsheet does, so an error names a row the user can find', async () => {
    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-1',
        '2026-08-01',
        '',
        '1',
        'ML',
        'Estante A1',
      ],
    ]);
    // Row 1 is the header, so the first data row is 2 — what Excel shows.
    expect((await parseWorkbook(buffer))[0].rowNumber).toBe(2);
  });

  it('refuses a file whose headers are not the template', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Reactivos').addRow(['Nombre', 'CAS']);
    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;
    await expect(parseWorkbook(buffer)).rejects.toThrow(/plantilla|template/i);
  });

  it('refuses a file over the row limit instead of truncating it', async () => {
    const many = Array.from({ length: 1001 }, () => [
      'Acetona',
      '67-64-1',
      '',
      'L-1',
      '2026-08-01',
      '',
      '1',
      'ML',
      'Estante A1',
    ]);
    await expect(parseWorkbook(await workbookWith(many))).rejects.toThrow(
      /1000/,
    );
  });
});
