import { Prisma, PrismaClient } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The client handed to a transactional callback. It exposes the model methods
 * but not `$transaction`, which is what prevents a nested transaction by
 * accident.
 */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Runs `fn` inside one transaction.
 *
 * Defaults to Serializable because the invariants this project protects are
 * read-then-write: "the last administrator cannot be demoted", "a consumption
 * cannot exceed the stock it reads". Under a weaker level two concurrent
 * requests can both read a state that permits the write and both proceed.
 *
 * A service that needs a transaction takes `TransactionClient` as a parameter
 * rather than reaching for `this.prisma`, so it composes: the same method works
 * standalone and as part of a larger transaction.
 */
export function runInTransaction<T>(
  prisma: PrismaService,
  fn: (client: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: options.isolationLevel ?? 'Serializable',
  });
}
