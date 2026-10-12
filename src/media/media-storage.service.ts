import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type StoredMedia = {
  url: string;
  mimeType: string;
};

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
    const extension = IMAGE_EXTENSIONS[input.mimeType];
    if (!extension) throw new ServiceUnavailableException('图片存储格式不受支持');

    const prefix = `data:${input.mimeType};base64,`;
    if (!input.dataUrl.startsWith(prefix)) {
      throw new ServiceUnavailableException('图片生成结果格式无效');
    }

    const buffer = Buffer.from(input.dataUrl.slice(prefix.length), 'base64');
    if (!buffer.length) throw new ServiceUnavailableException('图片生成结果为空');

    const segments = ['images', input.conversationId, input.messageId, `${randomUUID()}.${extension}`];
    const targetPath = this.resolvePath(segments);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(temporaryPath, buffer, { flag: 'wx' });
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new ServiceUnavailableException('图片存储不可用，请稍后重试', { cause: error });
    }

    return { url: this.publicUrl(segments), mimeType: input.mimeType };
  }

  isManagedUrl(url: string) {
    return url.startsWith(`${this.publicPath}/`);
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
