/**
 * The Node-side twin of the `f_unaccent(lower(...))` expression behind
 * `Reagent.nameNormalized`. The stored column and the search term must be
 * normalized the same way or the comparison silently misses: normalizing only
 * one side finds `Ácido` for `acido` but not `Acetona` for `acetóna`.
 *
 * Verified directly against Postgres: `f_unaccent('Estaño')` returns
 * `'Estano'`, `f_unaccent('Ação')` returns `'Acao'`. The unaccent dictionary
 * folds every combining mark it can decompose, including the combining
 * tilde over `n`/`o`/`a` — it does not treat `ñ`/`ã`/`õ` as letters of their
 * own. This normalizer has no freedom to disagree: it exists only to
 * reproduce that exact expression, not to make a judgment about Spanish
 * orthography. So it strips every Unicode combining mark after NFD, via
 * `\p{Diacritic}`, and skips the NFC recomposition step entirely — there is
 * nothing left to recompose once all marks are gone. The stored `name`
 * column is untouched by any of this; only the search-side comparison folds
 * `ñ` to `n`.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
