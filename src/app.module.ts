import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { ChatModule } from './chat/chat.module';
import { AgentModule } from './agent/agent.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    DatabaseModule,
    AgentModule,
    HealthModule,
    ChatModule,
    TasksModule,
  ],
})
export class AppModule {}
