import { isValidCasNumber, normalizeCasNumber } from './cas-number';

describe('isValidCasNumber', () => {
  // Verified against the real registry before this plan was written: each of
  // these is the CAS of a reagent this project already uses as a fixture.
  it.each([
    ['7647-01-0', 'ácido clorhídrico'],
    ['67-64-1', 'acetona'],
    ['64-17-5', 'etanol'],
    ['7440-31-5', 'estaño'],
  ])('accepts %s (%s)', (cas) => {
    expect(isValidCasNumber(cas)).toBe(true);
  });

  it('rejects a well-shaped number whose check digit is wrong', () => {
    // This is the case the current DTO lets through: the shape matches and
    // the digit does not.
    expect(isValidCasNumber('12345-67-9')).toBe(false);
  });

  it('rejects anything that is not shaped like a CAS at all', () => {
    expect(isValidCasNumber('67641')).toBe(false);
    expect(isValidCasNumber('67-64')).toBe(false);
    expect(isValidCasNumber('abc-de-f')).toBe(false);
    expect(isValidCasNumber('')).toBe(false);
  });
});

describe('normalizeCasNumber', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeCasNumber('  67-64-1  ')).toBe('67-64-1');
  });

  it.each([
    ['67‑64‑1', 'non-breaking hyphen, from a web page'],
    ['67–64–1', 'en dash, from a PDF or a word processor'],
    ['67—64—1', 'em dash'],
    ['67−64−1', 'minus sign'],
  ])('maps %s to an ASCII hyphen (%s)', (value) => {
    // These render identically to a plain hyphen, so a user pasting a CAS
    // number from a catalogue sees a correct value rejected and has no way
    // to tell why. There is exactly one valid separator in a CAS number, so
    // mapping the lookalikes is deterministic rather than a guess — unlike a
    // decimal separator, where a comma could mean two different numbers.
    expect(normalizeCasNumber(value)).toBe('67-64-1');
  });

  it('leaves an already-clean value untouched', () => {
    expect(normalizeCasNumber('7647-01-0')).toBe('7647-01-0');
  });
});

describe('isValidCasNumber after normalisation', () => {
  it('accepts a pasted value whose separators are en dashes', () => {
    expect(isValidCasNumber('67–64–1')).toBe(true);
  });

  it('accepts a value with stray whitespace', () => {
    expect(isValidCasNumber(' 67-64-1 ')).toBe(true);
  });

  it('still rejects a wrong check digit once normalised', () => {
    // Normalising must not turn a genuinely invalid number into a valid one.
    expect(isValidCasNumber(' 12345–67–9 ')).toBe(false);
  });
});
