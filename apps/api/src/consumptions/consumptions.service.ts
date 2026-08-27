import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildPaginatedResponse,
  ConsumptionDto,
  PaginatedResponse,
} from '@labtrack/shared';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runInTransaction } from '../common/prisma/transaction';
import { toConsumptionDto } from '../common/mappers/consumption.mapper';
import { CreateConsumptionDto } from './dto/create-consumption.dto';
import { ListConsumptionsQueryDto } from './dto/list-consumptions-query.dto';
import { VoidConsumptionDto } from './dto/void-consumption.dto';

// Shared by create, list and void so all three produce the exact shape the
// mapper's type demands.
export const WITH_RELATIONS = {
  batch: {
    select: {
      lotNumber: true,
      unit: true,
      reagentId: true,
      reagent: { select: { name: true } },
    },
  },
  madeBy: { select: { fullName: true } },
  voidedBy: { select: { fullName: true } },
} as const;

@Injectable()
export class ConsumptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateConsumptionDto,
    actorId: string,
  ): Promise<ConsumptionDto> {
    // Read-then-write: the stock check and the decrement must see the same
    // state, or two concurrent requests can each read a stock that permits
    // their own write and together overdraw the batch. runInTransaction
    // defaults to Serializable for exactly this shape.
    return runInTransaction(this.prisma, async (tx) => {
      const batch = await tx.reagentBatch.findUnique({
        where: { id: dto.batchId },
      });
      if (!batch || !batch.active) {
        throw new BadRequestException('Cannot consume from an inactive batch');
      }

      // Decimal comparison, not a JS number comparison: parsing either side
      // into a float would let a quantity a hair over the stock slip through
      // at the boundary.
      if (batch.currentStock.lessThan(dto.quantity)) {
        throw new BadRequestException(
          'quantity exceeds the current stock of this batch',
        );
      }

      const consumption = await tx.consumption.create({
        data: {
          batchId: dto.batchId,
          quantity: dto.quantity,
          consumedAt: new Date(dto.consumedAt),
          purpose: dto.purpose,
          madeById: actorId,
        },
        include: WITH_RELATIONS,
      });

      // `decrement` so the arithmetic happens in Postgres on the numeric
      // column. Computing the new value in Node would route a Decimal through
      // a JS number and lose the precision the column exists for.
      await tx.reagentBatch.update({
        where: { id: dto.batchId },
        data: { currentStock: { decrement: dto.quantity } },
      });

      return toConsumptionDto(consumption);
    });
  }

  async list(
    query: ListConsumptionsQueryDto,
  ): Promise<PaginatedResponse<ConsumptionDto>> {
    const where: Prisma.ConsumptionWhereInput = {};

    if (!query.includeVoided) {
      where.active = true;
    }
    if (query.batchId) {
      where.batchId = query.batchId;
    }
    if (query.reagentId) {
      // A consumption belongs to a batch, and a batch to a reagent: filtering
      // by reagent means "any of that reagent's batches".
      where.batch = { reagentId: query.reagentId };
    }
    if (query.madeById) {
      where.madeById = query.madeById;
    }
    if (query.purpose) {
      where.purpose = { contains: query.purpose, mode: 'insensitive' };
    }
    if (query.from || query.to) {
      where.consumedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    // Count and rows in one transaction with the same `where`, so the
    // paginator can never show a total that disagrees with the page. The `id`
    // tie-break makes the order deterministic when two rows share a
    // `consumedAt`, which is common when several are logged in one sitting.
    const [data, total] = await this.prisma.$transaction([
      this.prisma.consumption.findMany({
        where,
        include: WITH_RELATIONS,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.consumption.count({ where }),
    ]);

    return buildPaginatedResponse(
      data.map(toConsumptionDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async void(
    id: string,
    dto: VoidConsumptionDto,
    actorId: string,
  ): Promise<ConsumptionDto> {
    return runInTransaction(this.prisma, async (tx) => {
      const current = await tx.consumption.findUnique({ where: { id } });
      if (!current) {
        throw new NotFoundException('Consumption not found');
      }
      // Read-then-write again, and the reason this needs the transaction as
      // much as `create` does: two concurrent voids of the same consumption
      // could each read it as active and each return the quantity, inflating
      // the batch by twice what was consumed.
      if (!current.active) {
        throw new BadRequestException('This consumption is already voided');
      }

      const consumption = await tx.consumption.update({
        where: { id },
        data: {
          active: false,
          voidReason: dto.voidReason,
          voidedById: actorId,
          voidedAt: new Date(),
        },
        include: WITH_RELATIONS,
      });

      // The exact reverse of `create`'s decrement, and in Postgres for the
      // same reason.
      await tx.reagentBatch.update({
        where: { id: current.batchId },
        data: { currentStock: { increment: current.quantity } },
      });

      return toConsumptionDto(consumption);
    });
  }
}
