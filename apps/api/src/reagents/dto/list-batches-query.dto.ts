import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const BATCH_SORT_COLUMNS = [
  'entryDate',
  'expirationDate',
  'lotNumber',
] as const;

export class ListBatchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(BATCH_SORT_COLUMNS)
  sortBy: (typeof BATCH_SORT_COLUMNS)[number] = 'entryDate';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
