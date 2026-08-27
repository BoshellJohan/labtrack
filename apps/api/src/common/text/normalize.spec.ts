import { normalizeForSearch } from './normalize';

describe('normalizeForSearch', () => {
  it('lowercases and strips accents so a search term matches a stored name', () => {
    expect(normalizeForSearch('Ácido Clorhídrico')).toBe('acido clorhidrico');
  });

  it('folds ñ to n, matching what Postgres stores, because search folding is not display', () => {
    // f_unaccent('Estaño') is 'Estano' — verified against the database. The
    // normalizer has no freedom here: it is not deciding what Spanish
    // considers a letter, it is reproducing the exact expression behind the
    // generated column. Preserving ñ on this side makes an exact-name search
    // fail to find its own reagent. The stored `name` is untouched, so nothing
    // the user reads changes.
    expect(normalizeForSearch('Estaño')).toBe('estano');
  });

  it('is idempotent, so normalizing an already-normalized term changes nothing', () => {
    expect(normalizeForSearch(normalizeForSearch('Ácido'))).toBe('acido');
  });
});
