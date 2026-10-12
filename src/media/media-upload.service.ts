import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../database/prisma.service';
import { MediaAssetService } from './media-asset.service';
import { MediaStorageService } from './media-storage.service';

const CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_CHUNKED_VIDEO_BYTES = 512 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class MediaUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
    private readonly mediaAssets: MediaAssetService,
  ) {}

  async createVideoUpload(input: { userId: string; conversationId: string; mimeType: string; sizeBytes: number }) {
    if (this.storage.categoryForMimeType(input.mimeType) !== 'videos') {
      throw new BadRequestException('视频格式不受支持');
    }
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new BadRequestException('视频大小无效');
    }
    if (input.sizeBytes > MAX_CHUNKED_VIDEO_BYTES) {
      throw new PayloadTooLargeException('视频超过 512 MiB 上传限制');
    }
    const chunkCount = Math.ceil(input.sizeBytes / CHUNK_SIZE_BYTES);
    const upload = await this.prisma.mediaUpload.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        conversationId: input.conversationId,
        mimeType: input.mimeType,
        totalBytes: input.sizeBytes,
        chunkSize: CHUNK_SIZE_BYTES,
        chunkCount,
        expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
      },
    });
    return {
      uploadId: upload.id,
      chunkSize: upload.chunkSize,
      chunkCount: upload.chunkCount,
      expiresAt: upload.expiresAt,
    };
  }

  async uploadChunk(input: {
    userId: string;
    conversationId: string;
    uploadId: string;
    index: number;
    data: Buffer;
  }) {
    const upload = await this.requireActive(input);
    if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= upload.chunkCount) {
      throw new BadRequestException('分片序号无效');
    }
    const expectedBytes = input.index === upload.chunkCount - 1
      ? upload.totalBytes - input.index * upload.chunkSize
      : upload.chunkSize;
    if (input.data.length !== expectedBytes) throw new BadRequestException('分片大小不匹配');

    const existing = await this.prisma.mediaUploadChunk.findUnique({
      where: { uploadId_index: { uploadId: upload.id, index: input.index } },
      select: { sizeBytes: true },
    });
    if (existing) {
      if (existing.sizeBytes !== input.data.length) throw new ConflictException('该分片已存在且大小不一致');
      return { receivedBytes: upload.receivedBytes, totalBytes: upload.totalBytes, completed: false };
    }

    await this.storage.writeUploadChunk({
      conversationId: input.conversationId,
      uploadId: upload.id,
      index: input.index,
      data: input.data,
    });
    try {
      const updated = await this.prisma.$transaction(async (transaction) => {
        await transaction.mediaUploadChunk.create({
          data: { uploadId: upload.id, index: input.index, sizeBytes: input.data.length },
        });
        return transaction.mediaUpload.update({
          where: { id: upload.id },
          data: { receivedBytes: { increment: input.data.length } },
          select: { receivedBytes: true, totalBytes: true },
        });
      });
      return { ...updated, completed: updated.receivedBytes === updated.totalBytes };
    } catch (error) {
      await this.storage.removeUploadChunk(input.conversationId, upload.id, input.index);
      throw error;
    }
  }

  async completeVideoUpload(input: { userId: string; conversationId: string; uploadId: string }) {
    const upload = await this.requireActive(input);
    const chunks = await this.prisma.mediaUploadChunk.aggregate({
      where: { uploadId: upload.id },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
    if (chunks._count._all !== upload.chunkCount || chunks._sum.sizeBytes !== upload.totalBytes) {
      throw new ConflictException('视频分片尚未上传完成');
    }
    await this.prisma.mediaUpload.update({
      where: { id: upload.id },
      data: { status: 'COMPLETING' },
    });
    try {
      const asset = await this.mediaAssets.createChunkedVideo({
        userId: input.userId,
        conversationId: input.conversationId,
        uploadId: upload.id,
        chunkCount: upload.chunkCount,
        mimeType: upload.mimeType,
      });
      await this.prisma.mediaUpload.update({
        where: { id: upload.id },
        data: { status: 'COMPLETED' },
      });
      return asset;
    } catch (error) {
      await this.prisma.mediaUpload.update({
        where: { id: upload.id },
        data: { status: 'FAILED' },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async requireActive(input: { userId: string; conversationId: string; uploadId: string }) {
    const upload = await this.prisma.mediaUpload.findFirst({
      where: { id: input.uploadId, userId: input.userId, conversationId: input.conversationId },
    });
    if (!upload) throw new NotFoundException('视频上传不存在');
    if (upload.status !== 'UPLOADING' || upload.expiresAt <= new Date()) {
      throw new ConflictException('视频上传已失效，请重新上传');
    }
    return upload;
  }
}
