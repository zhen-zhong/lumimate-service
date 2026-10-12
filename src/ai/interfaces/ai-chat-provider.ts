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

export type AiTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type AiChatStreamEvent =
  | { type: 'delta'; delta: string }
  | { type: 'usage'; usage: AiTokenUsage };

export type AiTaskToolCall = {
  name: 'task.list' | 'task.update' | 'task.cancel';
  input: Record<string, unknown>;
};

export type AiTaskToolRequest = {
  modelId: string;
  content: string;
  tasks: Array<{ id: string; title: string; dueAt: string; status: string }>;
};

export interface AiChatProvider {
  readonly id: string;
  streamChat(input: AiChatRequest): AsyncGenerator<AiChatStreamEvent>;
  selectTaskTool?(input: AiTaskToolRequest): Promise<AiTaskToolCall | null>;
}

export const AI_CHAT_ROUTER = Symbol('AI_CHAT_ROUTER');
