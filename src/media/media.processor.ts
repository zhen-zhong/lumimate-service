import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { MediaAssetService } from './media-asset.service';
import { MEDIA_PROCESSING_QUEUE, type ProcessVideoJob } from './media.types';

@Processor(MEDIA_PROCESSING_QUEUE)
export class MediaProcessor extends WorkerHost {
  constructor(private readonly mediaAssets: MediaAssetService) {
    super();
  }

  async process(job: Job<ProcessVideoJob>) {
    await this.mediaAssets.processVideo(job.data.mediaAssetId);
  }
}
