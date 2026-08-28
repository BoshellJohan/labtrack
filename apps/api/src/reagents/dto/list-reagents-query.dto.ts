import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const REAGENT_SORT_COLUMNS = ['name', 'casNumber', 'createdAt'] as const;

export class ListReagentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  casNumber?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsDateString()
  expiringBefore?: string;

  // A decimal string for the same reason quantities are: the threshold is
  // compared against Decimal(12,4) values, and routing it through a JS number
  // would round the boundary before the database ever sees it.
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,4})?$/, {
    message: 'lowStock must be a positive decimal with up to 4 decimal places',
  })
  lowStock?: string;

  @IsOptional()
  @IsIn(REAGENT_SORT_COLUMNS)
  sortBy: (typeof REAGENT_SORT_COLUMNS)[number] = 'name';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
