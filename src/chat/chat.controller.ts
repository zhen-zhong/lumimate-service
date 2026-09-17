import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateChatSettingsDto } from './dto/update-chat-settings.dto';

const settingsResponse = {
  description: '会话助手设置',
  schema: {
    type: 'object',
    properties: {
      agentName: { type: 'string', example: 'LumiMate' },
      agentProfile: { type: 'string' },
      responseStyle: { type: 'string', example: '温和、简洁' },
      contextMessageLimit: { type: 'integer', example: 100 },
      maxContextMessageLimit: { type: 'integer', example: 1000 },
    },
  },
} as const;

@ApiTags('聊天')
@ApiParam({ name: 'conversationId', description: '会话 ID' })
@Controller('/chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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

    try {
      for await (const event of this.chatService.stream({ conversationId, ...body })) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } finally {
      reply.raw.end();
    }
  }

  @Get(':conversationId/messages')
  @ApiOperation({ summary: '获取会话历史消息' })
  listMessages(@Param('conversationId') conversationId: string) {
    return this.chatService.listMessages(conversationId);
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
}
