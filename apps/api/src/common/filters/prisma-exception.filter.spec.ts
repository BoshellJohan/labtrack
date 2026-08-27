import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function hostWith(json: jest.Mock, status: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
}

describe('PrismaExceptionFilter', () => {
  it('maps a unique constraint violation to 409', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });

    new PrismaExceptionFilter().catch(error, hostWith(json, status));

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNIQUE_CONSTRAINT' }),
    );
  });

  it('maps a missing record to 404', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const error = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: '5.0.0',
    });

    new PrismaExceptionFilter().catch(error, hostWith(json, status));

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  // Under Serializable isolation Postgres does not block a conflicting
  // writer; it aborts one with SQLSTATE 40001, which Prisma surfaces as
  // P2034. Without this case it falls through to the default 500, turning an
  // expected concurrent-write outcome into a reported server crash.
  it('maps a serialization write conflict to 409', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const error = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: '5.0.0',
    });

    new PrismaExceptionFilter().catch(error, hostWith(json, status));

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WRITE_CONFLICT' }),
    );
  });
});
