import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResponse, UserDto, buildPaginatedResponse } from '@labtrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { toUserDto } from '../common/mappers/user.mapper';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<PaginatedResponse<UserDto>> {
    const where: Prisma.UserWhereInput = {};
    if (!query.includeInactive) {
      where.active = true;
    }
    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // The count and the page come from the same transaction, so the total
    // always corresponds to the rows being shown.
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: query.skip,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResponse(data.map(toUserDto), total, query.page, query.pageSize);
  }

  async create(dto: CreateUserDto, actorId: string): Promise<UserDto> {
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        fullName: dto.fullName,
        role: dto.role,
        passwordHash: await this.passwords.hash(dto.password),
        mustChangePassword: true,
        madeById: actorId,
      },
    });
    return toUserDto(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDto> {
    const user = await this.prisma.user.update({ where: { id }, data: { ...dto } });
    return toUserDto(user);
  }

  async deactivate(id: string, actorId: string): Promise<UserDto> {
    if (id === actorId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.prisma.user.update({ where: { id }, data: { active: false } });
    return toUserDto(user);
  }
}
