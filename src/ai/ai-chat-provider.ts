export type AiChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AiChatRequest = {
  systemPrompt: string;
  messages: AiChatMessage[];
};

export interface AiChatProvider {
  readonly id: string;
  streamChat(input: AiChatRequest): AsyncGenerator<string>;
}

export const AI_CHAT_PROVIDER = Symbol('AI_CHAT_PROVIDER');
