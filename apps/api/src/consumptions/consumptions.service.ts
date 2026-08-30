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
import { PrismaService } from '../prisma/prisma.service';
import { runInTransaction } from '../common/prisma/transaction';
import { toConsumptionDto } from '../common/mappers/consumption.mapper';
import { buildConsumptionWhere } from './consumption-where';
import { CreateConsumptionDto } from './dto/create-consumption.dto';
import { ListConsumptionsQueryDto } from './dto/list-consumptions-query.dto';
import { VoidConsumptionDto } from './dto/void-consumption.dto';

/**
 * The most rows one export may contain. Chosen, not derived: comfortably above
 * what a university laboratory exports in one period, and well below what
 * threatens a small container. If real use proves it low, raise it — what does
 * not happen is removing it and hoping.
 */
export const EXPORT_ROW_LIMIT = 10_000;

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
    isAdmin: boolean,
  ): Promise<PaginatedResponse<ConsumptionDto>> {
    const where = buildConsumptionWhere(query, isAdmin);

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

  /**
   * Every row matching the filter, unpaginated, for the export endpoints.
   *
   * Counts before reading. Once the response has begun streaming the status
   * code is already sent, so a failure past that point reaches the user as a
   * truncated file that opens cleanly — the worst shape this feature could
   * fail in.
   *
   * `limit` exists so tests can exercise the cap without seeding ten thousand
   * rows. It is not a caller-facing knob; both endpoints use the default.
   */
  async selectForExport(
    query: ListConsumptionsQueryDto,
    isAdmin: boolean,
    limit: number = EXPORT_ROW_LIMIT,
  ): Promise<ConsumptionDto[]> {
    const where = buildConsumptionWhere(query, isAdmin);
    const total = await this.prisma.consumption.count({ where });

    if (total > limit) {
      throw new BadRequestException(
        `The filter matches ${total} rows, over the ${limit} an export may contain. Narrow the date range.`,
      );
    }

    const rows = await this.prisma.consumption.findMany({
      where,
      include: WITH_RELATIONS,
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
    });

    return rows.map(toConsumptionDto);
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
