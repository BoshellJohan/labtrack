import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { UNITS } from '@labtrack/shared';
import type { Unit } from '@labtrack/shared';

export class CreateBatchDto {
  @IsString()
  @MaxLength(60)
  lotNumber!: string;

  @IsDateString()
  entryDate!: string;

  @IsOptional()
  @IsDateString()
  expirationDate?: string;

  // A decimal string, not a number: Decimal(12,4) does not survive a round trip
  // through JavaScript's number type without losing precision. Without
  // implicit conversion, the ValidationPipe leaves the request body's type
  // alone, so a numeric initialStock reaches `@Matches` still as a number
  // and is rejected rather than silently coerced to a string first.
  @Matches(/^\d{1,8}(\.\d{1,4})?$/, {
    message:
      'initialStock must be a positive decimal with up to 4 decimal places',
  })
  initialStock!: string;

  @IsIn(UNITS)
  unit!: Unit;

  @IsUUID()
  locationId!: string;
}
