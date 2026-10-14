import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import COS = require('cos-nodejs-sdk-v5');
import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

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
const MEDIA_WRITE_MAX_ATTEMPTS = 3;

export type StoredMedia = {
  url: string;
  mimeType: string;
  sizeBytes: number;
};

export type MediaPathCategory = 'images' | 'videos' | 'audio';

@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly rootPath: string;
  private readonly temporaryRootPath: string;
  private readonly publicPath: string;
  private readonly cos?: COS;
  private readonly cosBucket?: string;
  private readonly cosRegion?: string;
  private readonly cosPrefix?: string;

  constructor(config: ConfigService) {
    this.rootPath = resolve(config.get<string>('MEDIA_STORAGE_PATH')?.trim() || join(process.cwd(), 'data', 'media'));
    this.temporaryRootPath = resolve(config.get<string>('MEDIA_TEMP_PATH')?.trim() || join(tmpdir(), 'lumimate-media'));
    this.publicPath = (config.get<string>('MEDIA_PUBLIC_PATH')?.trim() || '/v1/media').replace(/\/$/, '');

    const secretId = config.get<string>('COS_SECRET_ID')?.trim() || '';
    const secretKey = config.get<string>('COS_SECRET_KEY')?.trim() || '';
    const bucket = config.get<string>('COS_BUCKET')?.trim() || '';
    const region = config.get<string>('COS_REGION')?.trim() || '';
    const prefix = config.get<string>('COS_PREFIX')?.trim().replace(/^\/+|\/+$/g, '') || '';
    const hasCosConfiguration = Boolean(secretId || secretKey || bucket || region || prefix);

    if (hasCosConfiguration && (!secretId || !secretKey || !bucket || !region || !prefix)) {
      throw new Error('COS 配置不完整：COS_SECRET_ID、COS_SECRET_KEY、COS_BUCKET、COS_REGION、COS_PREFIX 必须同时设置');
    }
    if (hasCosConfiguration) {
      this.cos = new COS({ SecretId: secretId, SecretKey: secretKey });
      this.cosBucket = bucket;
      this.cosRegion = region;
      this.cosPrefix = prefix;
      this.logger.log(`媒体存储使用腾讯云 COS：${bucket}/${prefix}`);
    } else {
      this.logger.warn('未配置 COS，媒体存储回退到本地文件系统；仅限本地开发');
    }
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
    if (this.cos) {
      await this.withWriteRetry('媒体上传', () => this.cos!.putObject({
        ...this.cosObject(segments),
        Body: input.data,
        ContentLength: input.data.length,
        ContentType: input.mimeType,
      }));
      return { url: this.publicUrl(segments), mimeType: input.mimeType, sizeBytes: input.data.length };
    }

    const targetPath = this.localPath(segments);
    for (let attempt = 1; attempt <= MEDIA_WRITE_MAX_ATTEMPTS; attempt += 1) {
      const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(temporaryPath, input.data, { flag: 'wx' });
        await rename(temporaryPath, targetPath);
        return { url: this.publicUrl(segments), mimeType: input.mimeType, sizeBytes: input.data.length };
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`本地媒体写入失败（第 ${attempt}/${MEDIA_WRITE_MAX_ATTEMPTS} 次）：${message}`);
        if (attempt < MEDIA_WRITE_MAX_ATTEMPTS) await this.backoff(attempt);
      }
    }
    throw new ServiceUnavailableException('媒体存储不可用，请稍后重试');
  }

  async writeUploadChunk(input: {
    conversationId: string;
    uploadId: string;
    index: number;
    data: Buffer;
  }) {
    const path = this.temporaryPath(['uploads', input.conversationId, input.uploadId, `${input.index}.part`]);
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
    const uploadDirectory = this.temporaryPath(['uploads', input.conversationId, input.uploadId]);
    if (this.cos) return this.storeChunkedVideoToCos({ ...input, segments, uploadDirectory });

    const targetPath = this.localPath(segments);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
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
    await rm(this.temporaryPath(['uploads', conversationId, uploadId]), { recursive: true, force: true });
  }

  async removeUploadChunk(conversationId: string, uploadId: string, index: number) {
    await unlink(this.temporaryPath(['uploads', conversationId, uploadId, `${index}.part`])).catch(() => undefined);
  }

  async remove(url: string) {
    const segments = this.segmentsFromUrl(url);
    if (this.cos) {
      await this.cos.deleteObject(this.cosObject(segments));
      return;
    }
    await unlink(this.localPath(segments)).catch(() => undefined);
  }

  isManagedUrl(url: string) {
    return url.startsWith(`${this.publicPath}/`);
  }

  urlFor(category: string, conversationId: string, messageId: string, filename: string) {
    return this.publicUrl([category, conversationId, messageId, filename]);
  }

  async toDataUrl(url: string, mimeType: string) {
    const segments = this.segmentsFromUrl(url);
    try {
      const buffer = this.cos
        ? (await this.cos.getObject(this.cosObject(segments))).Body
        : await readFile(this.localPath(segments));
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (error) {
      this.logReadFailure(error);
      throw new NotFoundException('图片附件不存在');
    }
  }

  async withLocalFileForUrl<T>(url: string, callback: (path: string) => Promise<T>) {
    const segments = this.segmentsFromUrl(url);
    if (!this.cos) return callback(this.localPath(segments));

    const temporaryDirectory = this.temporaryPath(['processing', randomUUID()]);
    const temporaryPath = join(temporaryDirectory, segments.at(-1)!);
    try {
      await mkdir(temporaryDirectory, { recursive: true });
      await this.cos.getObject({ ...this.cosObject(segments), Output: createWriteStream(temporaryPath, { flags: 'wx' }) });
      return await callback(temporaryPath);
    } catch (error) {
      this.logReadFailure(error);
      throw error;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async open(category: string, conversationId: string, messageId: string, filename: string) {
    const segments = [category, conversationId, messageId, filename];
    const mimeType = MIME_TYPES[extname(filename).toLowerCase()];
    if (!mimeType) throw new NotFoundException('媒体文件格式不受支持');

    if (!this.cos) {
      const path = this.localPath(segments);
      await access(path, constants.R_OK).catch(() => {
        throw new NotFoundException('媒体文件不存在');
      });
      return { mimeType, stream: createReadStream(path) };
    }

    try {
      await this.cos.headObject(this.cosObject(segments));
    } catch (error) {
      this.logReadFailure(error);
      throw new NotFoundException('媒体文件不存在');
    }
    const stream = new PassThrough();
    void this.cos.getObject({ ...this.cosObject(segments), Output: stream }).catch((error: unknown) => {
      this.logReadFailure(error);
      stream.destroy(error instanceof Error ? error : new Error('媒体读取失败'));
    });
    return { mimeType, stream };
  }

  private async storeChunkedVideoToCos(input: {
    conversationId: string;
    uploadId: string;
    assetId: string;
    chunkCount: number;
    mimeType: string;
    segments: string[];
    uploadDirectory: string;
  }): Promise<StoredMedia> {
    const options = this.cosObject(input.segments);
    let multipartUploadId: string | undefined;
    let sizeBytes = 0;
    try {
      const initialized = await this.cos!.multipartInit({ ...options, ContentType: input.mimeType });
      multipartUploadId = initialized.UploadId;
      const parts: Array<{ PartNumber: number; ETag: string }> = [];
      for (let index = 0; index < input.chunkCount; index += 1) {
        const body = await readFile(join(input.uploadDirectory, `${index}.part`));
        if (!body.length) throw new Error(`视频分片 ${index} 为空`);
        const uploaded = await this.cos!.multipartUpload({
          ...options,
          UploadId: multipartUploadId,
          PartNumber: index + 1,
          Body: body,
          ContentLength: body.length,
        });
        parts.push({ PartNumber: index + 1, ETag: uploaded.ETag });
        sizeBytes += body.length;
      }
      if (!sizeBytes) throw new Error('视频文件为空');
      await this.cos!.multipartComplete({ ...options, UploadId: multipartUploadId, Parts: parts });
      return { url: this.publicUrl(input.segments), mimeType: input.mimeType, sizeBytes };
    } catch (error) {
      if (multipartUploadId) {
        await this.cos!.multipartAbort({ ...options, UploadId: multipartUploadId }).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`COS 视频分片上传失败：${message}`);
      throw new ServiceUnavailableException('视频上传失败，请重新上传', { cause: error });
    } finally {
      await rm(input.uploadDirectory, { recursive: true, force: true });
    }
  }

  private cosObject(segments: string[]) {
    if (!this.cosBucket || !this.cosRegion || !this.cosPrefix) throw new Error('COS 未配置');
    return {
      Bucket: this.cosBucket,
      Region: this.cosRegion,
      Key: [this.cosPrefix, ...this.validateSegments(segments)].join('/'),
    };
  }

  private publicUrl(segments: string[]) {
    return `${this.publicPath}/${this.validateSegments(segments).map(encodeURIComponent).join('/')}`;
  }

  private segmentsFromUrl(url: string) {
    if (!this.isManagedUrl(url)) throw new NotFoundException('媒体文件不存在');
    return this.validateSegments(url.slice(this.publicPath.length + 1).split('/').map(decodeURIComponent));
  }

  private localPath(segments: string[]) {
    return this.pathInRoot(this.rootPath, segments);
  }

  private temporaryPath(segments: string[]) {
    return this.pathInRoot(this.temporaryRootPath, segments);
  }

  private pathInRoot(root: string, segments: string[]) {
    const safeSegments = this.validateSegments(segments);
    const path = resolve(root, ...safeSegments);
    const rootWithSeparator = `${root}/`;
    if (!normalize(path).startsWith(rootWithSeparator)) throw new NotFoundException('媒体文件不存在');
    return path;
  }

  private validateSegments(segments: string[]) {
    if (!segments.length || !segments.every((segment) => SAFE_PATH_SEGMENT.test(segment))) {
      throw new NotFoundException('媒体文件不存在');
    }
    return segments;
  }

  private async withWriteRetry<T>(label: string, operation: () => Promise<T>) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MEDIA_WRITE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`${label}失败（第 ${attempt}/${MEDIA_WRITE_MAX_ATTEMPTS} 次）：${message}`);
        if (attempt < MEDIA_WRITE_MAX_ATTEMPTS) await this.backoff(attempt);
      }
    }
    throw new ServiceUnavailableException('媒体存储不可用，请稍后重试', { cause: lastError });
  }

  private backoff(attempt: number) {
    return new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }

  private logReadFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`媒体读取失败：${message}`);
  }
}
