import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { AiModule } from '../ai/ai.module';
import { MemoryModule } from '../memory/memory.module';
import { TasksModule } from '../tasks/tasks.module';
import { SkillPluginModule } from '../skills/skill-plugin.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({ imports: [AgentModule, AiModule, MemoryModule, TasksModule, SkillPluginModule], controllers: [ChatController], providers: [ChatService], exports: [ChatService] })
export class ChatModule {}
