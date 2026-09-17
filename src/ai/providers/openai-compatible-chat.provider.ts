import { ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

import type { AiChatProvider, AiChatRequest } from '../interfaces/ai-chat-provider';

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
      model: input.modelId || this.model,
      stream: true,
      messages: [
        { role: 'system', content: input.systemPrompt },
        ...input.messages.map((message) => message.role === 'user'
          ? {
              role: 'user' as const,
              content: message.images?.length
                ? [
                    { type: 'text' as const, text: message.content },
                    ...message.images.map((image) => ({
                      type: 'image_url' as const,
                      image_url: { url: image.url },
                    })),
                  ]
                : message.content,
            }
          : { role: 'assistant' as const, content: message.content }),
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta.content;
      if (delta) yield delta;
    }
  }
}
