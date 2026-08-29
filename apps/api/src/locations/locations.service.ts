import { Injectable } from '@nestjs/common';
import {
  LocationDto,
  PaginatedResponse,
  buildPaginatedResponse,
} from '@labtrack/shared';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toLocationDto } from '../common/mappers/location.mapper';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListLocationsQueryDto,
  ): Promise<PaginatedResponse<LocationDto>> {
    const where: Prisma.LocationWhereInput = {};
    if (!query.includeInactive) {
      where.active = true;
    }
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    // The count and the page come from the same transaction, so the total
    // always corresponds to the rows being shown.
    const [data, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.location.count({ where }),
    ]);

    return buildPaginatedResponse(
      data.map(toLocationDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async create(dto: CreateLocationDto, actorId: string): Promise<LocationDto> {
    const location = await this.prisma.location.create({
      data: { name: dto.name, description: dto.description, madeById: actorId },
    });
    return toLocationDto(location);
  }

  async update(id: string, dto: UpdateLocationDto): Promise<LocationDto> {
    const location = await this.prisma.location.update({
      where: { id },
      // `?? undefined` would defeat the whole point: it turns an explicit
      // null back into "leave unchanged". The field is passed through
      // as-is, and Prisma treats null as SET NULL and undefined as
      // omitted.
      data: { name: dto.name, description: dto.description },
    });
    return toLocationDto(location);
  }

  async deactivate(id: string): Promise<LocationDto> {
    const location = await this.prisma.location.update({
      where: { id },
      data: { active: false },
    });
    return toLocationDto(location);
  }
}
