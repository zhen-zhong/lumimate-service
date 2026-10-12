import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const MEDIA_TYPES = {
  'image/jpeg': { category: 'images', extension: 'jpg' },
  'image/png': { category: 'images', extension: 'png' },
  'image/gif': { category: 'images', extension: 'gif' },
  'image/webp': { category: 'images', extension: 'webp' },
  'video/mp4': { category: 'videos', extension: 'mp4' },
  'video/webm': { category: 'videos', extension: 'webm' },
  'video/quicktime': { category: 'videos', extension: 'mov' },
  'audio/mp4': { category: 'audio', extension: 'm4a' },
  'audio/mpeg': { category: 'audio', extension: 'mp3' },
  'audio/wav': { category: 'audio', extension: 'wav' },
  'audio/webm': { category: 'audio', extension: 'webm' },
} as const;
const MIME_TYPES = Object.fromEntries(
  Object.entries(MEDIA_TYPES).map(([mimeType, value]) => [`.${value.extension}`, mimeType]),
);
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type StoredMedia = {
  url: string;
  mimeType: string;
  sizeBytes: number;
};

export type MediaPathCategory = 'images' | 'videos' | 'audio';

@Injectable()
export class MediaStorageService {
  private readonly rootPath: string;
  private readonly publicPath: string;

  constructor(config: ConfigService) {
    this.rootPath = resolve(config.get<string>('MEDIA_STORAGE_PATH')?.trim() || join(process.cwd(), 'data', 'media'));
    this.publicPath = (config.get<string>('MEDIA_PUBLIC_PATH')?.trim() || '/v1/media').replace(/\/$/, '');
  }

  async storeGeneratedImage(input: {
    conversationId: string;
    messageId: string;
    dataUrl: string;
    mimeType: string;
  }): Promise<StoredMedia> {
    const prefix = `data:${input.mimeType};base64,`;
    if (!input.dataUrl.startsWith(prefix)) {
      throw new ServiceUnavailableException('图片生成结果格式无效');
    }

    const buffer = Buffer.from(input.dataUrl.slice(prefix.length), 'base64');
    if (!buffer.length) throw new ServiceUnavailableException('图片生成结果为空');

    return this.store({
      category: 'images',
      conversationId: input.conversationId,
      assetId: input.messageId,
      data: buffer,
      mimeType: input.mimeType,
    });
  }

  categoryForMimeType(mimeType: string): MediaPathCategory | null {
    return MEDIA_TYPES[mimeType as keyof typeof MEDIA_TYPES]?.category ?? null;
  }

  async store(input: {
    category: MediaPathCategory;
    conversationId: string;
    assetId: string;
    data: Buffer;
    mimeType: string;
  }): Promise<StoredMedia> {
    const descriptor = MEDIA_TYPES[input.mimeType as keyof typeof MEDIA_TYPES];
    if (!descriptor || descriptor.category !== input.category) {
      throw new ServiceUnavailableException('媒体存储格式不受支持');
    }
    if (!input.data.length) throw new ServiceUnavailableException('媒体文件为空');

    const segments = [input.category, input.conversationId, input.assetId, `${randomUUID()}.${descriptor.extension}`];
    const targetPath = this.resolvePath(segments);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(temporaryPath, input.data, { flag: 'wx' });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new ServiceUnavailableException('图片存储不可用，请稍后重试', { cause: error });
    }

    return { url: this.publicUrl(segments), mimeType: input.mimeType, sizeBytes: input.data.length };
  }

  async writeUploadChunk(input: {
    conversationId: string;
    uploadId: string;
    index: number;
    data: Buffer;
  }) {
    const path = this.resolvePath(['uploads', input.conversationId, input.uploadId, `${input.index}.part`]);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.data, { flag: 'wx' });
  }

  async storeChunkedVideo(input: {
    conversationId: string;
    uploadId: string;
    assetId: string;
    chunkCount: number;
    mimeType: string;
  }): Promise<StoredMedia> {
    const descriptor = MEDIA_TYPES[input.mimeType as keyof typeof MEDIA_TYPES];
    if (!descriptor || descriptor.category !== 'videos') throw new ServiceUnavailableException('视频存储格式不受支持');
    const segments = ['videos', input.conversationId, input.assetId, `${randomUUID()}.${descriptor.extension}`];
    const targetPath = this.resolvePath(segments);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    const uploadDirectory = this.resolvePath(['uploads', input.conversationId, input.uploadId]);
    try {
      await mkdir(dirname(targetPath), { recursive: true });
      for (let index = 0; index < input.chunkCount; index += 1) {
        await appendFile(temporaryPath, await readFile(join(uploadDirectory, `${index}.part`)), { flag: index === 0 ? 'wx' : 'a' });
      }
      const file = await stat(temporaryPath);
      if (!file.size) throw new Error('视频文件为空');
      await rename(temporaryPath, targetPath);
      await rm(uploadDirectory, { recursive: true, force: true });
      return { url: this.publicUrl(segments), mimeType: input.mimeType, sizeBytes: file.size };
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new ServiceUnavailableException('视频合并失败，请重新上传', { cause: error });
    }
  }

  async removeUpload(conversationId: string, uploadId: string) {
    await rm(this.resolvePath(['uploads', conversationId, uploadId]), { recursive: true, force: true });
  }

  async removeUploadChunk(conversationId: string, uploadId: string, index: number) {
    await unlink(this.resolvePath(['uploads', conversationId, uploadId, `${index}.part`])).catch(() => undefined);
  }

  isManagedUrl(url: string) {
    return url.startsWith(`${this.publicPath}/`);
  }

  urlFor(category: string, conversationId: string, messageId: string, filename: string) {
    return this.publicUrl([category, conversationId, messageId, filename]);
  }

  absolutePathForUrl(url: string) {
    return this.resolvePath(this.segmentsFromUrl(url));
  }

  async toDataUrl(url: string, mimeType: string) {
    const segments = this.segmentsFromUrl(url);
    const buffer = await readFile(this.resolvePath(segments)).catch(() => {
      throw new NotFoundException('图片附件不存在');
    });
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  async open(category: string, conversationId: string, messageId: string, filename: string) {
    const segments = [category, conversationId, messageId, filename];
    const path = this.resolvePath(segments);
    await access(path, constants.R_OK).catch(() => {
      throw new NotFoundException('媒体文件不存在');
    });
    const mimeType = MIME_TYPES[extname(filename).toLowerCase()];
    if (!mimeType) throw new NotFoundException('媒体文件格式不受支持');
    return { mimeType, stream: createReadStream(path) };
  }

  private publicUrl(segments: string[]) {
    return `${this.publicPath}/${segments.map(encodeURIComponent).join('/')}`;
  }

  private segmentsFromUrl(url: string) {
    if (!this.isManagedUrl(url)) throw new NotFoundException('媒体文件不存在');
    return url.slice(this.publicPath.length + 1).split('/').map(decodeURIComponent);
  }

  private resolvePath(segments: string[]) {
    if (!segments.length || !segments.every((segment) => SAFE_PATH_SEGMENT.test(segment))) {
      throw new NotFoundException('媒体文件不存在');
    }
    const path = resolve(this.rootPath, ...segments);
    const rootWithSeparator = `${this.rootPath}/`;
    if (!normalize(path).startsWith(rootWithSeparator)) throw new NotFoundException('媒体文件不存在');
    return path;
  }
}
