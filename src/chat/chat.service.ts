import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageRole, MessageStatus, Prisma } from '@prisma/client';

import { AgentRunner } from '../agent/agent-runner.service';
import { PrismaService } from '../database/prisma.service';
import type { CreateMessageDto } from './create-message.dto';
import type { UpdateChatSettingsDto } from './update-chat-settings.dto';

export type ChatEvent = {
  type: 'message.created' | 'message.delta' | 'message.completed' | 'error';
  data: Record<string, unknown>;
};

const LOCAL_USER_ID = 'local-user';
const DEFAULT_CONTEXT_MESSAGE_LIMIT = 100;
const HARD_MAX_CONTEXT_MESSAGE_LIMIT = 1_000;

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
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.contextMessageLimit = getContextMessageLimit(config.get<string>('CHAT_CONTEXT_MESSAGE_LIMIT'));
  }

  async *stream(input: CreateMessageDto & { conversationId: string }): AsyncGenerator<ChatEvent> {
    const conversation = await this.ensureConversation(input.conversationId);
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

    await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: MessageRole.USER,
        content: input.content,
        metadata: input.attachments
          ? ({ attachments: input.attachments } as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: MessageRole.ASSISTANT,
        status: MessageStatus.STREAMING,
        content: '',
      },
    });
    const messageId = assistantMessage.id;

    yield {
      type: 'message.created',
      data: { conversationId: input.conversationId, messageId, role: 'assistant' },
    };

    let content = '';
    try {
      for await (const delta of this.agentRunner.stream({
        conversationId: input.conversationId,
        agentName: conversation.agentName,
        agentProfile: conversation.agentProfile,
        responseStyle: conversation.responseStyle,
        messages: [
          ...history.map((message) => ({
            role: message.role === MessageRole.USER ? 'user' as const : 'assistant' as const,
            content: message.content,
          })),
          { role: 'user', content: input.content },
        ],
      })) {
        content += delta;
        yield { type: 'message.delta', data: { messageId, delta } };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型服务暂时不可用';
      await this.prisma.message.update({
        where: { id: messageId },
        data: { status: MessageStatus.FAILED, content: message },
      });
      yield { type: 'error', data: { messageId, code: 'MODEL_STREAM_FAILED', message } };
      return;
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.COMPLETED, content },
    });
    yield { type: 'message.completed', data: { messageId, content } };
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
      },
    });
  }

  async getSettings(conversationId: string) {
    const conversation = await this.ensureConversation(conversationId);
    return this.serializeSettings(conversation);
  }

  async updateSettings(conversationId: string, settings: UpdateChatSettingsDto) {
    await this.ensureConversation(conversationId);
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
    contextMessageLimit: number;
  }) {
    return {
      agentName: conversation.agentName,
      agentProfile: conversation.agentProfile,
      responseStyle: conversation.responseStyle,
      contextMessageLimit: conversation.contextMessageLimit,
      maxContextMessageLimit: HARD_MAX_CONTEXT_MESSAGE_LIMIT,
    };
  }
}
