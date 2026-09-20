import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageRole, MessageStatus, Prisma } from '@prisma/client';

import { AgentRunner } from '../agent/agent-runner.service';
import { ImageToolAgent } from '../agent/image-tool-agent.service';
import { AiModelCatalogService } from '../ai/ai-model-catalog.service';
import { DEFAULT_CHAT_MODEL_ID, DEFAULT_IMAGE_MODEL_ID } from '../ai/model-catalog';
import { PrismaService } from '../database/prisma.service';
import type { CreateMessageDto } from './dto/create-message.dto';
import type { UpdateChatSettingsDto } from './dto/update-chat-settings.dto';
import type { ChatImageAttachment } from './chat.types';

export type ChatEvent = {
  type: 'message.created' | 'message.delta' | 'image.generated' | 'message.completed' | 'error';
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
    private readonly imageToolAgent: ImageToolAgent,
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

    const conversation = await this.ensureConversationModels(
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
    const imageIntent = this.imageToolAgent.detect(input.content, images.length > 0);
    const imageSource = imageIntent?.action === 'edit'
      ? images[0] ?? await this.latestImageAttachment(input.conversationId)
      : undefined;
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

    if (imageIntent) {
      yield { type: 'message.delta', data: { messageId, delta: '正在生成图片…' } };
      try {
        const result = await this.imageToolAgent.run(imageIntent, conversation.imageModelId, imageSource, {
          agentName: conversation.agentName,
          agentProfile: conversation.agentProfile,
          messages: history
            .filter((message) => message.content.trim())
            .map((message) => ({
              role: message.role === MessageRole.USER ? 'user' as const : 'assistant' as const,
              content: message.content,
            })),
        });
        const imageModel = await this.models.findEnabled(result.modelId, 'image-generation');
        if (!imageModel) throw new Error('所选生图模型不存在或已停用');
        const imageModelData = {
          modelId: imageModel.id,
          modelLabel: imageModel.label,
          provider: imageModel.provider,
          protocol: imageModel.protocol,
        };
        const attachments = result.images.map((image) => ({ url: image.dataUrl, mimeType: image.mimeType }));
        const content = imageIntent.action === 'edit' ? '已完成图片编辑。' : '已为你生成图片。';
        await this.prisma.message.update({
          where: { id: messageId },
          data: {
            status: MessageStatus.COMPLETED,
            content,
            metadata: { attachments } as Prisma.InputJsonValue,
            ...imageModelData,
          },
        });
        yield {
          type: 'image.generated',
          data: { messageId, images: attachments, action: imageIntent.action, model: imageModelData },
        };
        yield {
          type: 'message.completed',
          data: { messageId, content, model: imageModelData, usage: {} },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : '图片工具暂时不可用';
        await this.prisma.message.update({
          where: { id: messageId },
          data: { status: MessageStatus.FAILED, content: message },
        });
        yield { type: 'error', data: { messageId, code: 'IMAGE_TOOL_FAILED', message } };
      }
      return;
    }

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
        imageModelId: DEFAULT_IMAGE_MODEL_ID,
      },
    });
  }

  async getSettings(conversationId: string) {
    const conversation = await this.ensureConversationModels(await this.ensureConversation(conversationId));
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
    if (settings.imageModelId && !await this.models.findEnabled(settings.imageModelId, 'image-generation')) {
      throw new BadRequestException('所选图片创作模型不存在或已停用');
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
    imageModelId: string;
    contextMessageLimit: number;
  }) {
    return {
      agentName: conversation.agentName,
      agentProfile: conversation.agentProfile,
      responseStyle: conversation.responseStyle,
      modelId: conversation.modelId,
      imageModelId: conversation.imageModelId,
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

  private async ensureConversationModels<T extends { id: string; modelId: string; imageModelId: string }>(conversation: T) {
    const withChatModel = await this.ensureChatConversation(conversation);
    if (await this.models.findEnabled(withChatModel.imageModelId, 'image-generation')) return withChatModel;
    return this.prisma.conversation.update({
      where: { id: withChatModel.id },
      data: { imageModelId: DEFAULT_IMAGE_MODEL_ID },
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

  private async latestImageAttachment(conversationId: string): Promise<ChatImageAttachment | undefined> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId, status: MessageStatus.COMPLETED },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: { metadata: true },
    });
    for (const message of messages) {
      const attachment = this.attachmentsFromMetadata(message.metadata)[0];
      if (attachment) return attachment;
    }
    return undefined;
  }
}
