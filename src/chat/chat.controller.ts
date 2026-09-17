import { Body, Controller, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ChatService } from './chat.service';
import { CreateMessageDto } from './create-message.dto';
import { UpdateChatSettingsDto } from './update-chat-settings.dto';

@Controller('/chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post(':conversationId/messages')
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

  @Get(':conversationId/settings')
  getSettings(@Param('conversationId') conversationId: string) {
    return this.chatService.getSettings(conversationId);
  }

  @Put(':conversationId/settings')
  updateSettings(
    @Param('conversationId') conversationId: string,
    @Body() body: UpdateChatSettingsDto,
  ) {
    return this.chatService.updateSettings(conversationId, body);
  }
}
