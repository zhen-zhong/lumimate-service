import { ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

import type { AiChatProvider, AiChatRequest } from './ai-chat-provider';

export type OpenAiCompatibleProviderConfig = {
  id: string;
  apiKey?: string;
  baseURL: string;
  model: string;
};

export class OpenAiCompatibleChatProvider implements AiChatProvider {
  readonly id: string;
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(private readonly config: OpenAiCompatibleProviderConfig) {
    this.id = config.id;
    this.client = config.apiKey ? new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL }) : null;
    this.model = config.model;
  }

  async *streamChat(input: AiChatRequest): AsyncGenerator<string> {
    if (!this.client) {
      throw new ServiceUnavailableException(`未配置 ${this.id} Provider API Key`);
    }

    const stream = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      messages: [
        { role: 'system', content: input.systemPrompt },
        ...input.messages,
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content;
      if (delta) yield delta;
    }
  }
}
