import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { MediaCategory, MediaProcessingStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import { PrismaService } from '../database/prisma.service';
import { MediaStorageService, type MediaPathCategory } from './media-storage.service';
import { MEDIA_PROCESSING_QUEUE, type ProcessVideoJob } from './media.types';

const MAX_UPLOAD_BYTES: Record<MediaPathCategory, number> = {
  images: 12 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  // 大视频将在分片上传完成后合并；单次直传保持与 HTTP body 上限一致。
  videos: 16 * 1024 * 1024,
};

function databaseCategory(category: MediaPathCategory) {
  return category === 'images' ? MediaCategory.IMAGE : category === 'videos' ? MediaCategory.VIDEO : MediaCategory.AUDIO;
}

@Injectable()
export class MediaAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
    @InjectQueue(MEDIA_PROCESSING_QUEUE) private readonly queue: Queue<ProcessVideoJob>,
  ) {}

  async createUpload(input: {
    userId: string;
    conversationId: string;
    data: Buffer;
    mimeType: string;
  }) {
    const category = this.storage.categoryForMimeType(input.mimeType);
    if (!category) throw new BadRequestException('媒体格式不受支持');
    if (input.data.length > MAX_UPLOAD_BYTES[category]) {
      throw new PayloadTooLargeException('媒体文件超过大小限制');
    }
    return this.create({ ...input, category });
  }

  async createGeneratedImage(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    dataUrl: string;
    mimeType: string;
  }) {
    const prefix = `data:${input.mimeType};base64,`;
    if (!input.dataUrl.startsWith(prefix)) throw new ServiceUnavailableException('图片生成结果格式无效');
    const data = Buffer.from(input.dataUrl.slice(prefix.length), 'base64');
    if (!data.length) throw new ServiceUnavailableException('图片生成结果为空');
    return this.create({ ...input, category: 'images', data });
  }

  async attachToMessage(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    urls: string[];
  }) {
    if (!input.urls.length) return;
    await this.prisma.mediaAsset.updateMany({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: null,
        url: { in: input.urls },
      },
      data: { messageId: input.messageId },
    });
  }

  async createChunkedVideo(input: {
    userId: string;
    conversationId: string;
    uploadId: string;
    chunkCount: number;
    mimeType: string;
  }) {
    if (this.storage.categoryForMimeType(input.mimeType) !== 'videos') {
      throw new BadRequestException('视频格式不受支持');
    }
    const id = randomUUID();
    const stored = await this.storage.storeChunkedVideo({
      conversationId: input.conversationId,
      uploadId: input.uploadId,
      assetId: id,
      chunkCount: input.chunkCount,
      mimeType: input.mimeType,
    });
    return this.persistOrRemove({ ...input, id, category: 'videos', stored });
  }

  isManagedUrl(url: string) {
    return this.storage.isManagedUrl(url);
  }

  toDataUrl(url: string, mimeType: string) {
    return this.storage.toDataUrl(url, mimeType);
  }

  async processVideo(mediaAssetId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, category: MediaCategory.VIDEO },
      select: { id: true, userId: true, conversationId: true, url: true },
    });
    if (!asset) return;

    try {
      await this.storage.withLocalFileForUrl(asset.url, async (sourcePath) => {
        const metadata = await this.probeVideo(sourcePath);
        const thumbnailData = await this.extractVideoThumbnail(sourcePath);
        const thumbnail = thumbnailData.length
          ? await this.create({
            userId: asset.userId,
            conversationId: asset.conversationId,
            category: 'images',
            data: thumbnailData,
            mimeType: 'image/jpeg',
          })
          : null;
        await this.prisma.mediaAsset.update({
          where: { id: asset.id },
          data: {
            processingStatus: MediaProcessingStatus.READY,
            durationMs: metadata.durationMs,
            width: metadata.width,
            height: metadata.height,
            thumbnailUrl: thumbnail?.url,
            processingError: null,
          },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频处理失败';
      await this.prisma.mediaAsset.update({
        where: { id: mediaAssetId },
        data: { processingStatus: MediaProcessingStatus.FAILED, processingError: message.slice(0, 500) },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async create(input: {
    userId: string;
    conversationId: string;
    messageId?: string;
    category: MediaPathCategory;
    data: Buffer;
    mimeType: string;
  }) {
    const id = randomUUID();
    const stored = await this.storage.store({
      category: input.category,
      conversationId: input.conversationId,
      assetId: id,
      data: input.data,
      mimeType: input.mimeType,
    });
    return this.persistOrRemove({ ...input, id, stored });
  }

  private async persistOrRemove(input: {
    id: string;
    userId: string;
    conversationId: string;
    messageId?: string;
    category: MediaPathCategory;
    stored: { url: string; mimeType: string; sizeBytes: number };
  }) {
    try {
      return await this.persist(input);
    } catch (error) {
      await this.storage.remove(input.stored.url).catch(() => undefined);
      throw error;
    }
  }

  private async persist(input: {
    id: string;
    userId: string;
    conversationId: string;
    messageId?: string;
    category: MediaPathCategory;
    stored: { url: string; mimeType: string; sizeBytes: number };
  }) {
    const asset = await this.prisma.mediaAsset.create({
      data: {
        id: input.id,
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        category: databaseCategory(input.category),
        url: input.stored.url,
        mimeType: input.stored.mimeType,
        sizeBytes: input.stored.sizeBytes,
        processingStatus: input.category === 'videos' ? MediaProcessingStatus.PROCESSING : MediaProcessingStatus.READY,
      },
      select: { id: true, url: true, mimeType: true, sizeBytes: true, processingStatus: true, createdAt: true },
    });
    if (input.category === 'videos') {
      await this.queue.add('process-video', { mediaAssetId: asset.id }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    }
    return asset;
  }

  private async probeVideo(sourcePath: string) {
    const { stdout } = await this.runProcess('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      sourcePath,
    ]);
    const parsed: unknown = JSON.parse(stdout.toString('utf8'));
    const data = parsed && typeof parsed === 'object' ? parsed as { format?: { duration?: string }; streams?: Array<{ width?: number; height?: number }> } : {};
    const stream = data.streams?.[0];
    const duration = Number(data.format?.duration);
    const width = stream?.width;
    const height = stream?.height;
    return {
      durationMs: Number.isFinite(duration) && duration >= 0 ? Math.round(duration * 1_000) : null,
      width: Number.isSafeInteger(width) ? width : null,
      height: Number.isSafeInteger(height) ? height : null,
    };
  }

  private extractVideoThumbnail(sourcePath: string) {
    return this.runProcess('ffmpeg', [
      '-v', 'error', '-ss', '00:00:01', '-i', sourcePath,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
    ], 10 * 1024 * 1024).then(({ stdout }) => stdout);
  }

  private runProcess(command: string, args: string[], maxOutputBytes = 1024 * 1024) {
    return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= maxOutputBytes) chunks.push(chunk);
        else child.kill('SIGKILL');
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.once('error', reject);
      child.once('close', (code) => {
        if (size > maxOutputBytes) return reject(new Error(`${command} 输出超过限制`));
        if (code !== 0) return reject(new Error(`${command} 处理失败：${stderr.slice(0, 500)}`));
        resolve({ stdout: Buffer.concat(chunks), stderr });
      });
    });
  }
}
