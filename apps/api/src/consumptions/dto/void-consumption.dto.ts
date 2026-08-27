import { Transform, TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VoidConsumptionDto {
  // Mandatory by spec §4.4: an administrator removing a record from the
  // history has to say why, and a reason of only spaces is not a reason —
  // hence the trim before `@IsNotEmpty`.
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  voidReason!: string;
}
