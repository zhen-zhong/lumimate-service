import { ServiceUnavailableException } from '@nestjs/common';

import type { AiChatMessage, AiChatProvider, AiChatRequest } from '../interfaces/ai-chat-provider';

export type AnthropicMessagesProviderConfig = {
  id: string;
  apiKey?: string;
  baseURL: string;
};

function toContent(message: AiChatMessage) {
  if (!message.images?.length) return message.content;
  return [
    { type: 'text', text: message.content },
    ...message.images.map((image) => {
      const base64 = /^data:([^;]+);base64,(.+)$/i.exec(image.url);
      return base64
        ? { type: 'image', source: { type: 'base64', media_type: base64[1], data: base64[2] } }
        : { type: 'image', source: { type: 'url', url: image.url } };
    }),
  ];
}

export class AnthropicMessagesChatProvider implements AiChatProvider {
  readonly id: string;

  constructor(private readonly config: AnthropicMessagesProviderConfig) {
    this.id = config.id;
  }

  async *streamChat(input: AiChatRequest): AsyncGenerator<string> {
    if (!this.config.apiKey) {
      throw new ServiceUnavailableException(`未配置 ${this.id} Provider API Key`);
    }

    const response = await fetch(`${this.config.baseURL.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        model: input.modelId,
        system: input.systemPrompt,
        max_tokens: 2048,
        stream: true,
        messages: input.messages.map((message) => ({ role: message.role, content: toContent(message) })),
      }),
    });
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new ServiceUnavailableException(`Anthropic Messages 请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
          if (data) {
            try {
              const event = JSON.parse(data) as { type?: string; delta?: { text?: string }; error?: { message?: string } };
              if (event.type === 'content_block_delta' && event.delta?.text) yield event.delta.text;
              if (event.type === 'error') throw new ServiceUnavailableException(event.error?.message || 'Anthropic Messages 请求失败');
            } catch (error) {
              if (error instanceof ServiceUnavailableException) throw error;
            }
          }
          index = buffer.indexOf('\n\n');
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
