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
import { PaginatedResponse, ReagentDto } from '@labtrack/shared';
import { ReagentsService } from './reagents.service';
import { CreateReagentDto } from './dto/create-reagent.dto';
import { UpdateReagentDto } from './dto/update-reagent.dto';
import { ListReagentsQueryDto } from './dto/list-reagents-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertIncludeInactiveAllowed } from '../common/authorization/assert-include-inactive-allowed';

@Controller('reagents')
export class ReagentsController {
  constructor(private readonly reagents: ReagentsService) {}

  // Any authenticated user may list and view: the reagents screen is for
  // everyone, only management is restricted. `includeInactive` is the one
  // parameter that is not open (spec §6.1: ADMIN only).
  @Get()
  list(
    @Query() query: ListReagentsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<ReagentDto>> {
    assertIncludeInactiveAllowed(query.includeInactive, actor.role);
    return this.reagents.list(query);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ReagentDto> {
    return this.reagents.findOne(id, actor.role === 'ADMIN');
  }

  @Post()
  @Roles('ADMIN')
  create(
    @Body() dto: CreateReagentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ReagentDto> {
    return this.reagents.create(dto, actor.id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReagentDto,
  ): Promise<ReagentDto> {
    return this.reagents.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles('ADMIN')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<ReagentDto> {
    return this.reagents.deactivate(id);
  }
}
