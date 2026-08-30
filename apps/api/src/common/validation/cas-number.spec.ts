import { isValidCasNumber } from './cas-number';

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
