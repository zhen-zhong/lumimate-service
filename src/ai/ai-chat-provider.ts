export type AiChatRequest = {
  systemPrompt: string;
  userContent: string;
};

export interface AiChatProvider {
  readonly id: string;
  streamChat(input: AiChatRequest): AsyncGenerator<string>;
}

export const AI_CHAT_PROVIDER = Symbol('AI_CHAT_PROVIDER');
