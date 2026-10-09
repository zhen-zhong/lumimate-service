import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { PushService } from './push.service';
import { PUSH_QUEUE, type PushJob } from './push.types';

@Processor(PUSH_QUEUE)
export class PushProcessor extends WorkerHost {
  constructor(private readonly push: PushService) {
    super();
  }

  async process(job: Job<PushJob>) {
    if (job.data.type === 'receipt') {
      await this.push.checkReceipt(job.data.deliveryId);
      return;
    }
    try {
      await this.push.sendDelivery(job.data.deliveryId);
    } catch (error) {
      const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
      if (job.attemptsMade + 1 >= attempts) {
        await this.push.markDeliveryFailed(job.data.deliveryId, error);
      }
      throw error;
    }
  }
}
