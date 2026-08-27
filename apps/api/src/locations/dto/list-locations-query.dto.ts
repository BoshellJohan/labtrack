import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const LOCATION_SORT_COLUMNS = ['name', 'createdAt'] as const;

export class ListLocationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(LOCATION_SORT_COLUMNS)
  sortBy: (typeof LOCATION_SORT_COLUMNS)[number] = 'name';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
