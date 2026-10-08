import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { IntentProcessor } from './intent.processor';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { AGENT_INTENT_QUEUE } from './tasks.types';

@Module({
  imports: [DatabaseModule, BullModule.registerQueue({ name: AGENT_INTENT_QUEUE })],
  controllers: [TasksController],
  providers: [TasksService, IntentProcessor],
  exports: [TasksService],
})
export class TasksModule {}
