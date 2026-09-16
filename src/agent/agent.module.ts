import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AgentRunner } from './agent-runner.service';

@Module({ imports: [AiModule], providers: [AgentRunner], exports: [AgentRunner] })
export class AgentModule {}
