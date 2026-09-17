export type ChatModelProtocol = 'openai-chat-completions' | 'anthropic-messages';

export type ChatModelDefinition = {
  id: string;
  label: string;
  protocol: ChatModelProtocol;
  provider: 'deepseek' | 'halomobi';
  apiKeyEnv?: string;
};

export const CHAT_MODELS: readonly ChatModelDefinition[] = [
  { id: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash', protocol: 'openai-chat-completions', provider: 'deepseek' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek-V4.1-Pro', protocol: 'openai-chat-completions', provider: 'deepseek' },
  { id: 'gpt-image-2', label: 'GPT Image 2', protocol: 'openai-chat-completions', provider: 'halomobi', apiKeyEnv: 'HALOMOBI_GPT_IMAGE_2_API_KEY' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', protocol: 'anthropic-messages', provider: 'halomobi', apiKeyEnv: 'HALOMOBI_CLAUDE_OPUS_4_7_API_KEY' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', protocol: 'anthropic-messages', provider: 'halomobi', apiKeyEnv: 'HALOMOBI_CLAUDE_OPUS_4_8_API_KEY' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', protocol: 'openai-chat-completions', provider: 'halomobi', apiKeyEnv: 'HALOMOBI_GPT_5_6_LUNA_API_KEY' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', protocol: 'openai-chat-completions', provider: 'halomobi', apiKeyEnv: 'HALOMOBI_GPT_5_6_SOL_API_KEY' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', protocol: 'openai-chat-completions', provider: 'halomobi', apiKeyEnv: 'HALOMOBI_GPT_6_ASTRA_API_KEY' },
] as const;

export const DEFAULT_CHAT_MODEL_ID = 'deepseek-flash';

export function getChatModel(modelId: string) {
  return CHAT_MODELS.find((model) => model.id === modelId);
}
