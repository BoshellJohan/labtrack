import { Writable } from 'node:stream';
import PDFDocument from 'pdfkit';
import { ConsumptionDto } from '@labtrack/shared';
import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';

export interface ExportHeader {
  labName: string;
  period: string;
  filters: string;
  generatedBy: string;
  generatedAt: Date;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * `DD/MM/AAAA HH:mm`, the format the rest of the document's Spanish reader
 * expects — not the ISO string this timestamp would print as by default.
 */
function formatDateTime(date: Date): string {
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * States what the report includes and, just as importantly, what it leaves
 * out. A reader who was not there when it was generated has only this
 * sentence to tell "12 consumptions" (all of them) apart from "12
 * consumptions" (all of them matching a purpose search). `reagentName` is
 * resolved by the caller — a bare id here would tell the reader nothing.
 */
export function describeFilters(
  query: ListConsumptionsQueryDto,
  reagentName: string | null,
): string {
  const parts: string[] = [];

  if (query.reagentId) {
    parts.push(`Reactivo: ${reagentName ?? query.reagentId}`);
  }
  if (query.purpose) {
    parts.push(`Propósito contiene '${query.purpose}'`);
  }
  if (query.includeVoided) {
    parts.push('Incluye anulados');
  }

  if (parts.length === 0) {
    return 'Sin filtros: todos los consumos.';
  }
  return parts.join(' · ');
}

const COLUMN_WIDTHS = {
  date: 65,
  reagent: 100,
  lot: 55,
  quantity: 70,
  purpose: 130,
  madeBy: 80,
};

function drawTableHeader(doc: PDFKit.PDFDocument, x: number, y: number): void {
  doc.font('Helvetica-Bold').fontSize(9);
  let cursor = x;
  doc.text('Fecha', cursor, y, { width: COLUMN_WIDTHS.date });
  cursor += COLUMN_WIDTHS.date;
  doc.text('Reactivo', cursor, y, { width: COLUMN_WIDTHS.reagent });
  cursor += COLUMN_WIDTHS.reagent;
  doc.text('Lote', cursor, y, { width: COLUMN_WIDTHS.lot });
  cursor += COLUMN_WIDTHS.lot;
  doc.text('Cantidad', cursor, y, { width: COLUMN_WIDTHS.quantity });
  cursor += COLUMN_WIDTHS.quantity;
  doc.text('Propósito', cursor, y, { width: COLUMN_WIDTHS.purpose });
  cursor += COLUMN_WIDTHS.purpose;
  doc.text('Registrado por', cursor, y, { width: COLUMN_WIDTHS.madeBy });
  doc.font('Helvetica').fontSize(9);
}

function drawRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  row: ConsumptionDto,
): void {
  let cursor = x;
  doc.text(row.consumedAt.slice(0, 10), cursor, y, {
    width: COLUMN_WIDTHS.date,
  });
  cursor += COLUMN_WIDTHS.date;
  doc.text(row.reagentName, cursor, y, { width: COLUMN_WIDTHS.reagent });
  cursor += COLUMN_WIDTHS.reagent;
  doc.text(row.lotNumber, cursor, y, { width: COLUMN_WIDTHS.lot });
  cursor += COLUMN_WIDTHS.lot;
  // Formatted from the string the row carries — the unit travels with the
  // number because a bare quantity is ambiguous between millilitres and
  // litres, and nothing on this path calls Number() on it.
  doc.text(`${row.quantity} ${row.unit}`, cursor, y, {
    width: COLUMN_WIDTHS.quantity,
  });
  cursor += COLUMN_WIDTHS.quantity;
  doc.text(row.purpose, cursor, y, { width: COLUMN_WIDTHS.purpose });
  cursor += COLUMN_WIDTHS.purpose;
  doc.text(row.madeByName, cursor, y, { width: COLUMN_WIDTHS.madeBy });
}

const PAGE_MARGIN = 40;
const ROW_HEIGHT = 18;

/**
 * Writes the report straight to `stream`. PDFKit rather than pdfmake:
 * pdfmake needs the whole document in memory before it can be written, which
 * is exactly what the row cap on `selectForExport` exists to avoid.
 */
export function writeConsumptionsPdf(
  rows: ConsumptionDto[],
  header: ExportHeader,
  stream: Writable,
): void {
  const doc = new PDFDocument({
    margin: PAGE_MARGIN,
    size: 'A4',
    bufferPages: true,
  });
  doc.pipe(stream);

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(header.labName, { align: 'left' });
  doc.moveDown(0.3);
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Reporte de consumos', { align: 'left' });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10);
  doc.text(`Periodo: ${header.period}`);
  doc.text(header.filters);
  doc.text(
    `Generado por ${header.generatedBy} el ${formatDateTime(header.generatedAt)}`,
  );
  doc.moveDown(0.8);

  const tableX = doc.page.margins.left;
  const tableWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  let y = doc.y;
  drawTableHeader(doc, tableX, y);
  y += ROW_HEIGHT;
  doc
    .moveTo(tableX, y - 4)
    .lineTo(tableX + tableWidth, y - 4)
    .stroke();

  for (const row of rows) {
    if (y + ROW_HEIGHT > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      drawTableHeader(doc, tableX, y);
      y += ROW_HEIGHT;
    }
    drawRow(doc, tableX, y, row);
    y += ROW_HEIGHT;
  }

  // Page numbers, added last so every page — including ones added by the
  // loop above — carries one: an unnumbered printed report cannot be
  // checked for completeness.
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i += 1) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(
        `Página ${i + 1} de ${pageCount}`,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom + 10,
        { width: tableWidth, align: 'center' },
      );
  }

  doc.end();
}
