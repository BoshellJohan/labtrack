import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const USER_SORT_COLUMNS = ['username', 'fullName', 'role', 'createdAt'] as const;

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(USER_SORT_COLUMNS)
  sortBy: (typeof USER_SORT_COLUMNS)[number] = 'createdAt';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
