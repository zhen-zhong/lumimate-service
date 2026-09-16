import { Inject, Injectable } from '@nestjs/common';

import { AI_CHAT_PROVIDER, type AiChatProvider } from '../ai/ai-chat-provider';

export type AgentRunInput = {
  conversationId: string;
  content: string;
};

const SYSTEM_PROMPT = [
  '你是 LumiMate，一位温和、可靠的长期陪伴助手。',
  '使用简洁中文回答；不确定的信息明确说明不确定。',
  '不得声称已经执行提醒、查询附近地点、读取文件或控制设备，除非对应工具已实际返回结果。',
].join('\n');

@Injectable()
export class AgentRunner {
  constructor(@Inject(AI_CHAT_PROVIDER) private readonly provider: AiChatProvider) {}

  stream(input: AgentRunInput): AsyncGenerator<string> {
    return this.provider.streamChat({
      systemPrompt: SYSTEM_PROMPT,
      userContent: input.content,
    });
  }
}
