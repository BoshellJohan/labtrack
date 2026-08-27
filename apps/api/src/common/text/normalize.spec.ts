import { normalizeForSearch } from './normalize';

describe('normalizeForSearch', () => {
  it('lowercases and strips accents so a search term matches a stored name', () => {
    expect(normalizeForSearch('Ácido Clorhídrico')).toBe('acido clorhidrico');
  });

  it('leaves ñ alone, which is a letter in Spanish and not an accented n', () => {
    expect(normalizeForSearch('Estaño')).toBe('estaño');
  });

  it('is idempotent, so normalizing an already-normalized term changes nothing', () => {
    expect(normalizeForSearch(normalizeForSearch('Ácido'))).toBe('acido');
  });
});
