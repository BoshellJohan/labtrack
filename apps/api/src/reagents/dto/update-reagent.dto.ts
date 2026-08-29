import { PartialType, OmitType } from '@nestjs/mapped-types';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CreateReagentDto } from './create-reagent.dto';

// `PartialType` alone would inherit `reference`, `description` and
// `dataSheetUrl` with `@IsOptional()` only, which rejects an explicit
// `null`. Those three are re-declared below with a null-tolerant
// `ValidateIf` so a PATCH can clear them; `name` and `casNumber` still come
// from `PartialType(CreateReagentDto)` unchanged.
export class UpdateReagentDto extends PartialType(
  OmitType(CreateReagentDto, ['reference', 'description', 'dataSheetUrl']),
) {
  // `null` clears the field; `undefined` (omitted) leaves it unchanged.
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsUrl({ require_protocol: true })
  dataSheetUrl?: string | null;
}
