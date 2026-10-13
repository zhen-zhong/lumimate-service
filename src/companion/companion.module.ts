import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CompanionTimelineService } from './companion-timeline.service';

@Module({ imports: [DatabaseModule], providers: [CompanionTimelineService], exports: [CompanionTimelineService] })
export class CompanionModule {}
