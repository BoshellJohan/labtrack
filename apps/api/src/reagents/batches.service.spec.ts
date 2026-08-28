import { BadRequestException } from '@nestjs/common';
import { BatchesService } from './batches.service';

const activeReagent = { id: 'r1', active: true };
const activeLocation = { id: 'loc1', active: true };

// Shape of the single argument `reagentBatch.create` is called with, just
// enough to type `mock.calls` so reading it back does not fall through to
// `any` (the same convention as reagents.service.spec.ts).
interface CreateBatchCallArgs {
  data: {
    initialStock: string;
    currentStock: string;
    madeById: string;
  };
}

function buildService(
  overrides: { reagent?: unknown; location?: unknown } = {},
) {
  const prisma = {
    reagent: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.reagent === undefined ? activeReagent : overrides.reagent,
        ),
    },
    location: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.location === undefined
            ? activeLocation
            : overrides.location,
        ),
    },
    reagentBatch: {
      create: jest.fn<Promise<unknown>, [CreateBatchCallArgs]>(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUniqueOrThrow: jest.fn(),
    },
    // $transaction is used two ways in this service: the array form for
    // listForReagent's [findMany, count] pair, and the interactive-callback
    // form runInTransaction uses for create(). Support both so both call
    // sites exercise the real prisma.$transaction contract, not a
    // convention-specific stub.
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (client: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };
  return { service: new BatchesService(prisma as never), prisma };
}

const validDto = {
  lotNumber: 'L-1',
  entryDate: '2026-01-10',
  expirationDate: '2027-01-10',
  initialStock: '500.0000',
  unit: 'ML' as const,
  locationId: 'loc1',
};

// Shape Prisma actually returns from `reagentBatch.create` under
// `include: WITH_RELATIONS` — realistic enough for `toBatchDto` to read
// every field it accesses without the mapper needing to guard for absence.
function buildCreatedBatch(overrides: { expirationDate?: Date | null } = {}) {
  return {
    id: 'b1',
    reagentId: 'r1',
    lotNumber: 'L-1',
    entryDate: new Date('2026-01-10'),
    expirationDate:
      overrides.expirationDate === undefined
        ? new Date('2027-01-10')
        : overrides.expirationDate,
    initialStock: '500.0000',
    currentStock: '500.0000',
    unit: 'ML',
    locationId: 'loc1',
    active: true,
    createdAt: new Date('2026-01-10'),
    updatedAt: new Date('2026-01-10'),
    reagent: { name: 'Acetona' },
    location: { name: 'Estante A' },
  };
}

describe('BatchesService.create', () => {
  it('sets currentStock from initialStock and never from the request', async () => {
    const { service, prisma } = buildService();
    prisma.reagentBatch.create.mockResolvedValue(buildCreatedBatch());

    await service.create('r1', validDto, 'admin-1');

    const [[createArgs]] = prisma.reagentBatch.create.mock.calls;
    expect(createArgs.data.initialStock).toBe('500.0000');
    expect(createArgs.data.currentStock).toBe('500.0000');
    expect(createArgs.data.madeById).toBe('admin-1');
  });

  it('rejects an expiration date at or before the entry date', async () => {
    const { service } = buildService();
    await expect(
      service.create(
        'r1',
        { ...validDto, expirationDate: '2026-01-10' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a batch on an inactive reagent', async () => {
    const { service } = buildService({ reagent: { id: 'r1', active: false } });
    await expect(
      service.create('r1', validDto as never, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a batch in an inactive location', async () => {
    const { service } = buildService({
      location: { id: 'loc1', active: false },
    });
    await expect(
      service.create('r1', validDto as never, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a batch with no expiration date', async () => {
    const { service, prisma } = buildService();
    prisma.reagentBatch.create.mockResolvedValue(
      buildCreatedBatch({ expirationDate: null }),
    );
    const { expirationDate, ...withoutExpiry } = validDto;
    await expect(
      service.create('r1', withoutExpiry as never, 'admin-1'),
    ).resolves.toBeDefined();
    expect(prisma.reagentBatch.create).toHaveBeenCalled();
  });
});
