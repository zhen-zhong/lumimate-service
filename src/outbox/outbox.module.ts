import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { MEMORY_EXTRACTION_QUEUE } from '../memory/memory.types';
import { AGENT_INTENT_QUEUE } from '../tasks/tasks.types';
import { PUSH_QUEUE } from '../push/push.types';
import { OutboxProcessor } from './outbox.processor';
import { OutboxService } from './outbox.service';
import { OUTBOX_QUEUE } from './outbox.types';

@Module({
  imports: [DatabaseModule, BullModule.registerQueue({ name: OUTBOX_QUEUE }, { name: AGENT_INTENT_QUEUE }, { name: MEMORY_EXTRACTION_QUEUE }, { name: PUSH_QUEUE })],
  providers: [OutboxService, OutboxProcessor],
  exports: [OutboxService],
})
export class OutboxModule {}
