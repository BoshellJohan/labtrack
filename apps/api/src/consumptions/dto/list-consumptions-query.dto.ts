import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CONSUMPTION_SORT_COLUMNS } from '@labtrack/shared';
import type { ConsumptionSortColumn } from '@labtrack/shared';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListConsumptionsQueryDto extends PaginationQueryDto {
  // Spec §6.3: newest first is the default, because the question this screen
  // answers is almost always "what happened recently". PaginationQueryDto
  // already defaults sortOrder to 'desc'.
  @IsOptional()
  @IsIn(CONSUMPTION_SORT_COLUMNS)
  sortBy: ConsumptionSortColumn = 'consumedAt';

  @IsOptional()
  @IsUUID()
  reagentId?: string;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  madeById?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeVoided?: boolean;
}
