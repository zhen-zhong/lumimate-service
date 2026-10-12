import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { MediaController, MediaUploadController } from './media.controller';
import { MediaStorageService } from './media-storage.service';
import { MediaAssetService } from './media-asset.service';
import { MediaProcessor } from './media.processor';
import { MEDIA_PROCESSING_QUEUE } from './media.types';
import { MediaUploadService } from './media-upload.service';

@Module({
  imports: [BullModule.registerQueue({ name: MEDIA_PROCESSING_QUEUE })],
  controllers: [MediaController, MediaUploadController],
  providers: [MediaStorageService, MediaAssetService, MediaUploadService, MediaProcessor],
  exports: [MediaStorageService, MediaAssetService, MediaUploadService],
})
export class MediaModule {}
