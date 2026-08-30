import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';

// Uses the UTC calendar day, never the local one: the client sends both bounds
// as UTC midnight, and reading them back with local getters would name the file
// for the wrong day in any zone ahead of UTC.
function day(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * The download name. It carries the period because these files end up in a
 * downloads folder beside five others, and the name is all that tells them
 * apart.
 */
export function exportFilename(
  extension: 'xlsx' | 'pdf',
  query: ListConsumptionsQueryDto,
  now: Date,
): string {
  if (query.from && query.to) {
    return `consumos-${day(query.from)}-a-${day(query.to)}.${extension}`;
  }
  if (query.from) {
    return `consumos-desde-${day(query.from)}.${extension}`;
  }
  if (query.to) {
    return `consumos-hasta-${day(query.to)}.${extension}`;
  }
  return `consumos-${now.toISOString().slice(0, 10)}.${extension}`;
}
