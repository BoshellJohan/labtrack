import { Body, Controller, Post } from '@nestjs/common';
import { ConsumptionDto } from '@labtrack/shared';
import { ConsumptionsService } from './consumptions.service';
import { CreateConsumptionDto } from './dto/create-consumption.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

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
}
