import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { MediaStorageService } from './media-storage.service';

@ApiTags('媒体')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaStorageService) {}

  @Get(':category/:conversationId/:messageId/:filename')
  @ApiOperation({ summary: '读取会话媒体文件' })
  async open(
    @Param('category') category: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Param('filename') filename: string,
    @Res() reply: FastifyReply,
  ) {
    const media = await this.media.open(category, conversationId, messageId, filename);
    return reply
      .header('Cache-Control', 'private, max-age=86400')
      .type(media.mimeType)
      .send(media.stream);
  }
}
