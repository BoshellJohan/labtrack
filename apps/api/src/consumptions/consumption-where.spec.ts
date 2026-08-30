import { buildConsumptionWhere } from './consumption-where';
import { ListConsumptionsQueryDto } from './dto/list-consumptions-query.dto';

function query(
  overrides: Partial<ListConsumptionsQueryDto> = {},
): ListConsumptionsQueryDto {
  return Object.assign(new ListConsumptionsQueryDto(), overrides);
}

describe('buildConsumptionWhere', () => {
  it('excludes voided consumptions unless they were asked for', () => {
    expect(buildConsumptionWhere(query(), false).active).toBe(true);
    expect(
      buildConsumptionWhere(query({ includeVoided: true }), true).active,
    ).toBeUndefined();
  });

  it('hides deactivated batches and reagents from a non-admin even with no other filter', () => {
    // The Phase 3 leak: a non-admin could read a deactivated reagent's name off
    // this endpoint after it had 404'd everywhere else.
    expect(buildConsumptionWhere(query(), false).batch).toEqual({
      active: true,
      reagent: { active: true },
    });
  });

  it('keeps that guard when filtering by reagent, rather than replacing it', () => {
    const where = buildConsumptionWhere(query({ reagentId: 'r1' }), false);
    expect(where.batch).toEqual({
      reagentId: 'r1',
      active: true,
      reagent: { active: true },
    });
  });

  it('leaves an admin unrestricted', () => {
    expect(
      buildConsumptionWhere(query({ reagentId: 'r1' }), true).batch,
    ).toEqual({
      reagentId: 'r1',
    });
  });

  it('builds a half-open date range when only one bound is given', () => {
    expect(
      buildConsumptionWhere(query({ from: '2026-08-01T00:00:00.000Z' }), true)
        .consumedAt,
    ).toEqual({ gte: new Date('2026-08-01T00:00:00.000Z') });
  });

  it('matches purpose case-insensitively and partially', () => {
    expect(
      buildConsumptionWhere(query({ purpose: 'titul' }), true).purpose,
    ).toEqual({
      contains: 'titul',
      mode: 'insensitive',
    });
  });
});
