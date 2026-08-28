import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateConsumptionDto {
  @IsUUID()
  batchId!: string;

  // A decimal string, not a number. Without implicit conversion the pipe
  // leaves the body's types alone, so a numeric quantity reaches `@Matches`
  // still a number and is rejected instead of being silently stringified.
  @Matches(/^\d{1,8}(\.\d{1,4})?$/, {
    message: 'quantity must be a positive decimal with up to 4 decimal places',
  })
  quantity!: string;

  @IsDateString()
  consumedAt!: string;

  // Trimmed before validation so a purpose of only spaces fails `@IsNotEmpty`
  // rather than being stored as blank.
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  purpose!: string;
}
