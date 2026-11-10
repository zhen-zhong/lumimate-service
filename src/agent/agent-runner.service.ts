import { Inject, Injectable } from '@nestjs/common';

import { AI_CHAT_ROUTER, type AiChatMessage, type AiChatProvider, type AiChatStreamEvent, type AiTaskToolCall } from '../ai/interfaces/ai-chat-provider';
import { AiModelCatalogService } from '../ai/ai-model-catalog.service';
import {
  formatPersonaProfile,
  createDefaultPersonaDraft,
  normalizePersonaDraft,
  normalizePersonaProfile,
  type PersonaDraft,
  type PersonaGenerationPreferences,
  type PersonaProfile,
} from './persona-profile';

export type AgentRunInput = {
  conversationId: string;
  messages: AiChatMessage[];
  agentName: string;
  agentProfile: string;
  personaProfile?: PersonaProfile | null;
  responseStyle: string;
  modelId: string;
  memoryContext?: string;
  presenceContext?: string;
  skillInstructions?: string[];
  reminder?: { title: string; dueAt: string; timezone: string };
  reminderRequested?: boolean;
  imageCaption?: boolean;
  taskToolResult?: string;
};

export type PersonaDraftInput = {
  modelId: string;
  current: {
    agentName: string;
    agentProfile: string;
    responseStyle: string;
    personaProfile?: PersonaProfile | null;
  };
  preferences?: PersonaGenerationPreferences;
};

const SYSTEM_PROMPT = [
  '不得声称已经执行提醒、查询附近地点、读取文件或控制设备，除非对应工具已实际返回结果。',
  '提醒是否可创建由服务端在回复结束后解析；不得因无法直接控制手机而拒绝提醒，也不得承诺提醒已创建或一定会推送。',
].join('\n');

const PERSONA_DRAFT_PROMPT = [
  '你是角色设计师。为中文 AI 陪伴产品生成一个可长期相处的虚拟角色草稿。',
  '目标是有性格的陪伴角色，不是心理咨询师、客服或泛泛的“温柔 AI”。',
  '角色必须有：稳定身份、性格张力、表达习惯、关系方式、兴趣或日常节奏、互动边界。',
  '角色可以有虚拟日程和角色世界观，但不得冒充真人、现实经历、线下活动、真实拍摄或离线持续观察。',
  '不得使用“作为 AI”“我是人工智能”“我会一直等你”“我永远都在”等模板句；不得情感绑架、诱导依赖、贬低现实关系。',
  '角色应先接住具体情绪或细节，再表达看法；不需要每次都提问或提供建议。',
  '若已有草稿，保留其有辨识度的部分并补足空白；没有草稿时创建自然、克制、有一点主见的默认角色。',
  '只输出一个合法 JSON 对象，不要 Markdown、代码块或额外文字。',
  'JSON 必须且只能含：agentName（2-16 字）、agentProfile（300-1200 字）、responseStyle（20-120 字）、personaProfile。',
  'personaProfile 必须且只能含 identity、temperament、speech、relationshipStyle、interests、boundaries、examples；examples 为 1–4 条短句数组。',
].join('\n');

function parsePersonaDraft(content: string, fallback: PersonaDraft): PersonaDraft {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('角色生成结果格式错误，请重试');
  try {
    return normalizePersonaDraft(JSON.parse(cleaned.slice(start, end + 1)), fallback);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('角色生成结果')) throw error;
    throw new Error('角色生成结果格式错误，请重试');
  }
}

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
        input.personaProfile ? formatPersonaProfile(input.personaProfile) : null,
        `回复风格：${input.responseStyle}。`,
        input.memoryContext || null,
        input.presenceContext || null,
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

  async generatePersonaDraft(input: PersonaDraftInput): Promise<PersonaDraft> {
    if (!await this.models.findEnabled(input.modelId)) {
      throw new Error('当前聊天模型已停用，请在高级设置中重新选择');
    }
    let content = '';
    for await (const event of this.provider.streamChat({
      modelId: input.modelId,
      systemPrompt: PERSONA_DRAFT_PROMPT,
      messages: [{
        role: 'user',
        content: `当前草稿：${JSON.stringify(input.current)}\n生成偏好：${JSON.stringify(input.preferences ?? {})}`,
      }],
    })) {
      if (event.type === 'delta') content += event.delta;
    }
    const fallback = createDefaultPersonaDraft(input.current.agentName || 'LumiMate');
    return parsePersonaDraft(content, {
      ...fallback,
      agentProfile: input.current.agentProfile || fallback.agentProfile,
      responseStyle: input.current.responseStyle || fallback.responseStyle,
      personaProfile: normalizePersonaProfile(input.current.personaProfile, fallback.agentName) ?? fallback.personaProfile,
    });
  }

  async selectTaskTool(input: { modelId: string; content: string; tasks: Array<{ id: string; title: string; dueAt: string; status: string }> }): Promise<AiTaskToolCall | null> {
    if (!await this.models.findEnabled(input.modelId)) return null;
    return this.provider.selectTaskTool?.(input) ?? null;
  }
}
