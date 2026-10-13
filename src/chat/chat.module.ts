import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { AiModule } from '../ai/ai.module';
import { MemoryModule } from '../memory/memory.module';
import { MediaModule } from '../media/media.module';
import { TasksModule } from '../tasks/tasks.module';
import { SkillPluginModule } from '../skills/skill-plugin.module';
import { CompanionModule } from '../companion/companion.module';
import { OutboxModule } from '../outbox/outbox.module';
import { PushModule } from '../push/push.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({ imports: [AgentModule, AiModule, MemoryModule, MediaModule, TasksModule, SkillPluginModule, CompanionModule, OutboxModule, PushModule], controllers: [ChatController], providers: [ChatService], exports: [ChatService] })
export class ChatModule {}
