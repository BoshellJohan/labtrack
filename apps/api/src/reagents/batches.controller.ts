import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PaginatedResponse, ReagentBatchDto } from '@labtrack/shared';
import { BatchesService } from './batches.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { ListBatchesQueryDto } from './dto/list-batches-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// GET/POST hang off the reagent path as a sub-resource (spec §5.1).
@Controller('reagents')
export class ReagentBatchesController {
  constructor(private readonly batches: BatchesService) {}

  // Any authenticated user may list a reagent's batches: they are the ones
  // who will register consumption against them later.
  @Get(':id/batches')
  listForReagent(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListBatchesQueryDto,
  ): Promise<PaginatedResponse<ReagentBatchDto>> {
    return this.batches.listForReagent(id, query);
  }

  @Post(':id/batches')
  @Roles('ADMIN')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBatchDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ReagentBatchDto> {
    return this.batches.create(id, dto, actor.id);
  }
}

// PATCH routes hang off their own path, per spec §5.1.
@Controller('batches')
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBatchDto,
  ): Promise<ReagentBatchDto> {
    return this.batches.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles('ADMIN')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<ReagentBatchDto> {
    return this.batches.deactivate(id);
  }
}
