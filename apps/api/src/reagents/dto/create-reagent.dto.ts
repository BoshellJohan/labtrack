import {
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateReagentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  // CAS numbers are 2-7 digits, 2 digits and a check digit, e.g. 67-64-1.
  @IsString()
  @Matches(/^\d{2,7}-\d{2}-\d$/, {
    message: 'casNumber must look like 67-64-1',
  })
  casNumber!: string;

  // A create has nothing to clear yet, so `null` is rejected here — only
  // the update DTO tolerates it (see update-reagent.dto.ts). `ValidateIf`
  // only skips validation when the value is omitted (`undefined`); an
  // explicit `null` still runs `@IsString()` and fails.
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(80)
  reference?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsUrl({ require_protocol: true })
  dataSheetUrl?: string;
}
