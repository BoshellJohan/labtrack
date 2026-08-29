import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  // A create has nothing to clear yet, so `null` is rejected here — only
  // the update DTO tolerates it (see update-location.dto.ts). `ValidateIf`
  // only skips validation when the value is omitted (`undefined`); an
  // explicit `null` still runs `@IsString()` and fails, mirroring
  // create-reagent.dto.ts.
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  description?: string;
}
