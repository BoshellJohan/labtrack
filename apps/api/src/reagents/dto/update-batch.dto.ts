import { IsDateString, IsOptional, IsUUID } from 'class-validator';

// lotNumber, entryDate, initialStock and unit are facts about a physical
// delivery: they do not change. currentStock changes only through consumptions.
export class UpdateBatchDto {
  @IsOptional()
  @IsDateString()
  expirationDate?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
