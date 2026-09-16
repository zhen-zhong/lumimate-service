import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

@Module({
  imports: [BullModule.registerQueue({ name: 'scheduled-tasks' })],
})
export class TasksModule {}
