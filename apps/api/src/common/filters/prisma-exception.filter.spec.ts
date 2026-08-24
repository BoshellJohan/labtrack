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
});
