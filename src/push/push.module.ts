import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CompanionModule } from '../companion/companion.module';
import { OutboxModule } from '../outbox/outbox.module';
import { PushController } from './push.controller';
import { PushProcessor } from './push.processor';
import { PushService } from './push.service';
import { PUSH_QUEUE } from './push.types';

@Module({
  imports: [DatabaseModule, CompanionModule, OutboxModule, BullModule.registerQueue({ name: PUSH_QUEUE })],
  controllers: [PushController],
  providers: [PushService, PushProcessor],
  exports: [PushService],
})
export class PushModule {}
