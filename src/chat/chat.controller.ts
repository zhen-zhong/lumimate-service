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
      contextMessageLimit: { type: 'integer', example: 100 },
      maxContextMessageLimit: { type: 'integer', example: 1000 },
    },
  },
} as const;

@ApiTags('聊天')
@ApiParam({ name: 'conversationId', description: '会话 ID' })
@Controller('/chats')
export class ChatController {
  constructor(private readonly chatService: ChatService, private readonly memories: MemoryService) {}

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
      for await (const event of this.chatService.stream({ conversationId, ...body })) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
  }

  @Get(':conversationId/messages')
  @ApiOperation({ summary: '获取会话历史消息' })
  listMessages(@Param('conversationId') conversationId: string) {
    return this.chatService.listMessages(conversationId);
  }

  @Get(':conversationId/messages/:messageId/attachments/:attachmentIndex')
  @ApiOperation({ summary: '读取聊天图片附件' })
  async getImageAttachment(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Param('attachmentIndex') attachmentIndex: string,
    @Res() reply: FastifyReply,
  ) {
    const attachment = await this.chatService.getImageAttachment(
      conversationId,
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
  getSettings(@Param('conversationId') conversationId: string) {
    return this.chatService.getSettings(conversationId);
  }

  @Put(':conversationId/settings')
  @ApiOperation({ summary: '更新会话助手设置' })
  @ApiOkResponse(settingsResponse)
  updateSettings(
    @Param('conversationId') conversationId: string,
    @Body() body: UpdateChatSettingsDto,
  ) {
    return this.chatService.updateSettings(conversationId, body);
  }

  @Get(':conversationId/memories')
  @ApiOperation({ summary: '获取会话记忆；候选记忆需确认后才会进入 AI 上下文' })
  async listMemories(@Param('conversationId') conversationId: string) {
    await this.chatService.getConversationIdentity(conversationId);
    return this.memories.list(conversationId);
  }

  @Post(':conversationId/memories/:memoryId/confirm')
  @ApiOperation({ summary: '确认候选记忆' })
  confirmMemory(@Param('conversationId') conversationId: string, @Param('memoryId') memoryId: string) {
    return this.memories.confirm(conversationId, memoryId);
  }

  @Put(':conversationId/memories/:memoryId')
  @ApiOperation({ summary: '编辑并确认记忆' })
  updateMemory(
    @Param('conversationId') conversationId: string,
    @Param('memoryId') memoryId: string,
    @Body() body: UpdateMemoryDto,
  ) {
    return this.memories.update(conversationId, memoryId, body);
  }

  @Delete(':conversationId/memories/:memoryId')
  @ApiOperation({ summary: '删除记忆及其后续召回资格' })
  removeMemory(@Param('conversationId') conversationId: string, @Param('memoryId') memoryId: string) {
    return this.memories.remove(conversationId, memoryId);
  }

  @Get(':conversationId/relationship')
  @ApiOperation({ summary: '获取会话关系资料' })
  async getRelationship(@Param('conversationId') conversationId: string) {
    const conversation = await this.chatService.getConversationIdentity(conversationId);
    return this.memories.getRelationship(conversation.userId, conversation.id);
  }

  @Put(':conversationId/relationship')
  @ApiOperation({ summary: '更新会话关系资料' })
  async updateRelationship(@Param('conversationId') conversationId: string, @Body() body: UpdateRelationshipDto) {
    const conversation = await this.chatService.getConversationIdentity(conversationId);
    return this.memories.updateRelationship(conversation.userId, conversation.id, body);
  }

  @Get(':conversationId/proactive-policy')
  @ApiOperation({ summary: '获取主动陪伴策略' })
  async getProactivePolicy(@Param('conversationId') conversationId: string) {
    const conversation = await this.chatService.getConversationIdentity(conversationId);
    return this.memories.getProactivePolicy(conversation.userId);
  }

  @Put(':conversationId/proactive-policy')
  @ApiOperation({ summary: '更新主动陪伴策略' })
  async updateProactivePolicy(@Param('conversationId') conversationId: string, @Body() body: UpdateProactivePolicyDto) {
    const conversation = await this.chatService.getConversationIdentity(conversationId);
    return this.memories.updateProactivePolicy(conversation.userId, body);
  }
}
