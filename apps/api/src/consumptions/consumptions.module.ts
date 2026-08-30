import { Module } from '@nestjs/common';
import { ReagentsModule } from '../reagents/reagents.module';
import { ConsumptionsController } from './consumptions.controller';
import { ConsumptionsExportController } from './export/consumptions-export.controller';
import { ConsumptionsService } from './consumptions.service';

@Module({
  imports: [ReagentsModule],
  controllers: [ConsumptionsController, ConsumptionsExportController],
  providers: [ConsumptionsService],
})
export class ConsumptionsModule {}
