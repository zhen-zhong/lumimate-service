import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AI_CHAT_PROVIDER } from './ai-chat-provider';
import { OpenAiCompatibleChatProvider } from './openai-compatible-chat.provider';

function configuredValue(config: ConfigService, key: string, fallback?: string) {
  return config.get<string>(key)?.trim() || fallback;
}

@Module({
  providers: [
    {
      provide: AI_CHAT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = configuredValue(config, 'AI_PROVIDER', 'deepseek');

        if (provider === 'deepseek') {
          return new OpenAiCompatibleChatProvider({
            id: 'DeepSeek',
            apiKey: configuredValue(config, 'DEEPSEEK_API_KEY'),
            baseURL: configuredValue(config, 'DEEPSEEK_BASE_URL', 'https://api.deepseek.com')!,
            model: configuredValue(config, 'DEEPSEEK_MODEL', 'deepseek-flash')!,
          });
        }

        if (provider === 'openai-compatible') {
          const baseURL = configuredValue(config, 'AI_COMPATIBLE_BASE_URL');
          const model = configuredValue(config, 'AI_COMPATIBLE_MODEL');
          if (!baseURL || !model) {
            throw new Error('AI_PROVIDER=openai-compatible 时必须配置 AI_COMPATIBLE_BASE_URL 和 AI_COMPATIBLE_MODEL');
          }

          return new OpenAiCompatibleChatProvider({
            id: 'OpenAI-compatible',
            apiKey: configuredValue(config, 'AI_COMPATIBLE_API_KEY'),
            baseURL,
            model,
          });
        }

        throw new Error(`不支持的 AI_PROVIDER：${provider}`);
      },
    },
  ],
  exports: [AI_CHAT_PROVIDER],
})
export class AiModule {}
