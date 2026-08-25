import { Module } from '@nestjs/common';
import { ReagentsService } from './reagents.service';
import { ReagentsController } from './reagents.controller';

@Module({
  controllers: [ReagentsController],
  providers: [ReagentsService],
  exports: [ReagentsService],
})
export class ReagentsModule {}
