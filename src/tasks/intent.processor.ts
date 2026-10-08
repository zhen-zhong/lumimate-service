import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { TasksService } from './tasks.service';
import { AGENT_INTENT_QUEUE, type ExecuteIntentJob } from './tasks.types';

@Processor(AGENT_INTENT_QUEUE)
export class IntentProcessor extends WorkerHost {
  constructor(private readonly tasks: TasksService) {
    super();
  }

  async process(job: Job<ExecuteIntentJob>) {
    await this.tasks.executeIntent(job.data.intentId);
  }
}
