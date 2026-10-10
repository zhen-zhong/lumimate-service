import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { MemoryCategory, MemoryStatus, Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';

import { PrismaService } from '../database/prisma.service';
import type { UpdateMemoryDto } from './dto/update-memory.dto';
import type { UpdateProactivePolicyDto } from './dto/update-proactive-policy.dto';
import type { UpdateRelationshipDto } from './dto/update-relationship.dto';
import { MEMORY_EXTRACTION_QUEUE, type ExtractMemoryJob, type MemoryCandidate } from './memory.types';

const MAX_RECALLED_MEMORIES = 8;

const proactivePolicySelect = Prisma.validator<Prisma.ProactivePolicySelect>()({
  enabled: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  dailyLimit: true,
  minimumIntervalMinutes: true,
});

function normalize(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
}

function queryTerms(value: string) {
  const compact = normalize(value).replace(/[^\p{L}\p{N}]/gu, '');
  const latinTerms = compact.match(/[a-z0-9]{2,}/gi) ?? [];
  const chineseBigrams = Array.from(compact)
    .filter((character) => /[\u3400-\u9fff]/.test(character))
    .map((_, index, characters) => characters.slice(index, index + 2).join(''))
    .filter((term) => term.length === 2);
  return [...new Set([...latinTerms, ...chineseBigrams])].slice(0, 32);
}

function rankMemory(content: string, terms: string[]) {
  const normalized = normalize(content);
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function uniqueCandidates(candidates: MemoryCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.category}:${normalize(candidate.content)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return candidate.content.length >= 2 && candidate.content.length <= 500;
  });
}

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MEMORY_EXTRACTION_QUEUE) private readonly queue: Queue<ExtractMemoryJob>,
  ) {}

  async enqueueExtraction(job: ExtractMemoryJob) {
    await this.queue.add('extract', job, {
      jobId: `extract:${job.sourceMessageId}`,
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  }

  async extractCandidates(input: ExtractMemoryJob) {
    const candidates = uniqueCandidates(this.extractRuleCandidates(input.content));
    for (const candidate of candidates) {
      const normalizedValue = normalize(candidate.content);
      const existing = await this.prisma.memory.findFirst({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          category: candidate.category,
          normalizedValue,
          status: { not: MemoryStatus.DELETED },
        },
        select: { id: true, status: true },
      });
      if (existing) continue;
      await this.prisma.memory.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          category: candidate.category,
          status: MemoryStatus.CANDIDATE,
          content: candidate.content,
          normalizedValue,
          sourceMessageId: input.sourceMessageId,
          confidence: candidate.confidence,
        },
      });
    }
  }

  async buildAgentContext(input: {
    userId: string;
    conversationId: string;
    query: string;
    excludedCategories?: string[];
  }) {
    const now = new Date();
    const excludedCategories = input.excludedCategories ?? [];
    const memories = await this.prisma.memory.findMany({
      where: {
        userId: input.userId,
        status: MemoryStatus.CONFIRMED,
        ...(excludedCategories.length ? { category: { notIn: excludedCategories as MemoryCategory[] } } : {}),
        OR: [{ conversationId: input.conversationId }, { conversationId: null }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { category: true, content: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
    const terms = queryTerms(input.query);
    const relevant = memories
      .map((memory) => ({ memory, score: rankMemory(memory.content, terms) }))
      .sort((left, right) => right.score - left.score || right.memory.updatedAt.getTime() - left.memory.updatedAt.getTime())
      .slice(0, MAX_RECALLED_MEMORIES)
      .map(({ memory }) => `- ${memory.category}: ${memory.content}`);
    const relationship = excludedCategories.includes(MemoryCategory.RELATIONSHIP)
      ? null
      : await this.ensureRelationship(input.userId, input.conversationId);
    const relationshipLines = [
      relationship?.preferredName ? `用户希望被称呼为：${relationship.preferredName}` : null,
      relationship?.relationshipSummary ? `关系状态：${relationship.relationshipSummary}` : null,
      relationship?.communicationStyle ? `沟通偏好：${relationship.communicationStyle}` : null,
    ].filter(Boolean);
    return [
      relationshipLines.length ? `关系资料（仅作自然沟通参考）：\n${relationshipLines.join('\n')}` : null,
      relevant.length ? `已确认的长期记忆（仅在相关时使用，不要声称记忆来源）：\n${relevant.join('\n')}` : null,
    ].filter(Boolean).join('\n\n');
  }

  async list(conversationId: string) {
    return this.prisma.memory.findMany({
      where: { conversationId, status: { not: MemoryStatus.DELETED } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async confirm(conversationId: string, id: string) {
    await this.requireConversationMemory(conversationId, id);
    return this.prisma.memory.update({
      where: { id },
      data: { status: MemoryStatus.CONFIRMED, confirmedAt: new Date() },
    });
  }

  async update(conversationId: string, id: string, input: UpdateMemoryDto) {
    await this.requireConversationMemory(conversationId, id);
    return this.prisma.memory.update({
      where: { id },
      data: {
        ...input,
        ...(input.content ? { normalizedValue: normalize(input.content) } : {}),
        status: MemoryStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    });
  }

  async remove(conversationId: string, id: string) {
    await this.requireConversationMemory(conversationId, id);
    return this.prisma.memory.update({
      where: { id },
      data: { status: MemoryStatus.DELETED, deletedAt: new Date() },
    });
  }

  async getRelationship(userId: string, conversationId: string) {
    return this.ensureRelationship(userId, conversationId);
  }

  async updateRelationship(userId: string, conversationId: string, input: UpdateRelationshipDto) {
    await this.ensureRelationship(userId, conversationId);
    return this.prisma.relationship.update({ where: { conversationId }, data: input });
  }

  async getProactivePolicy(userId: string) {
    return this.prisma.proactivePolicy.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: proactivePolicySelect,
    });
  }

  async updateProactivePolicy(userId: string, input: UpdateProactivePolicyDto) {
    return this.prisma.proactivePolicy.upsert({
      where: { userId },
      update: input,
      create: { userId, ...input },
      select: proactivePolicySelect,
    });
  }

  async markInteraction(userId: string, conversationId: string) {
    await this.ensureRelationship(userId, conversationId);
    await this.prisma.relationship.update({ where: { conversationId }, data: { lastInteractionAt: new Date() } });
  }

  private async ensureRelationship(userId: string, conversationId: string) {
    return this.prisma.relationship.upsert({
      where: { conversationId },
      update: {},
      create: { userId, conversationId },
    });
  }

  private async requireConversationMemory(conversationId: string, id: string) {
    const memory = await this.prisma.memory.findFirst({ where: { id, conversationId } });
    if (!memory) throw new NotFoundException('记忆不存在');
    return memory;
  }

  private extractRuleCandidates(content: string): MemoryCandidate[] {
    const source = content.trim();
    if (!source) return [];
    const candidates: MemoryCandidate[] = [];
    const collect = (pattern: RegExp, category: MemoryCategory, confidence: number) => {
      const match = pattern.exec(source);
      const value = match?.[1]?.trim().replace(/[。！!？?]+$/, '');
      if (value) candidates.push({ category, content: value, confidence });
    };
    collect(/(?:请)?记住(?:我)?(?:是|的)?(.{2,120})/u, MemoryCategory.FACT, 0.92);
    collect(/我(?:喜欢|爱)(.{2,120})/u, MemoryCategory.PREFERENCE, 0.82);
    collect(/我(?:不喜欢|讨厌)(.{2,120})/u, MemoryCategory.PREFERENCE, 0.82);
    collect(/我(?:住在|住于|在)(.{2,120})(?:工作|上班|学习|读书)/u, MemoryCategory.PLACE, 0.72);
    collect(/(?:我叫|我的名字是|你可以叫我)(.{2,60})/u, MemoryCategory.RELATIONSHIP, 0.88);
    collect(/(?:别忘了|记得)(.{2,120})/u, MemoryCategory.COMMITMENT, 0.72);
    return candidates;
  }
}
