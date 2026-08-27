import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PaginatedResponse,
  ReagentDto,
  buildPaginatedResponse,
} from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { runInTransaction } from '../common/prisma/transaction';
import { toReagentDto } from '../common/mappers/reagent.mapper';
import { selectReagentIds } from './reagent-ids.query';
import { CreateReagentDto } from './dto/create-reagent.dto';
import { UpdateReagentDto } from './dto/update-reagent.dto';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';

@Injectable()
export class ReagentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListReagentsQueryDto,
  ): Promise<PaginatedResponse<ReagentDto>> {
    // Step 1 — which reagents qualify, and how many in total. See
    // reagent-ids.query.ts for why this is a call rather than inline code.
    const { ids, total } = await selectReagentIds(this.prisma, query);

    // Step 2 — hydrate exactly those ids with their batches. The ordering is
    // repeated (with the same `id` tie-break) because `where: { id: { in } }`
    // does not preserve the id order.
    const rows = await this.prisma.reagent.findMany({
      where: { id: { in: ids } },
      include: { batches: true },
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
    });

    return buildPaginatedResponse(
      rows.map(toReagentDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  // A deactivated reagent is "deleted" for everyone but an administrator
  // (spec §6.1). `findFirst` with the filter — rather than a fetch and a
  // post-hoc check — keeps the not-found and the not-visible cases on one
  // path, so neither leaks the other's existence through a different status.
  async findOne(id: string, includeInactive: boolean): Promise<ReagentDto> {
    const reagent = await this.prisma.reagent.findFirst({
      where: includeInactive ? { id } : { id, active: true },
      include: { batches: true },
    });
    if (!reagent) {
      throw new NotFoundException('Reagent not found');
    }
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

    return this.findOne(id, true);
  }
}
