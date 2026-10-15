import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type AgentRun, MessageRole, MessageStatus, Prisma } from '@prisma/client';

import { AgentRunner } from '../agent/agent-runner.service';
import { AgentToolService } from '../agent/agent-tool.service';
import { ImageToolAgent } from '../agent/image-tool-agent.service';
import { AiModelCatalogService } from '../ai/ai-model-catalog.service';
import { DEFAULT_CHAT_MODEL_ID, DEFAULT_IMAGE_MODEL_ID } from '../ai/model-catalog';
import { PrismaService } from '../database/prisma.service';
import { MemoryService } from '../memory/memory.service';
import { MediaAssetService } from '../media/media-asset.service';
import { OutboxService } from '../outbox/outbox.service';
import { OUTBOX_TOPIC_MEMORY_EXTRACT } from '../outbox/outbox.types';
import { SkillPolicyResolverService } from '../skills/skill-policy-resolver.service';
import type { CreateMessageDto } from './dto/create-message.dto';
import type { UpdateChatSettingsDto } from './dto/update-chat-settings.dto';
import type { ChatImageAttachment } from './chat.types';

export type ChatEvent = {
  type: 'message.created' | 'message.delta' | 'image.generated' | 'image.caption' | 'agent.run.proposed' | 'message.completed' | 'error';
  data: Record<string, unknown>;
};

