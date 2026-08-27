import {
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
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

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  dataSheetUrl?: string;
}
