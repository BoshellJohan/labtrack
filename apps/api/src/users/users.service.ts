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

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<UserDto> {
    if (dto.role === 'USER' && id === actorId) {
      throw new BadRequestException('You cannot remove your own administrator role');
    }

    // The last-admin check and the write share one serializable transaction:
    // under a weaker isolation level two administrators demoting each other at
    // the same time would both read a count of two and both succeed, leaving
    // the system with no administrator and no way to create one.
    const user = await this.prisma.$transaction(
      async (tx) => {
        if (dto.role === 'USER') {
          const target = await tx.user.findUnique({ where: { id } });
          if (target?.role === 'ADMIN' && target.active) {
            const activeAdmins = await tx.user.count({
              where: { role: 'ADMIN', active: true },
            });
            if (activeAdmins <= 1) {
              throw new BadRequestException('The last active administrator cannot be demoted');
            }
          }
        }

        // The writable fields are named one by one rather than spread from the
        // DTO, so the "only these two are writable" rule is visible here.
        return tx.user.update({
          where: { id },
          data: { fullName: dto.fullName, role: dto.role },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

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
