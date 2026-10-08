import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { MemoryService } from './memory.service';
import { MEMORY_EXTRACTION_QUEUE, type ExtractMemoryJob } from './memory.types';

@Processor(MEMORY_EXTRACTION_QUEUE)
export class MemoryExtractionProcessor extends WorkerHost {
  constructor(private readonly memories: MemoryService) {
    super();
  }

  async process(job: Job<ExtractMemoryJob>) {
    await this.memories.extractCandidates(job.data);
  }
}
