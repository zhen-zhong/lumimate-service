import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Put, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { MediaStorageService } from './media-storage.service';
import { PrismaService } from '../database/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ConversationAccessService } from '../auth/conversation-access.service';
import { MediaAssetService } from './media-asset.service';
import { MediaUploadService } from './media-upload.service';

@ApiTags('媒体')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaStorageService, private readonly prisma: PrismaService) {}

  @Get(':category/:conversationId/:assetId/:filename')
  @ApiOperation({ summary: '读取会话媒体文件' })
  async open(
    @Param('category') category: string,
    @Param('conversationId') conversationId: string,
    @Param('assetId') assetId: string,
    @Param('filename') filename: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ) {
    const mediaUrl = this.media.urlFor(category, conversationId, assetId, filename);
    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: assetId,
        conversationId,
        userId: user.userId,
        url: mediaUrl,
      },
      select: { mimeType: true },
    });
    if (!asset || this.media.categoryForMimeType(asset.mimeType) !== category) {
      throw new NotFoundException('媒体文件不存在');
    }
    const media = await this.media.open(category, conversationId, assetId, filename);
    return reply
      .header('Cache-Control', 'private, max-age=86400')
      .type(media.mimeType)
      .send(media.stream);
  }

}

@ApiTags('媒体')
@Controller('chats')
export class MediaUploadController {
  constructor(
    private readonly conversations: ConversationAccessService,
    private readonly mediaAssets: MediaAssetService,
    private readonly uploads: MediaUploadService,
  ) {}

  @Post(':conversationId/media')
  @ApiOperation({ summary: '上传会话媒体文件（二进制请求体）' })
  @ApiConsumes('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  async upload(
    @Param('conversationId') conversationId: string,
    @Body() body: Buffer,
    @Headers('content-type') contentType: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!Buffer.isBuffer(body)) throw new BadRequestException('媒体请求体无效');
    const mimeType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
    if (!mimeType) throw new BadRequestException('缺少媒体 Content-Type');
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.mediaAssets.createUpload({
      userId: user.userId,
      conversationId: conversation.id,
      data: body,
      mimeType,
    });
  }

  @Post(':conversationId/video-uploads')
  @ApiOperation({ summary: '创建大视频分片上传' })
  async createVideoUpload(
    @Param('conversationId') conversationId: string,
    @Body() body: { mimeType?: unknown; sizeBytes?: unknown },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (typeof body.mimeType !== 'string' || !Number.isSafeInteger(body.sizeBytes)) {
      throw new BadRequestException('视频上传参数无效');
    }
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.uploads.createVideoUpload({
      userId: user.userId,
      conversationId: conversation.id,
      mimeType: body.mimeType.toLowerCase(),
      sizeBytes: body.sizeBytes as number,
    });
  }

  @Put(':conversationId/video-uploads/:uploadId/chunks/:chunkIndex')
  @ApiOperation({ summary: '上传视频分片（二进制请求体）' })
  @ApiConsumes('video/mp4', 'video/webm', 'video/quicktime')
  async uploadVideoChunk(
    @Param('conversationId') conversationId: string,
    @Param('uploadId') uploadId: string,
    @Param('chunkIndex') chunkIndex: string,
    @Body() body: Buffer,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!Buffer.isBuffer(body)) throw new BadRequestException('视频分片请求体无效');
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.uploads.uploadChunk({
      userId: user.userId,
      conversationId: conversation.id,
      uploadId,
      index: Number(chunkIndex),
      data: body,
    });
  }

  @Post(':conversationId/video-uploads/:uploadId/complete')
  @ApiOperation({ summary: '合并视频分片并进入异步处理' })
  async completeVideoUpload(
    @Param('conversationId') conversationId: string,
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const conversation = await this.conversations.require(user.userId, conversationId);
    return this.uploads.completeVideoUpload({
      userId: user.userId,
      conversationId: conversation.id,
      uploadId,
    });
  }
}
