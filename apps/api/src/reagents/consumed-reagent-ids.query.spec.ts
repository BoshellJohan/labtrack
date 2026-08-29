import { selectConsumedReagentIds } from './consumed-reagent-ids.query';
import { PrismaService } from '../prisma/prisma.service';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

function query(overrides: Partial<ListReagentsQueryDto>): ListReagentsQueryDto {
  return Object.assign(new ListReagentsQueryDto(), overrides);
}

describe('selectConsumedReagentIds', () => {
  it('returns null when no threshold is given, so the caller keeps the simple path', async () => {
    const $queryRaw = jest.fn();
    const prisma = { $queryRaw } as unknown as PrismaService;
    await expect(
      selectConsumedReagentIds(prisma, query({})),
    ).resolves.toBeNull();
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('returns an empty array rather than null when nothing qualifies', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    await expect(
      selectConsumedReagentIds(
        prisma,
        query({ minConsumed: '500', minConsumedUnit: 'ML' }),
      ),
    ).resolves.toEqual([]);
  });

  it('passes every value as a binding, never as interpolated SQL', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ id: 'r1' }]);
    const prisma = { $queryRaw } as unknown as PrismaService;

    await selectConsumedReagentIds(
      prisma,
      query({
        minConsumed: '500',
        minConsumedUnit: 'ML',
        consumedFrom: '2026-08-01T00:00:00.000Z',
      }),
    );

    // The tagged-template form receives the static SQL fragments as the first
    // argument and every value separately. If a value were concatenated into
    // the SQL text it would appear in that first argument instead — which is
    // exactly the injection route this assertion exists to close.
    const [fragments, ...values] = $queryRaw.mock.calls[0] as [
      string[],
      ...unknown[],
    ];
    expect(fragments.join('')).not.toContain('500');
    // The threshold is bound as a Prisma.Decimal (see the implementation), not
    // a plain string, so it is compared by its string form rather than by
    // strict equality — the property under test is that it travels as a
    // separate binding, not what JS type carries it.
    expect(values.map(String)).toContain('500');
  });
});
