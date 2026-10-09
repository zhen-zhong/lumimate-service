import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { DatabaseModule } from '../database/database.module';
import { TasksModule } from '../tasks/tasks.module';
import { AgentToolController } from './agent-tool.controller';
import { AgentToolService } from './agent-tool.service';
import { AgentRunner } from './agent-runner.service';
import { ImageToolAgent } from './image-tool-agent.service';

@Module({
  imports: [AiModule, DatabaseModule, TasksModule],
  controllers: [AgentToolController],
  providers: [AgentRunner, ImageToolAgent, AgentToolService],
  exports: [AgentRunner, ImageToolAgent, AgentToolService],
})
export class AgentModule {}
