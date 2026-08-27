import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

function buildService() {
  const prisma: {
    user: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  } = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(
      (
        argument: unknown[] | ((tx: unknown) => Promise<unknown>),
      ): Promise<unknown> =>
        typeof argument === 'function'
          ? argument(prisma)
          : Promise.all(argument as Promise<unknown>[]),
    ),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed') };
  const service = new UsersService(prisma as never, passwords as never);
  return { service, prisma, passwords };
}

const storedUser = {
  id: 'u2',
  username: 'luis',
  fullName: 'Luis Paz',
  role: 'USER' as const,
  mustChangePassword: false,
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  passwordHash: 'hashed',
  madeById: 'admin-1',
};

describe('UsersService', () => {
  it('excludes inactive users unless explicitly requested', async () => {
    const { service, prisma } = buildService();
    await service.list({
      page: 1,
      pageSize: 20,
      sortOrder: 'desc',
      skip: 0,
    } as never);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it('includes inactive users when includeInactive is set', async () => {
    const { service, prisma } = buildService();
    await service.list({
      page: 1,
      pageSize: 20,
      sortOrder: 'desc',
      skip: 0,
      includeInactive: true,
    } as never);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('hashes the password before storing a new user', async () => {
    const { service, prisma, passwords } = buildService();
    prisma.user.create.mockResolvedValue({
      id: 'u2',
      username: 'luis',
      fullName: 'Luis Paz',
      role: 'USER',
      mustChangePassword: true,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash: 'hashed',
      madeById: 'admin-1',
    });

    await service.create(
      {
        username: 'luis',
        fullName: 'Luis Paz',
        password: 'temporary1',
        role: 'USER',
      },
      'admin-1',
    );

    expect(passwords.hash).toHaveBeenCalledWith('temporary1');
    const expectedData = expect.objectContaining({
      passwordHash: 'hashed',
      mustChangePassword: true,
      madeById: 'admin-1',
    }) as Record<string, unknown>;
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expectedData }),
    );
    const createCalls = prisma.user.create.mock.calls as Array<
      [{ data: { password?: string } }]
    >;
    expect(createCalls[0][0].data.password).toBeUndefined();
  });

  it('renames a user without touching any field outside the DTO', async () => {
    const { service, prisma } = buildService();
    prisma.user.update.mockResolvedValue({
      ...storedUser,
      fullName: 'Luis Paz Mejia',
    });

    await service.update('u2', { fullName: 'Luis Paz Mejia' }, 'admin-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { fullName: 'Luis Paz Mejia', role: undefined },
    });
  });

  it('refuses to demote the administrator performing the request', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.update('admin-1', { role: 'USER' }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to demote the last active administrator', async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValue({
      ...storedUser,
      id: 'admin-2',
      role: 'ADMIN',
    });
    prisma.user.count.mockResolvedValue(1);

    await expect(
      service.update('admin-2', { role: 'USER' }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('demotes an administrator while another active one remains', async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValue({
      ...storedUser,
      id: 'admin-2',
      role: 'ADMIN',
    });
    prisma.user.count.mockResolvedValue(2);
    prisma.user.update.mockResolvedValue({
      ...storedUser,
      id: 'admin-2',
      role: 'USER',
    });

    await service.update('admin-2', { role: 'USER' }, 'admin-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-2' },
      data: { fullName: undefined, role: 'USER' },
    });
  });

  it('refuses to deactivate the account performing the request', async () => {
    const { service } = buildService();
    await expect(
      service.deactivate('admin-1', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivates instead of deleting', async () => {
    const { service, prisma } = buildService();
    prisma.user.update.mockResolvedValue({
      id: 'u2',
      username: 'luis',
      fullName: 'Luis Paz',
      role: 'USER',
      mustChangePassword: false,
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash: 'hashed',
      madeById: 'admin-1',
    });

    await service.deactivate('u2', 'admin-1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { active: false },
    });
  });
});
