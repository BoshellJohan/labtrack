import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsumptionDto } from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { runInTransaction } from '../common/prisma/transaction';
import { toConsumptionDto } from '../common/mappers/consumption.mapper';
import { CreateConsumptionDto } from './dto/create-consumption.dto';

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
}
