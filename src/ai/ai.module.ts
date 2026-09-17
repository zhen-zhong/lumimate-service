import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AI_CHAT_ROUTER } from './interfaces/ai-chat-provider';
import { AiModelCatalogService } from './ai-model-catalog.service';
import { AiModelController } from './ai-model.controller';
import { CHAT_MODELS } from './model-catalog';
import { AnthropicMessagesChatProvider } from './providers/anthropic-messages-chat.provider';
import { ModelRouterChatProvider } from './providers/model-router-chat.provider';
import { OpenAiCompatibleChatProvider } from './providers/openai-compatible-chat.provider';

function configuredValue(config: ConfigService, key: string, fallback?: string) {
  return config.get<string>(key)?.trim() || fallback;
}

@Module({
  controllers: [AiModelController],
  providers: [
    AiModelCatalogService,
    {
      provide: AI_CHAT_ROUTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const deepSeek = new OpenAiCompatibleChatProvider({
            id: 'DeepSeek',
            apiKey: configuredValue(config, 'DEEPSEEK_API_KEY'),
            baseURL: configuredValue(config, 'DEEPSEEK_BASE_URL', 'https://api.deepseek.com')!,
            model: configuredValue(config, 'DEEPSEEK_MODEL', 'deepseek-flash')!,
        });
        const haloBaseURL = configuredValue(config, 'HALOMOBI_BASE_URL', 'https://token.halomobi.com/v1')!;
        const providers = new Map<string, OpenAiCompatibleChatProvider | AnthropicMessagesChatProvider>();
        for (const model of CHAT_MODELS) {
          if (model.provider === 'deepseek') {
            providers.set(model.id, deepSeek);
            continue;
          }
          if (model.provider !== 'halomobi' || !model.apiKeyEnv) continue;
          const provider = model.protocol === 'anthropic-messages'
            ? new AnthropicMessagesChatProvider({
                id: `${model.label} Anthropic Messages`,
                apiKey: configuredValue(config, model.apiKeyEnv),
                baseURL: haloBaseURL,
              })
            : new OpenAiCompatibleChatProvider({
                id: `${model.label} OpenAI Chat Completions`,
                apiKey: configuredValue(config, model.apiKeyEnv),
                baseURL: haloBaseURL,
                model: model.id,
              });
          providers.set(model.id, provider);
        }
        return new ModelRouterChatProvider(providers);
      },
    },
  ],
  exports: [AI_CHAT_ROUTER, AiModelCatalogService],
})
export class AiModule {}
