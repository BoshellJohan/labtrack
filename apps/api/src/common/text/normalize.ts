/**
 * The Node-side twin of the `f_unaccent(lower(...))` expression behind
 * `Reagent.nameNormalized`. The stored column and the search term must be
 * normalized the same way or the comparison silently misses: normalizing only
 * one side finds `Ácido` for `acido` but not `Acetona` for `acetóna`.
 *
 * `ñ` survives because Postgres unaccent dictionary treats it as its own
 * letter rather than an accented `n`, and Spanish agrees -- `año` and `ano`
 * are different words. The escape list below is deliberate rather than the
 * broader p{Diacritic}: it covers the marks Postgres dictionary folds
 * (grave U+0300, acute U+0301, circumflex U+0302, diaeresis U+0308, ring
 * U+030A, cedilla U+0327) while leaving out the combining tilde U+0303 of
 * `ñ`, which the following NFC reconstitutes.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̧̀́̂̈̊]/g, '')
    .normalize('NFC')
    .toLowerCase();
}
