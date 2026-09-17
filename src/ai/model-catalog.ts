export type ChatModelProtocol = 'openai-chat-completions' | 'anthropic-messages';
export type AiModelCapability = 'chat' | 'image-generation';

export type AiModelDefinition = {
  id: string;
  label: string;
  protocol: ChatModelProtocol;
  provider: 'deepseek' | 'halomobi';
  capability: AiModelCapability;
  apiKeyEnv?: string;
};

export const AI_MODELS: readonly AiModelDefinition[] = [
  { id: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash', protocol: 'openai-chat-completions', provider: 'deepseek', capability: 'chat' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek-V4.1-Pro', protocol: 'openai-chat-completions', provider: 'deepseek', capability: 'chat' },
  { id: 'gpt-image-2', label: 'GPT Image 2', protocol: 'openai-chat-completions', provider: 'halomobi', capability: 'image-generation', apiKeyEnv: 'HALOMOBI_GPT_IMAGE_2_API_KEY' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', protocol: 'anthropic-messages', provider: 'halomobi', capability: 'chat', apiKeyEnv: 'HALOMOBI_CLAUDE_OPUS_4_7_API_KEY' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', protocol: 'anthropic-messages', provider: 'halomobi', capability: 'chat', apiKeyEnv: 'HALOMOBI_CLAUDE_OPUS_4_8_API_KEY' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', protocol: 'openai-chat-completions', provider: 'halomobi', capability: 'chat', apiKeyEnv: 'HALOMOBI_GPT_5_6_LUNA_API_KEY' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', protocol: 'openai-chat-completions', provider: 'halomobi', capability: 'chat', apiKeyEnv: 'HALOMOBI_GPT_5_6_SOL_API_KEY' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', protocol: 'openai-chat-completions', provider: 'halomobi', capability: 'chat', apiKeyEnv: 'HALOMOBI_GPT_6_ASTRA_API_KEY' },
] as const;

export const CHAT_MODELS = AI_MODELS.filter((model) => model.capability === 'chat');

export const DEFAULT_CHAT_MODEL_ID = 'deepseek-flash';

export function getChatModel(modelId: string) {
  return CHAT_MODELS.find((model) => model.id === modelId);
}
