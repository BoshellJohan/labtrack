import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  // `null` clears the field; `undefined` (omitted) leaves it unchanged.
  // ValidateIf skips the string validators for an explicit null so it
  // survives validation instead of being rejected.
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}
