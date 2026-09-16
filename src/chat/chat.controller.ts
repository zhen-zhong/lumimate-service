import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ChatService } from './chat.service';
import { CreateMessageDto } from './create-message.dto';

@Controller('/chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post(':conversationId/messages')
  async createMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: CreateMessageDto,
    @Res() reply: FastifyReply,
  ) {
    reply.raw.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of this.chatService.stream({ conversationId, ...body })) {
        reply.raw.write(`event: ${event.type}\\ndata: ${JSON.stringify(event.data)}\\n\\n`);
      }
    } finally {
      reply.raw.end();
    }
  }
}
