import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageRole, MessageStatus, Prisma } from '@prisma/client';

import { AgentRunner } from '../agent/agent-runner.service';
import { AiModelCatalogService } from '../ai/ai-model-catalog.service';
import { DEFAULT_CHAT_MODEL_ID } from '../ai/model-catalog';
import { PrismaService } from '../database/prisma.service';
import type { CreateMessageDto } from './dto/create-message.dto';
import type { UpdateChatSettingsDto } from './dto/update-chat-settings.dto';

export type ChatEvent = {
  type: 'message.created' | 'message.delta' | 'message.completed' | 'error';
  data: Record<string, unknown>;
};

const LOCAL_USER_ID = 'local-user';
const DEFAULT_CONTEXT_MESSAGE_LIMIT = 100;
const HARD_MAX_CONTEXT_MESSAGE_LIMIT = 1_000;
const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function isSupportedImageUrl(value: unknown, mimeType: unknown): value is string {
  return typeof value === 'string' &&
    SUPPORTED_IMAGE_MIME_TYPES.includes(String(mimeType)) &&
    (value.startsWith(`data:${mimeType};base64,`) || /^https?:\/\//i.test(value));
}

function getContextMessageLimit(value?: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_CONTEXT_MESSAGE_LIMIT;
  return Math.min(parsed, HARD_MAX_CONTEXT_MESSAGE_LIMIT);
}

@Injectable()
export class ChatService {
  private readonly contextMessageLimit: number;

  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly models: AiModelCatalogService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.contextMessageLimit = getContextMessageLimit(config.get<string>('CHAT_CONTEXT_MESSAGE_LIMIT'));
  }

  async *stream(input: CreateMessageDto & { conversationId: string }): AsyncGenerator<ChatEvent> {
    const images = input.attachments?.filter((attachment) =>
      isSupportedImageUrl(attachment.url, attachment.mimeType),
    ) ?? [];

    const conversation = await this.ensureChatConversation(
      await this.ensureConversation(input.conversationId),
    );
    const model = await this.models.findEnabled(conversation.modelId);
    if (!model) {
      yield { type: 'error', data: { code: 'MODEL_DISABLED', message: '当前聊天模型已停用，请在高级设置中重新选择' } };
      return;
    }
    const modelData = {
      modelId: model.id,
      modelLabel: model.label,
      provider: model.provider,
      protocol: model.protocol,
    };
    const history = await this.prisma.message.findMany({
      where: {
        conversationId: input.conversationId,
        role: { in: [MessageRole.USER, MessageRole.ASSISTANT] },
        status: MessageStatus.COMPLETED,
      },
      orderBy: { createdAt: 'desc' },
      take: conversation.contextMessageLimit,
      select: { role: true, content: true },
    });
    history.reverse();

    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: MessageRole.USER,
        content: input.content,
        metadata: input.attachments
          ? ({ attachments: input.attachments } as unknown as Prisma.InputJsonValue)
          : undefined,
        ...modelData,
      },
    });
    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: MessageRole.ASSISTANT,
        status: MessageStatus.STREAMING,
        content: '',
        ...modelData,
      },
    });
    const messageId = assistantMessage.id;

    yield {
      type: 'message.created',
      data: { conversationId: input.conversationId, messageId, role: 'assistant', model: modelData },
    };

    let content = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      for await (const event of this.agentRunner.stream({
        conversationId: input.conversationId,
        agentName: conversation.agentName,
        agentProfile: conversation.agentProfile,
        responseStyle: conversation.responseStyle,
        modelId: conversation.modelId,
        messages: [
          ...history.map((message) => ({
            role: message.role === MessageRole.USER ? 'user' as const : 'assistant' as const,
            content: message.content,
          })),
          {
            role: 'user',
            content: input.content,
            images,
          },
        ],
      })) {
        if (event.type === 'delta') {
          content += event.delta;
          yield { type: 'message.delta', data: { messageId, delta: event.delta } };
        } else {
          inputTokens = event.usage.inputTokens ?? inputTokens;
          outputTokens = event.usage.outputTokens ?? outputTokens;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型服务暂时不可用';
      await this.prisma.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.FAILED, content: message, inputTokens, outputTokens },
      });
      yield { type: 'error', data: { messageId, code: 'MODEL_STREAM_FAILED', message } };
      return;
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.COMPLETED, content, inputTokens, outputTokens },
    });
    await this.prisma.message.update({
      where: { id: userMessage.id },
      data: { inputTokens, outputTokens: 0 },
    });
    yield {
      type: 'message.completed',
      data: { messageId, content, model: modelData, usage: { inputTokens, outputTokens } },
    };
  }

  private async ensureConversation(conversationId: string) {
    await this.prisma.user.upsert({
      where: { id: LOCAL_USER_ID },
      update: {},
      create: { id: LOCAL_USER_ID },
    });
    return this.prisma.conversation.upsert({
      where: { id: conversationId },
      update: {},
      create: {
        id: conversationId,
        userId: LOCAL_USER_ID,
        contextMessageLimit: this.contextMessageLimit,
        modelId: DEFAULT_CHAT_MODEL_ID,
      },
    });
  }

  async getSettings(conversationId: string) {
    const conversation = await this.ensureChatConversation(await this.ensureConversation(conversationId));
    return this.serializeSettings(conversation);
  }

  async listMessages(conversationId: string) {
    await this.ensureConversation(conversationId);
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        role: { in: [MessageRole.USER, MessageRole.ASSISTANT] },
        status: MessageStatus.COMPLETED,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        metadata: true,
        modelId: true,
        modelLabel: true,
        provider: true,
        protocol: true,
        inputTokens: true,
        outputTokens: true,
      },
    });
    return messages.map((message) => ({
      id: message.id,
      role: message.role === MessageRole.USER ? 'user' : 'assistant',
      content: message.content,
      attachments: this.attachmentsFromMetadata(message.metadata),
      modelId: message.modelId,
      modelLabel: message.modelLabel,
      provider: message.provider,
      protocol: message.protocol,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
    }));
  }

  async updateSettings(conversationId: string, settings: UpdateChatSettingsDto) {
    await this.ensureConversation(conversationId);
    if (settings.modelId && !await this.models.findEnabled(settings.modelId)) {
      throw new BadRequestException('所选模型不存在或已停用');
    }
    const conversation = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: settings,
    });
    return this.serializeSettings(conversation);
  }

  private serializeSettings(conversation: {
    agentName: string;
    agentProfile: string;
    responseStyle: string;
    modelId: string;
    contextMessageLimit: number;
  }) {
    return {
      agentName: conversation.agentName,
      agentProfile: conversation.agentProfile,
      responseStyle: conversation.responseStyle,
      modelId: conversation.modelId,
      contextMessageLimit: conversation.contextMessageLimit,
      maxContextMessageLimit: HARD_MAX_CONTEXT_MESSAGE_LIMIT,
    };
  }

  private async ensureChatConversation<T extends { id: string; modelId: string }>(conversation: T) {
    if (await this.models.findEnabled(conversation.modelId)) return conversation;
    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { modelId: DEFAULT_CHAT_MODEL_ID },
    });
  }

  private attachmentsFromMetadata(metadata: Prisma.JsonValue | null) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
    const attachments = metadata.attachments;
    if (!Array.isArray(attachments)) return [];
    return attachments.filter((attachment): attachment is { url: string; mimeType: string } =>
      attachment !== null && typeof attachment === 'object' && !Array.isArray(attachment) &&
      isSupportedImageUrl(attachment.url, attachment.mimeType),
    );
  }
}
