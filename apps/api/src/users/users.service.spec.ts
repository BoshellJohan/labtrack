import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

function buildService() {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations as Promise<unknown>[])),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed') };
  const service = new UsersService(prisma as never, passwords as never);
  return { service, prisma, passwords };
}

describe('UsersService', () => {
  it('excludes inactive users unless explicitly requested', async () => {
    const { service, prisma } = buildService();
    await service.list({ page: 1, pageSize: 20, sortOrder: 'desc', skip: 0 } as never);
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
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
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
      { username: 'luis', fullName: 'Luis Paz', password: 'temporary1', role: 'USER' },
      'admin-1',
    );

    expect(passwords.hash).toHaveBeenCalledWith('temporary1');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passwordHash: 'hashed',
          mustChangePassword: true,
          madeById: 'admin-1',
        }),
      }),
    );
    expect(prisma.user.create.mock.calls[0][0].data.password).toBeUndefined();
  });

  it('refuses to deactivate the account performing the request', async () => {
    const { service } = buildService();
    await expect(service.deactivate('admin-1', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
