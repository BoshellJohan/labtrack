import { exportFilename } from './export-filename';
import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';

function query(
  overrides: Partial<ListConsumptionsQueryDto> = {},
): ListConsumptionsQueryDto {
  return Object.assign(new ListConsumptionsQueryDto(), overrides);
}

describe('exportFilename', () => {
  it('names the period it covers, because these files pile up in a downloads folder', () => {
    const name = exportFilename(
      'xlsx',
      query({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T00:00:00.000Z',
      }),
      new Date('2026-09-02T10:00:00.000Z'),
    );
    expect(name).toBe('consumos-2026-08-01-a-2026-08-31.xlsx');
  });

  it('falls back to the generation date when no range was given', () => {
    const name = exportFilename(
      'pdf',
      query(),
      new Date('2026-09-02T10:00:00.000Z'),
    );
    expect(name).toBe('consumos-2026-09-02.pdf');
  });

  it('reads the bounds in UTC, so the filename matches the range the user picked', () => {
    // The dates cross the wire as UTC midnight (the client converts with
    // toUtcMidnightIso). Formatting them with local getters would name the file
    // for the previous day in any zone ahead of UTC — the same class of defect
    // that shipped three times across Phases 2 and 3.
    const name = exportFilename(
      'xlsx',
      query({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      }),
      new Date('2026-09-02T10:00:00.000Z'),
    );
    expect(name).toBe('consumos-2026-08-01-a-2026-08-01.xlsx');
  });
});
