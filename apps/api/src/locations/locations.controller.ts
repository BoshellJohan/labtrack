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
import { LocationDto, PaginatedResponse } from '@labtrack/shared';
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertIncludeInactiveAllowed } from '../common/authorization/assert-include-inactive-allowed';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  // Any authenticated user may list: the batch form needs the location
  // picker. `includeInactive` is the one parameter that is not open (spec
  // §6.1: ADMIN only).
  @Get()
  list(
    @Query() query: ListLocationsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResponse<LocationDto>> {
    assertIncludeInactiveAllowed(query.includeInactive, actor.role);
    return this.locations.list(query);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @Body() dto: CreateLocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<LocationDto> {
    return this.locations.create(dto, actor.id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<LocationDto> {
    return this.locations.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles('ADMIN')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<LocationDto> {
    return this.locations.deactivate(id);
  }
}
