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

@Controller('reagents')
export class ReagentsController {
  constructor(private readonly reagents: ReagentsService) {}

  // Any authenticated user may list and view: the reagents screen is for
  // everyone, only management is restricted.
  @Get()
  list(
    @Query() query: ListReagentsQueryDto,
  ): Promise<PaginatedResponse<ReagentDto>> {
    return this.reagents.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReagentDto> {
    return this.reagents.findOne(id);
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
