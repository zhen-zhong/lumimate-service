import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateChatSettingsDto } from './dto/update-chat-settings.dto';
import { MemoryService } from '../memory/memory.service';
import { UpdateMemoryDto } from '../memory/dto/update-memory.dto';
import { UpdateProactivePolicyDto } from '../memory/dto/update-proactive-policy.dto';
import { UpdateRelationshipDto } from '../memory/dto/update-relationship.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CompanionTimelineService } from '../companion/companion-timeline.service';
import { PushService } from '../push/push.service';

const settingsResponse = {
  description: '会话助手设置',
  schema: {
    type: 'object',
    properties: {
      agentName: { type: 'string', example: 'LumiMate' },
      agentProfile: { type: 'string' },
      responseStyle: { type: 'string', example: '温和、简洁' },
      modelId: { type: 'string', example: 'deepseek-flash' },
      imageModelId: { type: 'string', example: 'gpt-image-2.5-flare' },
      imageUseContext: { type: 'boolean', example: true },
      contextMessageLimit: { type: 'integer', example: 100 },
      maxContextMessageLimit: { type: 'integer', example: 1000 },
    },
  },
} as const;

@ApiTags('聊天')
@ApiParam({ name: 'conversationId', description: '会话 ID' })
@Controller('/chats')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly memories: MemoryService,
    private readonly timeline: CompanionTimelineService,
    private readonly push: PushService,
  ) {}

  @Post(':conversationId/messages')
  @ApiOperation({ summary: '发送消息并接收 SSE 回复' })
  @ApiOkResponse({
    description: 'SSE 事件：message.created、message.delta、message.completed 或 error。流式接口请使用支持 SSE 的客户端读取。',
    content: {
      'text/event-stream': {
        schema: { type: 'string', example: 'event: message.delta\ndata: {"messageId":"id","delta":"你好"}\n\n' },
      },
    },
  })
  async createMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: CreateMessageDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ) {
    reply
      .code(200)
      .headers({
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      })
      .hijack();
    reply.raw.writeHead(200, reply.getHeaders() as never);
    // 原生客户端在生图等长耗时 Tool 期间需要持续收到数据，否则底层 fetch 会超时。
    const heartbeat = setInterval(() => {
      reply.raw.write(': keep-alive\n\n');
    }, 10_000);

    try {
      for await (const event of this.chatService.stream({ conversationId, ...body }, user.userId)) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
  }

  @Get(':conversationId/messages')
  @ApiOperation({ summary: '获取会话历史消息' })
  listMessages(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.chatService.listMessages(conversationId, user.userId);
  }

  @Get(':conversationId/messages/:messageId/attachments/:attachmentIndex')
  @ApiOperation({ summary: '读取聊天图片附件' })
  async getImageAttachment(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Param('attachmentIndex') attachmentIndex: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ) {
    const attachment = await this.chatService.getImageAttachment(
      conversationId,
      user.userId,
      messageId,
      Number(attachmentIndex),
    );
    if ('redirectUrl' in attachment && typeof attachment.redirectUrl === 'string') {
      return reply.redirect(attachment.redirectUrl);
    }

    return reply
      .header('Cache-Control', 'private, max-age=86400')
      .type(attachment.mimeType)
      .send(attachment.data);
  }

  @Get(':conversationId/settings')
  @ApiOperation({ summary: '获取会话助手设置' })
  @ApiOkResponse(settingsResponse)
  getSettings(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.chatService.getSettings(conversationId, user.userId);
  }

  @Put(':conversationId/settings')
  @ApiOperation({ summary: '更新会话助手设置' })
  @ApiOkResponse(settingsResponse)
  updateSettings(
    @Param('conversationId') conversationId: string,
    @Body() body: UpdateChatSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatService.updateSettings(conversationId, user.userId, body);
  }

  @Get(':conversationId/memories')
  @ApiOperation({ summary: '获取会话记忆；候选记忆需确认后才会进入 AI 上下文' })
  async listMemories(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.memories.list(conversation.id);
  }

  @Post(':conversationId/memories/:memoryId/confirm')
  @ApiOperation({ summary: '确认候选记忆' })
  async confirmMemory(@Param('conversationId') conversationId: string, @Param('memoryId') memoryId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.memories.confirm(conversation.id, memoryId);
  }

  @Put(':conversationId/memories/:memoryId')
  @ApiOperation({ summary: '编辑并确认记忆' })
  async updateMemory(
    @Param('conversationId') conversationId: string,
    @Param('memoryId') memoryId: string,
    @Body() body: UpdateMemoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.memories.update(conversation.id, memoryId, body);
  }

  @Delete(':conversationId/memories/:memoryId')
  @ApiOperation({ summary: '删除记忆及其后续召回资格' })
  async removeMemory(@Param('conversationId') conversationId: string, @Param('memoryId') memoryId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.memories.remove(conversation.id, memoryId);
  }

  @Get(':conversationId/relationship')
  @ApiOperation({ summary: '获取会话关系资料' })
  async getRelationship(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.memories.getRelationship(conversation.userId, conversation.id);
  }

  @Put(':conversationId/relationship')
  @ApiOperation({ summary: '更新会话关系资料' })
  async updateRelationship(@Param('conversationId') conversationId: string, @Body() body: UpdateRelationshipDto, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.memories.updateRelationship(conversation.userId, conversation.id, body);
  }

  @Get(':conversationId/proactive-policy')
  @ApiOperation({ summary: '获取主动陪伴策略' })
  async getProactivePolicy(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.memories.getProactivePolicy(conversation.userId);
  }

  @Get(':conversationId/commitments')
  @ApiOperation({ summary: '获取会话承诺状态时间线' })
  async listCommitments(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.timeline.list(user.userId, conversation.id);
  }

  @Post(':conversationId/push-deliveries/:deliveryId/retry')
  @ApiOperation({ summary: '重试失败的推送' })
  async retryPushDelivery(
    @Param('conversationId') conversationId: string,
    @Param('deliveryId') deliveryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.push.retryDelivery(user.userId, conversation.id, deliveryId);
  }

  @Put(':conversationId/proactive-policy')
  @ApiOperation({ summary: '更新主动陪伴策略' })
  async updateProactivePolicy(@Param('conversationId') conversationId: string, @Body() body: UpdateProactivePolicyDto, @CurrentUser() user: AuthenticatedUser) {
    const conversation = await this.chatService.getConversationIdentity(conversationId, user.userId);
    return this.memories.updateProactivePolicy(conversation.userId, body);
  }
}
