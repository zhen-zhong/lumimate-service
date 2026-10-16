import { Inject, Injectable } from '@nestjs/common';

import { AI_CHAT_ROUTER, type AiChatMessage, type AiChatProvider, type AiChatStreamEvent, type AiTaskToolCall } from '../ai/interfaces/ai-chat-provider';
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
  imageCaption?: boolean;
  taskToolResult?: string;
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
        input.imageCaption
          ? '这是图片生成成功后的配文步骤。权威事实：本次请求已经生成并保存了一张图片，图片附件已交付给用户。仅输出一句自然、温和的中文配文；不超过 40 个字，不要标题、Markdown、引号或生成过程说明。绝对不要说不能生成图片、没有照片、没有实体、无法发送图片，也不要拒绝或解释限制。'
          : null,
        input.taskToolResult ? `已执行受控任务工具，结果如下：${input.taskToolResult}。据此自然回答；不可声称未确认的修改或取消已经完成。` : null,
        '使用简洁中文回答；不确定的信息明确说明不确定。',
        SYSTEM_PROMPT,
      ]
        .filter(Boolean)
        .join('\n'),
      messages: input.messages,
    });
  }

  async selectTaskTool(input: { modelId: string; content: string; tasks: Array<{ id: string; title: string; dueAt: string; status: string }> }): Promise<AiTaskToolCall | null> {
    if (!await this.models.findEnabled(input.modelId)) return null;
    return this.provider.selectTaskTool?.(input) ?? null;
  }
}
