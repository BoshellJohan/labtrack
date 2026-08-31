import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import { UNITS, type Unit } from '@labtrack/shared';
import { normalizeCasNumber } from '../../common/validation/cas-number';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { IsAfterOrEqual } from '../../common/validation/is-after-or-equal.validator';

export const REAGENT_SORT_COLUMNS = ['name', 'casNumber', 'createdAt'] as const;

export class ListReagentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  name?: string;

  // Normalised for the same reason the create path is: a CAS pasted into
  // the filter with an en dash would match nothing, and the user would
  // conclude the reagent is missing rather than that the dash is wrong.
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? normalizeCasNumber(value) : value,
  )
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

  // Spec §6.2 as amended: the threshold is meaningless without a unit,
  // because a reagent may hold batches in millilitres and litres at once and
  // this system never converts between them. `@ValidateIf` makes the unit
  // required *by* the threshold rather than making the pair all-or-nothing —
  // a unit on its own is harmless and simply narrows nothing.
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,4})?$/, {
    message:
      'minConsumed must be a positive decimal with up to 4 decimal places',
  })
  minConsumed?: string;

  @ValidateIf((dto: ListReagentsQueryDto) => dto.minConsumed !== undefined)
  @IsIn(UNITS, {
    message: 'minConsumedUnit is required when minConsumed is given',
  })
  minConsumedUnit?: Unit;

  @IsOptional()
  @IsDateString()
  consumedFrom?: string;

  @IsOptional()
  @IsDateString()
  @IsAfterOrEqual('consumedFrom', {
    message: 'consumedTo must not be earlier than consumedFrom',
  })
  consumedTo?: string;

  @IsOptional()
  @IsIn(REAGENT_SORT_COLUMNS)
  sortBy: (typeof REAGENT_SORT_COLUMNS)[number] = 'name';

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}
