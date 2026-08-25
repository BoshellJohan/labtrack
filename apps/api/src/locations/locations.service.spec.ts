import { LocationsService } from './locations.service';

function buildService() {
  const prisma = {
    location: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    ),
  };
  return { service: new LocationsService(prisma as never), prisma };
}

const baseQuery = {
  page: 1,
  pageSize: 20,
  sortOrder: 'asc',
  sortBy: 'name',
  skip: 0,
};

describe('LocationsService', () => {
  it('excludes inactive locations unless asked', async () => {
    const { service, prisma } = buildService();
    await service.list(baseQuery as never);
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('includes them when includeInactive is set', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, includeInactive: true } as never);
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('filters by name, case-insensitively', async () => {
    const { service, prisma } = buildService();
    await service.list({ ...baseQuery, search: 'estante' } as never);
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          name: { contains: 'estante', mode: 'insensitive' },
        },
      }),
    );
  });

  it('records the actor when creating', async () => {
    const { service, prisma } = buildService();
    prisma.location.create.mockResolvedValue({
      id: 'l1',
      name: 'Estante A',
      description: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      madeById: 'admin-1',
    });

    await service.create({ name: 'Estante A' }, 'admin-1');

    expect(prisma.location.create).toHaveBeenCalledWith({
      data: { name: 'Estante A', description: undefined, madeById: 'admin-1' },
    });
  });

  it('deactivates instead of deleting', async () => {
    const { service, prisma } = buildService();
    prisma.location.update.mockResolvedValue({
      id: 'l1',
      name: 'Estante A',
      description: null,
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      madeById: 'admin-1',
    });

    await service.deactivate('l1');

    expect(prisma.location.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { active: false },
    });
  });
});
