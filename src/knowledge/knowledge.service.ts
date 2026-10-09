import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeDocumentStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import type { CreateTextDocumentDto } from './dto/create-text-document.dto';
import type { SearchKnowledgeDto } from './dto/search-knowledge.dto';

const DEFAULT_KNOWLEDGE_BASE_NAME = '个人资料';
const CHUNK_SIZE = 1_000;
const CHUNK_OVERLAP = 160;
const MAX_SEARCH_CANDIDATES = 300;
const MAX_SEARCH_RESULTS = 8;

function normalize(value: string) {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-CN');
}

function termsForSearch(value: string) {
  const compact = normalize(value).replace(/[^\p{L}\p{N}]/gu, '');
  const latinTerms = compact.match(/[a-z0-9]{2,}/gi) ?? [];
  const chineseBigrams = Array.from(compact)
    .filter((character) => /[\u3400-\u9fff]/u.test(character))
    .map((_, index, characters) => characters.slice(index, index + 2).join(''))
    .filter((term) => term.length === 2);
  return [...new Set([...latinTerms, ...chineseBigrams])].slice(0, 32);
}

function scoreChunk(content: string, terms: string[]) {
  const normalized = normalize(content);
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function excerpt(content: string, terms: string[]) {
  const normalized = normalize(content);
  const position = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, position - 120);
  const end = Math.min(content.length, start + 360);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

function splitText(content: string) {
  const source = content.trim().replace(/\r\n?/gu, '\n');
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    let end = Math.min(source.length, cursor + CHUNK_SIZE);
    if (end < source.length) {
      const boundary = Math.max(
        source.lastIndexOf('\n', end),
        source.lastIndexOf('。', end),
        source.lastIndexOf('！', end),
        source.lastIndexOf('？', end),
      );
      if (boundary > cursor + CHUNK_SIZE / 2) end = boundary + 1;
    }
    const chunk = source.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= source.length) break;
    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }
  return chunks;
}

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async listBases(conversationId: string) {
    const userId = await this.userIdForConversation(conversationId);
    return this.prisma.knowledgeBase.findMany({
      where: { userId },
      include: { _count: { select: { documents: { where: { status: KnowledgeDocumentStatus.READY } } } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listDocuments(conversationId: string, knowledgeBaseName?: string) {
    const userId = await this.userIdForConversation(conversationId);
    return this.prisma.knowledgeDocument.findMany({
      where: {
        userId,
        status: { not: KnowledgeDocumentStatus.DELETED },
        ...(knowledgeBaseName ? { knowledgeBase: { name: knowledgeBaseName } } : {}),
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        processedAt: true,
        failureReason: true,
        createdAt: true,
        updatedAt: true,
        knowledgeBase: { select: { id: true, name: true } },
        _count: { select: { chunks: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createTextDocument(conversationId: string, input: CreateTextDocumentDto) {
    const userId = await this.userIdForConversation(conversationId);
    const filename = input.filename.trim();
    const content = input.content.trim();
    const baseName = input.knowledgeBaseName?.trim() || DEFAULT_KNOWLEDGE_BASE_NAME;
    const chunks = splitText(content);
    if (!chunks.length) throw new BadRequestException('文档内容为空');
    const base = await this.prisma.knowledgeBase.upsert({
      where: { userId_name: { userId, name: baseName } },
      update: {},
      create: { userId, name: baseName },
    });
    return this.prisma.knowledgeDocument.create({
      data: {
        userId,
        knowledgeBaseId: base.id,
        filename,
        mimeType: input.mimeType ?? 'text/plain',
        storageKey: 'inline://text',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        status: KnowledgeDocumentStatus.READY,
        processedAt: new Date(),
        chunks: {
          create: chunks.map((chunk, ordinal) => ({
            ordinal,
            content: chunk,
            metadata: { source: 'inline-text' },
          })),
        },
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        processedAt: true,
        createdAt: true,
        knowledgeBase: { select: { id: true, name: true } },
        _count: { select: { chunks: true } },
      },
    });
  }

  async search(conversationId: string, input: SearchKnowledgeDto) {
    const userId = await this.userIdForConversation(conversationId);
    const terms = termsForSearch(input.query);
    if (!terms.length) return [];
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: {
        document: {
          userId,
          status: KnowledgeDocumentStatus.READY,
          ...(input.knowledgeBaseName ? { knowledgeBase: { name: input.knowledgeBaseName } } : {}),
        },
      },
      select: {
        id: true,
        ordinal: true,
        content: true,
        document: { select: { id: true, filename: true, knowledgeBase: { select: { id: true, name: true } } } },
      },
      take: MAX_SEARCH_CANDIDATES,
      orderBy: { createdAt: 'desc' },
    });
    return chunks
      .map((chunk) => ({
        ...chunk,
        score: scoreChunk(chunk.content, terms),
        excerpt: excerpt(chunk.content, terms),
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score || left.document.filename.localeCompare(right.document.filename, 'zh-CN'))
      .slice(0, MAX_SEARCH_RESULTS)
      .map(({ content: _content, document, ...result }) => ({
        ...result,
        documentId: document.id,
        filename: document.filename,
        knowledgeBase: document.knowledgeBase,
      }));
  }

  async removeDocument(conversationId: string, documentId: string) {
    const userId = await this.userIdForConversation(conversationId);
    const document = await this.prisma.knowledgeDocument.findFirst({ where: { id: documentId, userId }, select: { id: true } });
    if (!document) throw new NotFoundException('知识文档不存在');
    await this.prisma.knowledgeDocument.delete({ where: { id: document.id } });
  }

  private async userIdForConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { userId: true } });
    if (!conversation) throw new NotFoundException('会话不存在');
    return conversation.userId;
  }
}
