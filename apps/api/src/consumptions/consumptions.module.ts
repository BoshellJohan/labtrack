import { Module } from '@nestjs/common';
import { ConsumptionsController } from './consumptions.controller';
import { ConsumptionsExportController } from './export/consumptions-export.controller';
import { ConsumptionsService } from './consumptions.service';

@Module({
  controllers: [ConsumptionsController, ConsumptionsExportController],
  providers: [ConsumptionsService],
})
export class ConsumptionsModule {}
