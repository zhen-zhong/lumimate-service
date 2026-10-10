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
  memoryContext?: string;
  skillInstructions?: string[];
  reminder?: { title: string; dueAt: string; timezone: string };
  reminderRequested?: boolean;
};

const SYSTEM_PROMPT = [
  '不得声称已经执行提醒、查询附近地点、读取文件或控制设备，除非对应工具已实际返回结果。',
  '提醒是否可创建由服务端在回复结束后解析；不得因无法直接控制手机而拒绝提醒，也不得承诺提醒已创建或一定会推送。',
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
        input.memoryContext || null,
        input.skillInstructions?.length ? ['已启用技能规则：', ...input.skillInstructions].join('\n') : null,
        input.reminder
          ? `服务已识别提醒“${input.reminder.title}”，触发时间 ${input.reminder.dueAt}（${input.reminder.timezone}）。回复中只需提示用户确认下方提醒卡；确认前不得称为已创建。`
          : input.reminderRequested
            ? '用户在请求提醒，但服务未识别到未来的明确时间。请直接提示格式：今天/明天/后天/N天后 HH:mm 提醒我做某事；未写日期时按今天处理。'
            : null,
        '使用简洁中文回答；不确定的信息明确说明不确定。',
        SYSTEM_PROMPT,
      ]
        .filter(Boolean)
        .join('\n'),
      messages: input.messages,
    });
  }
}
