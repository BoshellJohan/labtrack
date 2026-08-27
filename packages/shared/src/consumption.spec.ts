import { CONSUMPTION_SORT_COLUMNS, isConsumptionSortColumn } from './consumption';

describe('CONSUMPTION_SORT_COLUMNS', () => {
  it('accepts the columns the list endpoint may sort by', () => {
    expect(isConsumptionSortColumn('consumedAt')).toBe(true);
    expect(isConsumptionSortColumn('quantity')).toBe(true);
  });

  it('rejects anything outside the whitelist, which is what keeps orderBy from becoming an injection route', () => {
    expect(isConsumptionSortColumn('id; DROP TABLE "Consumption"')).toBe(false);
    expect(isConsumptionSortColumn('voidReason')).toBe(false);
  });

  it('lists exactly the two sortable columns', () => {
    expect([...CONSUMPTION_SORT_COLUMNS]).toEqual(['consumedAt', 'quantity']);
  });
});
