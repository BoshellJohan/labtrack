import { Module } from '@nestjs/common';
import { ConsumptionsController } from './consumptions.controller';
import { ConsumptionsService } from './consumptions.service';

@Module({
  controllers: [ConsumptionsController],
  providers: [ConsumptionsService],
})
export class ConsumptionsModule {}
