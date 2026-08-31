import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { IMPORT_ROW_LIMIT } from '@labtrack/shared';

/**
 * The wire shape of `ImportRow`. Every field is a bare `@IsString()` (or
 * `@IsInt()` for the row number): the semantic rules — required-ness,
 * formats, date ordering — stay in `validateRowShape`, which is what both
 * the preview and this endpoint call, so they can never disagree about
 * what a row's shape allows.
 */
export class ImportRowDto {
  @IsInt()
  @Min(1)
  rowNumber!: number;

  @IsString()
  reagentName!: string;

  @IsString()
  casNumber!: string;

  @IsString()
  reference!: string;

  @IsString()
  lotNumber!: string;

  @IsString()
  entryDate!: string;

  @IsString()
  expirationDate!: string;

  @IsString()
  quantity!: string;

  @IsString()
  unit!: string;

  @IsString()
  locationName!: string;
}

export class ConfirmImportDto {
  @IsArray()
  @ArrayMaxSize(IMPORT_ROW_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}
