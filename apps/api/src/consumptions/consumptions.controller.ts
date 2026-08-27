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
import { ConsumptionDto, PaginatedResponse } from '@labtrack/shared';
import { ConsumptionsService } from './consumptions.service';
import { CreateConsumptionDto } from './dto/create-consumption.dto';
import { ListConsumptionsQueryDto } from './dto/list-consumptions-query.dto';
import { VoidConsumptionDto } from './dto/void-consumption.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertIncludeInactiveAllowed } from '../common/authorization/assert-include-inactive-allowed';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('consumptions')
export class ConsumptionsController {
  constructor(private readonly consumptions: ConsumptionsService) {}

  // Any authenticated user records consumption: that is the daily work of the
  // lab. Only voiding is restricted.
  @Post()
  create(
    @Body() dto: CreateConsumptionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConsumptionDto> {
    return this.consumptions.create(dto, actor.id);
  }

  @Get()
  list(
    @Query() query: ListConsumptionsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<ConsumptionDto>> {
    // Same rule and same reason as `includeInactive` on the other list
    // endpoints (spec §6.3): a voided consumption is "deleted" for everyone
    // but an administrator, so the flag is gated server-side rather than by
    // hiding a checkbox.
    assertIncludeInactiveAllowed(query.includeVoided, actor.role);
    return this.consumptions.list(query);
  }

  @Patch(':id/void')
  @Roles('ADMIN')
  voidConsumption(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidConsumptionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConsumptionDto> {
    return this.consumptions.void(id, dto, actor.id);
  }
}
