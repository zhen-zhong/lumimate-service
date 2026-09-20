import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AgentRunner } from './agent-runner.service';
import { ImageToolAgent } from './image-tool-agent.service';

@Module({ imports: [AiModule], providers: [AgentRunner, ImageToolAgent], exports: [AgentRunner, ImageToolAgent] })
export class AgentModule {}
