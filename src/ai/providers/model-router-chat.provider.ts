import { ServiceUnavailableException } from '@nestjs/common';

import type { AiChatProvider, AiChatRequest, AiChatStreamEvent, AiTaskToolCall, AiTaskToolRequest } from '../interfaces/ai-chat-provider';

export class ModelRouterChatProvider implements AiChatProvider {
  readonly id = 'model-router';

  constructor(private readonly providers: ReadonlyMap<string, AiChatProvider>) {}

  streamChat(input: AiChatRequest): AsyncGenerator<AiChatStreamEvent> {
    const provider = this.providers.get(input.modelId);
    if (!provider) throw new ServiceUnavailableException(`未配置聊天模型：${input.modelId}`);
    return provider.streamChat(input);
  }

  selectTaskTool(input: AiTaskToolRequest): Promise<AiTaskToolCall | null> {
    const provider = this.providers.get(input.modelId);
    if (!provider?.selectTaskTool) return Promise.resolve(null);
    return provider.selectTaskTool(input);
  }
}
