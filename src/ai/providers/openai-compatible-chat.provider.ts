import { ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

import type { AiChatProvider, AiChatRequest, AiChatStreamEvent, AiTaskToolCall, AiTaskToolRequest } from '../interfaces/ai-chat-provider';

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

  async *streamChat(input: AiChatRequest): AsyncGenerator<AiChatStreamEvent> {
    if (!this.client) {
      throw new ServiceUnavailableException(`未配置 ${this.id} Provider API Key`);
    }

    const stream = await this.client.chat.completions.create({
      model: input.modelId || this.model,
      stream: true,
      stream_options: { include_usage: true },
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
      if (delta) yield { type: 'delta', delta };
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? undefined,
            outputTokens: chunk.usage.completion_tokens ?? undefined,
          },
        };
      }
    }
  }

  async selectTaskTool(input: AiTaskToolRequest): Promise<AiTaskToolCall | null> {
    if (!this.client) throw new ServiceUnavailableException(`未配置 ${this.id} Provider API Key`);
    const response = await this.client.chat.completions.create({
      model: input.modelId || this.model,
      messages: [{
        role: 'system',
        content: `仅在用户明确请求查看、修改或取消提醒时调用工具。当前可管理任务：${JSON.stringify(input.tasks)}。任务 ID 必须来自该列表；不确定时不要调用。`,
      }, { role: 'user', content: input.content }],
      tools: [
        { type: 'function', function: { name: 'task.list', description: '查看当前会话的提醒任务', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
        { type: 'function', function: { name: 'task.cancel', description: '取消一个提醒任务', parameters: { type: 'object', properties: { intentId: { type: 'string' } }, required: ['intentId'], additionalProperties: false } } },
        { type: 'function', function: { name: 'task.update', description: '修改一个提醒任务', parameters: { type: 'object', properties: { intentId: { type: 'string' }, title: { type: 'string' }, dueAt: { type: 'string', description: 'ISO 8601 时间' }, timezone: { type: 'string' } }, required: ['intentId'], additionalProperties: false } } },
      ],
      tool_choice: 'auto',
    });
    const call = response.choices[0]?.message.tool_calls?.[0];
    if (!call || call.type !== 'function' || !['task.list', 'task.update', 'task.cancel'].includes(call.function.name)) return null;
    try {
      const inputData: unknown = JSON.parse(call.function.arguments || '{}');
      if (!inputData || typeof inputData !== 'object' || Array.isArray(inputData)) return null;
      return { name: call.function.name as AiTaskToolCall['name'], input: inputData as Record<string, unknown> };
    } catch {
      return null;
    }
  }
}
