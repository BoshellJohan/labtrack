import { describeFilters } from './pdf-writer';
import { ListConsumptionsQueryDto } from '../dto/list-consumptions-query.dto';

function query(
  overrides: Partial<ListConsumptionsQueryDto> = {},
): ListConsumptionsQueryDto {
  return Object.assign(new ListConsumptionsQueryDto(), overrides);
}

describe('describeFilters', () => {
  it('says the report covers everything when nothing was filtered', () => {
    expect(describeFilters(query(), null)).toBe(
      'Sin filtros: todos los consumos.',
    );
  });

  it('names the reagent by name rather than by id, which means nothing to a reader', () => {
    expect(describeFilters(query({ reagentId: 'r1' }), 'Acetona')).toContain(
      'Reactivo: Acetona',
    );
  });

  it('quotes a partial purpose so the reader can tell it was a substring match', () => {
    expect(describeFilters(query({ purpose: 'titulación' }), null)).toContain(
      "Propósito contiene 'titulación'",
    );
  });

  it('states when voided consumptions were included, since that changes what the totals mean', () => {
    expect(describeFilters(query({ includeVoided: true }), null)).toContain(
      'Incluye anulados',
    );
  });
});
