import { ServiceUnavailableException } from '@nestjs/common';

import type { AiChatProvider, AiChatRequest } from '../interfaces/ai-chat-provider';

export class ModelRouterChatProvider implements AiChatProvider {
  readonly id = 'model-router';

  constructor(private readonly providers: ReadonlyMap<string, AiChatProvider>) {}

  streamChat(input: AiChatRequest): AsyncGenerator<string> {
    const provider = this.providers.get(input.modelId);
    if (!provider) throw new ServiceUnavailableException(`未配置聊天模型：${input.modelId}`);
    return provider.streamChat(input);
  }
}
