import { UNITS, isUnit } from './inventory';

describe('units', () => {
  it('lists every unit the schema allows', () => {
    expect([...UNITS]).toEqual(['G', 'MG', 'KG', 'ML', 'L', 'UNIT']);
  });

  it('recognises a valid unit', () => {
    expect(isUnit('ML')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isUnit('litros')).toBe(false);
    expect(isUnit('')).toBe(false);
  });
});
