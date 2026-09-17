import { Inject, Injectable } from '@nestjs/common';

import { AI_CHAT_ROUTER, type AiChatMessage, type AiChatProvider, type AiChatStreamEvent } from '../ai/interfaces/ai-chat-provider';
import { AiModelCatalogService } from '../ai/ai-model-catalog.service';

export type AgentRunInput = {
  conversationId: string;
  messages: AiChatMessage[];
  agentName: string;
  agentProfile: string;
  responseStyle: string;
  modelId: string;
};

const SYSTEM_PROMPT = [
  '不得声称已经执行提醒、查询附近地点、读取文件或控制设备，除非对应工具已实际返回结果。',
].join('\n');

@Injectable()
export class AgentRunner {
  constructor(
    @Inject(AI_CHAT_ROUTER) private readonly provider: AiChatProvider,
    private readonly models: AiModelCatalogService,
  ) {}

  async *stream(input: AgentRunInput): AsyncGenerator<AiChatStreamEvent> {
    if (!await this.models.findEnabled(input.modelId)) {
      throw new Error('当前聊天模型已停用，请在高级设置中重新选择');
    }
    yield* this.provider.streamChat({
      modelId: input.modelId,
      systemPrompt: [
        `你是 ${input.agentName}，一位温和、可靠的长期陪伴助手。`,
        input.agentProfile ? `角色设定：${input.agentProfile}` : null,
        `回复风格：${input.responseStyle}。`,
        '使用简洁中文回答；不确定的信息明确说明不确定。',
        SYSTEM_PROMPT,
      ]
        .filter(Boolean)
        .join('\n'),
      messages: input.messages,
    });
  }
}
