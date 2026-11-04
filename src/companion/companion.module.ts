import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CompanionTimelineService } from './companion-timeline.service';
import { CompanionPresenceService } from './companion-presence.service';

@Module({
  imports: [DatabaseModule],
  providers: [CompanionTimelineService, CompanionPresenceService],
  exports: [CompanionTimelineService, CompanionPresenceService],
})
export class CompanionModule {}
