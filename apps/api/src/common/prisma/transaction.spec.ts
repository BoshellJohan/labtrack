import { runInTransaction } from './transaction';

describe('runInTransaction', () => {
  it('passes the transactional client to the callback', async () => {
    const tx = { marker: 'tx-client' };
    const prisma = {
      $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    };

    const received = await runInTransaction(prisma as never, (client) =>
      Promise.resolve(client),
    );

    expect(received).toBe(tx);
  });

  it('uses Serializable isolation by default', async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) =>
        fn({}),
      ),
    };

    await runInTransaction(prisma as never, () => Promise.resolve(undefined));

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('allows overriding the isolation level', async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: (c: unknown) => Promise<unknown>) =>
        fn({}),
      ),
    };

    await runInTransaction(prisma as never, () => Promise.resolve(undefined), {
      isolationLevel: 'ReadCommitted',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
  });
});
