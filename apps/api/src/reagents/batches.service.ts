import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PaginatedResponse,
  ReagentBatchDto,
  buildPaginatedResponse,
} from '@labtrack/shared';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runInTransaction } from '../common/prisma/transaction';
import { toBatchDto } from '../common/mappers/batch.mapper';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { ListBatchesQueryDto } from './dto/list-batches-query.dto';

const WITH_RELATIONS = {
  reagent: { select: { name: true } },
  location: { select: { name: true } },
} as const;

@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForReagent(
    reagentId: string,
    query: ListBatchesQueryDto,
    includeInactive: boolean,
  ): Promise<PaginatedResponse<ReagentBatchDto>> {
    const where: Prisma.ReagentBatchWhereInput = { reagentId };
    if (!includeInactive) {
      // Defensive, not incidental: today `deactivate()` on a reagent always
      // cascades to its batches in the same transaction, so this condition
      // never changes the result. But this endpoint's safety should not rely
      // on that cascade holding forever — a non-admin must never see batches
      // of a reagent that is itself inactive, even if a future code path
      // ever deactivates a reagent without its batches.
      where.active = true;
      where.reagent = { active: true };
    }

    // The count and the rows are read in the same transaction, and the id
    // tie-break makes the ordering deterministic: two batches that tie on
    // sortBy would otherwise not be guaranteed the same order across runs.
    const [data, total] = await this.prisma.$transaction([
      this.prisma.reagentBatch.findMany({
        where,
        include: WITH_RELATIONS,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.reagentBatch.count({ where }),
    ]);

    return buildPaginatedResponse(
      data.map(toBatchDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async create(
    reagentId: string,
    dto: CreateBatchDto,
    actorId: string,
  ): Promise<ReagentBatchDto> {
    const entryDate = new Date(dto.entryDate);
    if (dto.expirationDate && new Date(dto.expirationDate) <= entryDate) {
      throw new BadRequestException(
        'expirationDate must be later than entryDate',
      );
    }

    // Read-then-write: the reagent and location active checks must see the
    // same state the insert commits under, or a concurrent
    // PATCH /reagents/:id/deactivate can land between the read and the write
    // and produce an active batch under a now-inactive reagent — the exact
    // state listForReagent's defensive `reagent: { active: true }` filter
    // assumes cannot happen. runInTransaction defaults to Serializable for
    // exactly this shape (see ConsumptionsService.create).
    return runInTransaction(this.prisma, async (tx) => {
      const reagent = await tx.reagent.findUnique({
        where: { id: reagentId },
      });
      if (!reagent || !reagent.active) {
        throw new BadRequestException(
          'Cannot add a batch to an inactive reagent',
        );
      }

      const location = await tx.location.findUnique({
        where: { id: dto.locationId },
      });
      if (!location || !location.active) {
        throw new BadRequestException(
          'Cannot store a batch in an inactive location',
        );
      }

      const batch = await tx.reagentBatch.create({
        data: {
          reagentId,
          locationId: dto.locationId,
          lotNumber: dto.lotNumber,
          entryDate,
          expirationDate: dto.expirationDate
            ? new Date(dto.expirationDate)
            : null,
          // currentStock is derived here and never read from the request:
          // stock moves only through consumptions, and letting a client set
          // it would open a way to change the inventory with no trace of who
          // or why.
          initialStock: dto.initialStock,
          currentStock: dto.initialStock,
          unit: dto.unit,
          madeById: actorId,
        },
        include: WITH_RELATIONS,
      });

      return toBatchDto(batch);
    });
  }

  async update(id: string, dto: UpdateBatchDto): Promise<ReagentBatchDto> {
    const current = await this.prisma.reagentBatch.findUniqueOrThrow({
      where: { id },
    });

    if (
      dto.expirationDate &&
      new Date(dto.expirationDate) <= current.entryDate
    ) {
      throw new BadRequestException(
        'expirationDate must be later than entryDate',
      );
    }

    if (dto.locationId) {
      const location = await this.prisma.location.findUnique({
        where: { id: dto.locationId },
      });
      if (!location || !location.active) {
        throw new BadRequestException(
          'Cannot move a batch to an inactive location',
        );
      }
    }

    const batch = await this.prisma.reagentBatch.update({
      where: { id },
      data: {
        expirationDate: dto.expirationDate
          ? new Date(dto.expirationDate)
          : undefined,
        locationId: dto.locationId,
      },
      include: WITH_RELATIONS,
    });

    return toBatchDto(batch);
  }

  async deactivate(id: string): Promise<ReagentBatchDto> {
    const batch = await this.prisma.reagentBatch.update({
      where: { id },
      data: { active: false },
      include: WITH_RELATIONS,
    });
    return toBatchDto(batch);
  }
}
