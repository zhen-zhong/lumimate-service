import { Injectable } from '@nestjs/common';

import { AgentRunner } from '../agent/agent-runner.service';
import type { CreateMessageDto } from './create-message.dto';

export type ChatEvent = {
  type: 'message.created' | 'message.delta' | 'message.completed' | 'error';
  data: Record<string, unknown>;
};

@Injectable()
export class ChatService {
  constructor(private readonly agentRunner: AgentRunner) {}

  async *stream(input: CreateMessageDto & { conversationId: string }): AsyncGenerator<ChatEvent> {
    const messageId = crypto.randomUUID();

    yield {
      type: 'message.created',
      data: { conversationId: input.conversationId, messageId, role: 'assistant' },
    };

    let content = '';
    try {
      for await (const delta of this.agentRunner.stream({
        conversationId: input.conversationId,
        content: input.content,
      })) {
        content += delta;
        yield { type: 'message.delta', data: { messageId, delta } };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型服务暂时不可用';
      yield { type: 'error', data: { messageId, code: 'MODEL_STREAM_FAILED', message } };
      return;
    }

    yield { type: 'message.completed', data: { messageId, content } };
  }
}
