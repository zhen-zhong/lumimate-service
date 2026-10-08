import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { MemoryExtractionProcessor } from './memory-extraction.processor';
import { MemoryService } from './memory.service';
import { MEMORY_EXTRACTION_QUEUE } from './memory.types';

@Module({
  imports: [DatabaseModule, BullModule.registerQueue({ name: MEMORY_EXTRACTION_QUEUE })],
  providers: [MemoryService, MemoryExtractionProcessor],
  exports: [MemoryService],
})
export class MemoryModule {}
