import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { AiModule } from '../ai/ai.module';
import { MemoryModule } from '../memory/memory.module';
import { TasksModule } from '../tasks/tasks.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({ imports: [AgentModule, AiModule, MemoryModule, TasksModule], controllers: [ChatController], providers: [ChatService], exports: [ChatService] })
export class ChatModule {}
