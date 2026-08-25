import { Injectable } from '@nestjs/common';
import {
  PaginatedResponse,
  ReagentDto,
  buildPaginatedResponse,
} from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { runInTransaction } from '../common/prisma/transaction';
import { toReagentDto } from '../common/mappers/reagent.mapper';
import { buildReagentWhere } from './reagent-ids.query';
import { CreateReagentDto } from './dto/create-reagent.dto';
import { UpdateReagentDto } from './dto/update-reagent.dto';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

@Injectable()
export class ReagentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListReagentsQueryDto,
  ): Promise<PaginatedResponse<ReagentDto>> {
    const where = buildReagentWhere(query);

    // Step 1 — which reagents qualify, and how many in total. The count uses the
    // same `where` as the page, so the paginator can never disagree with the rows.
    const [ids, total] = await this.prisma.$transaction([
      this.prisma.reagent.findMany({
        where,
        select: { id: true },
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.reagent.count({ where }),
    ]);

    // Step 2 — hydrate exactly those ids with their batches. The ordering is
    // repeated because `where: { id: { in } }` does not preserve the id order.
    const rows = await this.prisma.reagent.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      include: { batches: true },
      orderBy: { [query.sortBy]: query.sortOrder },
    });

    return buildPaginatedResponse(
      rows.map(toReagentDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findOne(id: string): Promise<ReagentDto> {
    const reagent = await this.prisma.reagent.findUniqueOrThrow({
      where: { id },
      include: { batches: true },
    });
    return toReagentDto(reagent);
  }

  async create(dto: CreateReagentDto, actorId: string): Promise<ReagentDto> {
    const reagent = await this.prisma.reagent.create({
      data: {
        name: dto.name,
        casNumber: dto.casNumber,
        reference: dto.reference,
        description: dto.description,
        dataSheetUrl: dto.dataSheetUrl,
        madeById: actorId,
      },
      include: { batches: true },
    });
    return toReagentDto(reagent);
  }

  async update(id: string, dto: UpdateReagentDto): Promise<ReagentDto> {
    const reagent = await this.prisma.reagent.update({
      where: { id },
      data: {
        name: dto.name,
        casNumber: dto.casNumber,
        reference: dto.reference,
        description: dto.description,
        dataSheetUrl: dto.dataSheetUrl,
      },
      include: { batches: true },
    });
    return toReagentDto(reagent);
  }

  // Deactivating a reagent deactivates its batches too (spec §3.1), in one
  // transaction so the two can never disagree. Uses the convention from Task 4;
  // ReadCommitted is enough here because nothing is read before the writes.
  async deactivate(id: string): Promise<ReagentDto> {
    await runInTransaction(
      this.prisma,
      async (tx) => {
        await tx.reagent.update({ where: { id }, data: { active: false } });
        await tx.reagentBatch.updateMany({
          where: { reagentId: id, active: true },
          data: { active: false },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );

    return this.findOne(id);
  }
}
