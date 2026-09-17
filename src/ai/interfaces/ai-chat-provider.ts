export type AiChatImage = {
  url: string;
  mimeType: string;
};

export type AiChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  images?: AiChatImage[];
};

export type AiChatRequest = {
  modelId: string;
  systemPrompt: string;
  messages: AiChatMessage[];
};

export interface AiChatProvider {
  readonly id: string;
  streamChat(input: AiChatRequest): AsyncGenerator<string>;
}

export const AI_CHAT_ROUTER = Symbol('AI_CHAT_ROUTER');
