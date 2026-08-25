import { Module } from '@nestjs/common';
import { ReagentsService } from './reagents.service';
import { ReagentsController } from './reagents.controller';
import { BatchesService } from './batches.service';
import {
  BatchesController,
  ReagentBatchesController,
} from './batches.controller';

@Module({
  controllers: [
    ReagentsController,
    ReagentBatchesController,
    BatchesController,
  ],
  providers: [ReagentsService, BatchesService],
  exports: [ReagentsService, BatchesService],
})
export class ReagentsModule {}
