import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { AiModule } from '../ai/ai.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({ imports: [AgentModule, AiModule], controllers: [ChatController], providers: [ChatService] })
export class ChatModule {}