const DEFAULT_CONTEXT_MESSAGE_LIMIT = 100;
const HARD_MAX_CONTEXT_MESSAGE_LIMIT = 1_000;
const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function isSupportedImageUrl(value: unknown, mimeType: unknown): value is string {
  return typeof value === 'string' &&
    SUPPORTED_IMAGE_MIME_TYPES.includes(String(mimeType)) &&
    (value.startsWith(`data:${mimeType};base64,`) || /^https?:\/\//i.test(value) || value.startsWith('/v1/media/'));
}

function getContextMessageLimit(value?: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_CONTEXT_MESSAGE_LIMIT;
  return Math.min(parsed, HARD_MAX_CONTEXT_MESSAGE_LIMIT);
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly contextMessageLimit: number;

  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly imageToolAgent: ImageToolAgent,
    private readonly models: AiModelCatalogService,
    private readonly prisma: PrismaService,
    private readonly memories: MemoryService,
    private readonly outbox: OutboxService,
    private readonly media: MediaAssetService,
    private readonly tools: AgentToolService,
    private readonly skillPolicies: SkillPolicyResolverService,
    config: ConfigService,
  ) {
    this.contextMessageLimit = getContextMessageLimit(config.get<string>('CHAT_CONTEXT_MESSAGE_LIMIT'));
  }

  async *stream(input: CreateMessageDto & { conversationId: string }, userId: string): AsyncGenerator<ChatEvent> {
    const images = input.attachments?.filter((attachment) =>
      isSupportedImageUrl(attachment.url, attachment.mimeType),
    ) ?? [];

    const conversation = await this.ensureConversationModels(
      await this.ensureConversation(input.conversationId, userId),
    );
    const internalConversationId = conversation.id;
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
    const skillPolicy = await this.skillPolicies.resolve(conversation.id);
    const memoryContext = await this.memories.buildAgentContext({
      userId: conversation.userId,
      conversationId: conversation.id,
      query: input.content,
      excludedCategories: skillPolicy.blockedMemoryCategories,
    });
    const skillMetadata = skillPolicy.plugins.map((plugin) => ({
      id: plugin.pluginId,
      version: plugin.version,
      versionId: plugin.pluginVersionId,
    }));
    const imageIntent = this.imageToolAgent.detect(input.content, images.length > 0);
    const history = await this.prisma.message.findMany({
      where: {
        conversationId: internalConversationId,
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
        conversationId: internalConversationId,
        role: MessageRole.USER,
        content: input.content,
        metadata: (input.attachments || skillMetadata.length)
          ? ({ ...(input.attachments ? { attachments: input.attachments } : {}), skillPlugins: skillMetadata } as unknown as Prisma.InputJsonValue)
          : undefined,
        ...modelData,
      },
    });
    await this.media.attachToMessage({
      userId: conversation.userId,
      conversationId: internalConversationId,
      messageId: userMessage.id,
      urls: images.map((image) => image.url),
    });
    const agentImages = await this.materializeAgentImages(images);
    const imageSource = imageIntent?.action === 'edit'
      ? agentImages[0] ?? await this.latestImageAttachment(internalConversationId)
      : undefined;
    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId: internalConversationId,
        role: MessageRole.ASSISTANT,
        status: MessageStatus.STREAMING,
        content: '',
        metadata: skillMetadata.length ? ({ skillPlugins: skillMetadata } as unknown as Prisma.InputJsonValue) : undefined,
        ...modelData,
      },
    });
    const messageId = assistantMessage.id;
    let taskToolResult: string | undefined;
    let taskToolRun: AgentRun | undefined;
    if (!imageIntent && this.tools.hasTaskManagementIntent(input.content)) {
      try {
        const tasks = await this.tools.listTasks(internalConversationId);
        const taskTool = await this.agentRunner.selectTaskTool({
          modelId: conversation.modelId,
          content: input.content,
          tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            dueAt: task.dueAt.toISOString(),
            status: task.status,
          })),
        });
        if (taskTool) {
          const prepared = await this.tools.prepareTaskTool({
            userId: conversation.userId,
            conversationId: internalConversationId,
            sourceMessageId: userMessage.id,
            tool: taskTool,
          });
          taskToolResult = prepared.taskToolResult;
          taskToolRun = 'run' in prepared ? prepared.run : undefined;
        }
      } catch (error) {
        this.logger.warn(`任务工具调用失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const reminderCandidate = imageIntent ? null : this.tools.getReminderCandidate(input.content);
    const reminderRequested = !imageIntent && this.tools.hasReminderIntent(input.content);
    const reminderRun = reminderCandidate
      ? await this.tools.proposeReminder({
        userId: conversation.userId,
        conversationId: conversation.id,
        sourceMessageId: userMessage.id,
        content: input.content,
        candidate: reminderCandidate,
        pluginVersionId: skillPolicy.toolOwners.get('task.create'),
      }).catch(() => null)
      : null;
    const proposedRun = taskToolRun ?? reminderRun;

    yield {
      type: 'message.created',
      data: { conversationId: input.conversationId, messageId, role: 'assistant', model: modelData },
    };

    if (imageIntent) {
      yield { type: 'message.delta', data: { messageId, delta: '正在生成图片…' } };
      try {
        const imageContext = conversation.imageUseContext
          ? {
            agentName: conversation.agentName,
            agentProfile: conversation.agentProfile,
            messages: history
              .filter((message) => message.content.trim())
              .map((message) => ({
                role: message.role === MessageRole.USER ? 'user' as const : 'assistant' as const,
                content: message.content,
              })),
          }
          : undefined;
        const result = await this.imageToolAgent.run(
          imageIntent,
          conversation.imageModelId,
          imageSource,
          imageContext,
        );
        const imageModel = await this.models.findEnabled(result.modelId, 'image-generation');
        if (!imageModel) throw new Error('所选生图模型不存在或已停用');
        const imageModelData = {
          modelId: imageModel.id,
          modelLabel: imageModel.label,
          provider: imageModel.provider,
          protocol: imageModel.protocol,
        };
        const attachments = await Promise.all(result.images.map((image) => this.media.createGeneratedImage({
          userId: conversation.userId,
          conversationId: internalConversationId,
          messageId,
          dataUrl: image.dataUrl,
          mimeType: image.mimeType,
        })));
        await this.prisma.message.update({
          where: { id: messageId },
          data: {
            status: MessageStatus.COMPLETED,
            content: '',
            metadata: { attachments, skillPlugins: skillMetadata } as Prisma.InputJsonValue,
            ...imageModelData,
          },
        });
        yield {
          type: 'image.generated',
          data: {
            messageId,
            images: this.serializeAttachments(internalConversationId, messageId, attachments),
            action: imageIntent.action,
            model: imageModelData,
          },
        };
        yield {
          type: 'message.completed',
          data: { messageId, content: '', model: imageModelData, usage: {} },
        };

        const caption = await this.generateImageCaption({
          conversationId: internalConversationId,
          request: input.content,
          history,
          conversation,
          modelData,
        });
        if (caption) {
          yield {
            type: 'image.caption',
            data: caption,
          };
        }
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
        conversationId: internalConversationId,
        agentName: conversation.agentName,
        agentProfile: conversation.agentProfile,
        responseStyle: conversation.responseStyle,
        modelId: conversation.modelId,
        memoryContext,
        skillInstructions: skillPolicy.instructions,
        reminder: proposedRun && reminderCandidate
          ? { title: reminderCandidate.title, dueAt: reminderCandidate.dueAt.toISOString(), timezone: 'Asia/Shanghai' }
          : undefined,
        reminderRequested,
        taskToolResult,
        messages: [
          ...history.map((message) => ({
            role: message.role === MessageRole.USER ? 'user' as const : 'assistant' as const,
            content: message.content,
          })),
          {
            role: 'user',
            content: input.content,
            images: agentImages,
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
      if (proposedRun) {
        yield { type: 'agent.run.proposed', data: { run: proposedRun } };
      }
      yield { type: 'error', data: { messageId, code: 'MODEL_STREAM_FAILED', message } };
      return;
    }

    const { memoryOutbox } = await this.prisma.$transaction(async (transaction) => {
      await transaction.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.COMPLETED, content, inputTokens, outputTokens },
      });
      await transaction.message.update({
        where: { id: userMessage.id },
        data: { inputTokens, outputTokens: 0 },
      });
      const memoryOutbox = await this.outbox.create(transaction, {
        topic: OUTBOX_TOPIC_MEMORY_EXTRACT,
        dedupKey: `memory-extract:${userMessage.id}`,
        payload: {
          userId: conversation.userId,
          conversationId: internalConversationId,
          sourceMessageId: userMessage.id,
          content: input.content,
        },
      });
      return { memoryOutbox };
    });
    try {
      await Promise.all([
        this.memories.markInteraction(conversation.userId, internalConversationId),
        this.outbox.publish(memoryOutbox.id),
      ]);
    } catch {
      // Outbox startup recovery handles an unavailable Redis broker.
    }
    if (proposedRun) {
      yield { type: 'agent.run.proposed', data: { run: proposedRun } };
    }
    yield {
      type: 'message.completed',
      data: { messageId, content, model: modelData, usage: { inputTokens, outputTokens } },
    };
  }

  private async ensureConversation(externalId: string, userId: string) {
    return this.prisma.conversation.upsert({
      where: { userId_externalId: { userId, externalId } },
      update: {},
      create: {
        userId,
        externalId,
        contextMessageLimit: this.contextMessageLimit,
        modelId: DEFAULT_CHAT_MODEL_ID,
        imageModelId: DEFAULT_IMAGE_MODEL_ID,
      },
    });
  }

  private async generateImageCaption(input: {
    conversationId: string;
    request: string;
    history: Array<{ role: MessageRole; content: string }>;
    conversation: {
      agentName: string;
      agentProfile: string;
      responseStyle: string;
      modelId: string;
    };
    modelData: { modelId: string; modelLabel: string; provider: string; protocol: string };
  }) {
    let content = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    try {
      for await (const event of this.agentRunner.stream({
        conversationId: input.conversationId,
        agentName: input.conversation.agentName,
        agentProfile: input.conversation.agentProfile,
        responseStyle: input.conversation.responseStyle,
        modelId: input.conversation.modelId,
        imageCaption: true,
        messages: [
          ...input.history
            .filter((message) => message.content.trim())
            .map((message) => ({
              role: message.role === MessageRole.USER ? 'user' as const : 'assistant' as const,
              content: message.content,
            })),
          {
            role: 'user',
            content: `用户刚刚请求生成图片：${input.request}`,
          },
        ],
      })) {
        if (event.type === 'delta') content += event.delta;
        else {
          inputTokens = event.usage.inputTokens ?? inputTokens;
          outputTokens = event.usage.outputTokens ?? outputTokens;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`图片配文生成失败：${message}`);
      return null;
    }

    const caption = content.replace(/\s+/gu, ' ').trim().slice(0, 80);
    if (!caption) return null;
    const message = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: MessageRole.ASSISTANT,
        status: MessageStatus.COMPLETED,
        content: caption,
        ...input.modelData,
        inputTokens,
        outputTokens,
      },
    });
    return {
      messageId: message.id,
      content: caption,
      model: input.modelData,
      usage: { inputTokens, outputTokens },
    };
  }

  async getSettings(conversationId: string, userId: string) {
    const conversation = await this.ensureConversationModels(await this.ensureConversation(conversationId, userId));
    return this.serializeSettings(conversation);
  }

  async getConversationIdentity(conversationId: string, userId: string) {
    const conversation = await this.ensureConversationModels(await this.ensureConversation(conversationId, userId));
    return { id: conversation.id, userId: conversation.userId };
  }

  async listMessages(conversationId: string, userId: string) {
    const conversation = await this.ensureConversation(conversationId, userId);
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
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
    return Promise.all(messages.map(async (message) => ({
      id: message.id,
      role: message.role === MessageRole.USER ? 'user' : 'assistant',
      content: message.content,
      attachments: this.serializeAttachments(
        conversation.id,
        message.id,
        await this.materializeInlineAttachments(conversation.userId, conversation.id, message.id, message.metadata),
      ),
      modelId: message.modelId,
      modelLabel: message.modelLabel,
      provider: message.provider,
      protocol: message.protocol,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
    })));
  }

  async updateSettings(conversationId: string, userId: string, settings: UpdateChatSettingsDto) {
    const conversation = await this.ensureConversation(conversationId, userId);
    if (settings.modelId && !await this.models.findEnabled(settings.modelId)) {
      throw new BadRequestException('所选模型不存在或已停用');
    }
    if (settings.imageModelId && !await this.models.findEnabled(settings.imageModelId, 'image-generation')) {
      throw new BadRequestException('所选图片创作模型不存在或已停用');
    }
    const updatedConversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: settings,
    });
    return this.serializeSettings(updatedConversation);
  }

  async getImageAttachment(conversationId: string, userId: string, messageId: string, attachmentIndex: number) {
    if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0) {
      throw new BadRequestException('图片附件序号无效');
    }

    const conversation = await this.ensureConversation(conversationId, userId);
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId: conversation.id,
        status: MessageStatus.COMPLETED,
      },
      select: { metadata: true },
    });
    if (!message) throw new NotFoundException('图片附件不存在');

    const attachment = this.attachmentsFromMetadata(message.metadata)[attachmentIndex];
    if (!attachment) throw new NotFoundException('图片附件不存在');
    if (/^https?:\/\//i.test(attachment.url) || this.media.isManagedUrl(attachment.url)) {
      return { redirectUrl: attachment.url } as const;
    }

    const base64 = attachment.url.slice(attachment.url.indexOf(',') + 1);
    const data = Buffer.from(base64, 'base64');
    if (!data.length) throw new NotFoundException('图片附件不存在');
    return { mimeType: attachment.mimeType, data } as const;
  }

  private serializeSettings(conversation: {
    agentName: string;
    agentProfile: string;
    responseStyle: string;
    modelId: string;
    imageModelId: string;
    imageUseContext: boolean;
    contextMessageLimit: number;
  }) {
    return {
      agentName: conversation.agentName,
      agentProfile: conversation.agentProfile,
      responseStyle: conversation.responseStyle,
      modelId: conversation.modelId,
      imageModelId: conversation.imageModelId,
      imageUseContext: conversation.imageUseContext,
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

  private async materializeInlineAttachments(
    userId: string,
    conversationId: string,
    messageId: string,
    metadata: Prisma.JsonValue | null,
  ) {
    const attachments = this.attachmentsFromMetadata(metadata);
    if (!attachments.some((attachment) => attachment.url.startsWith('data:'))) return attachments;

    const persisted = await Promise.all(attachments.map(async (attachment) => {
      if (!attachment.url.startsWith('data:')) return attachment;
      return this.media.createGeneratedImage({
        userId,
        conversationId,
        messageId,
        dataUrl: attachment.url,
        mimeType: attachment.mimeType,
      });
    }));
    const baseMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Prisma.JsonObject
      : {};
    await this.prisma.message.update({
      where: { id: messageId },
      data: { metadata: { ...baseMetadata, attachments: persisted } as Prisma.InputJsonValue },
    });
    return persisted;
  }

  private serializeAttachments(
    conversationId: string,
    messageId: string,
    attachments: Array<{ url: string; mimeType: string }>,
  ) {
    return attachments.map((attachment, index) => ({
      ...attachment,
      url: attachment.url.startsWith('data:')
        ? `/v1/chats/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/attachments/${index}`
        : attachment.url,
    }));
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
      if (!attachment) continue;
      if (this.media.isManagedUrl(attachment.url)) {
        return { ...attachment, url: await this.media.toDataUrl(attachment.url, attachment.mimeType) };
      }
      return attachment;
    }
    return undefined;
  }

  private async materializeAgentImages(images: ChatImageAttachment[]) {
    return Promise.all(images.map(async (image) => {
      if (!this.media.isManagedUrl(image.url)) return image;
      return { ...image, url: await this.media.toDataUrl(image.url, image.mimeType) };
    }));
  }
}
