import { ReagentsService } from './reagents.service';

// Shape of the single argument `reagent.findMany` is called with, just enough
// to type `mock.calls` so reading it back does not fall through to `any`.
interface FindManyArgs {
  where?: unknown;
  select?: unknown;
  orderBy?: unknown;
  skip?: number;
  take?: number;
}

function buildService(ids: { id: string }[] = [], rows: unknown[] = []) {
  const prisma = {
    reagent: {
      findMany: jest
        .fn<Promise<unknown[]>, [FindManyArgs]>()
        .mockResolvedValueOnce(ids) // step 1: which ids qualify
        .mockResolvedValueOnce(rows), // step 2: hydrate them
      count: jest.fn().mockResolvedValue(ids.length),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    ),
  };
  return { service: new ReagentsService(prisma as never), prisma };
}

const baseQuery = {
  page: 1,
  pageSize: 20,
  sortOrder: 'asc',
  sortBy: 'name',
  skip: 0,
};

describe('ReagentsService.list', () => {
  it('resolves ids first and hydrates them second', async () => {
    const { service, prisma } = buildService([{ id: 'r1' }]);
    await service.list(baseQuery as never);

    const [idCall, hydrateCall] = prisma.reagent.findMany.mock.calls;
    // Step 1 asks only for ids — it is the seam the composite filter replaces.
    expect(idCall[0]).toMatchObject({ select: { id: true } });
    // Step 2 fetches the rows for exactly those ids.
    expect(hydrateCall[0]).toMatchObject({ where: { id: { in: ['r1'] } } });
  });

  it('filters by name against the accent- and case-normalized column', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, name: 'Acetóna' } as never);
    expect(prisma.reagent.findMany.mock.calls[0][0].where).toMatchObject({
      active: true,
      nameNormalized: { contains: 'acetona' },
    });
  });

  it('filters by CAS number exactly', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, casNumber: '67-64-1' } as never);
    expect(prisma.reagent.findMany.mock.calls[0][0].where).toMatchObject({
      casNumber: '67-64-1',
    });
  });

  it('filters by the location of its batches', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, locationId: 'loc-1' } as never);
    expect(prisma.reagent.findMany.mock.calls[0][0].where).toMatchObject({
      batches: { some: { active: true, locationId: 'loc-1' } },
    });
  });

  it('counts with the same where the ids came from', async () => {
    const { service, prisma } = buildService([{ id: 'r1' }]);
    await service.list({ ...baseQuery, name: 'aceto' } as never);
    expect(prisma.reagent.count).toHaveBeenCalledWith({
      where: prisma.reagent.findMany.mock.calls[0][0].where,
    });
  });
});

describe('ReagentsService.deactivate', () => {
  it('deactivates the reagent and its batches in one transaction', async () => {
    const tx = {
      reagent: { update: jest.fn().mockResolvedValue({ id: 'r1' }) },
      reagentBatch: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    // runInTransaction delegates to prisma.$transaction, so mocking it here
    // exercises the real path the convention takes.
    const prisma = {
      $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
      reagent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'r1',
          name: 'Acetona',
          casNumber: '67-64-1',
          reference: null,
          description: null,
          dataSheetUrl: null,
          active: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          batches: [],
        }),
      },
    };
    const service = new ReagentsService(prisma as never);

    await service.deactivate('r1');

    expect(tx.reagent.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { active: false },
    });
    expect(tx.reagentBatch.updateMany).toHaveBeenCalledWith({
      where: { reagentId: 'r1', active: true },
      data: { active: false },
    });
  });
});
