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

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  // Any authenticated user may list: the batch form needs the location picker.
  @Get()
  list(
    @Query() query: ListLocationsQueryDto,
  ): Promise<PaginatedResponse<LocationDto>> {
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
