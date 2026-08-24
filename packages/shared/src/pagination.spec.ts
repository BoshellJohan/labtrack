import { buildPaginatedResponse } from './pagination';

describe('buildPaginatedResponse', () => {
  it('calculates totalPages rounding up', () => {
    const result = buildPaginatedResponse(['a', 'b'], 21, 1, 20);
    expect(result).toEqual({
      data: ['a', 'b'],
      total: 21,
      page: 1,
      pageSize: 20,
      totalPages: 2,
    });
  });

  it('reports zero pages when there is no data', () => {
    const result = buildPaginatedResponse([], 0, 1, 20);
    expect(result.totalPages).toBe(0);
  });
});
