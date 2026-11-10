import { Injectable, NotFoundException } from '@nestjs/common';
import { CompanionEventSubject, MemoryCategory, MemoryLayer, MemoryStatus, Prisma, SharedEpisodeKind, SharedEpisodeResolution } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { CompanionTimelineService } from '../companion/companion-timeline.service';
import { commitmentStateForMemory } from '../companion/companion-state';
import type { UpdateMemoryDto } from './dto/update-memory.dto';
import type { UpdateProactivePolicyDto } from './dto/update-proactive-policy.dto';
import type { UpdateRelationshipDto } from './dto/update-relationship.dto';
import type { CreateSharedEpisodeDto } from './dto/create-shared-episode.dto';
import type { UpdateSharedEpisodeDto } from './dto/update-shared-episode.dto';
import type { ExtractMemoryJob, MemoryCandidate } from './memory.types';

const MAX_RECALLED_MEMORIES = 8;

const UNFINISHED_THREAD_PATTERN = /(?:下次|回头|以后)(?:再|再慢慢)?说|(?:我|这)(?:还)?没说完|先(?:不|别)说了|改天再聊/u;

export function unfinishedThreadContent(content: string) {
  const normalized = content.trim().replace(/\s+/gu, ' ');
  return UNFINISHED_THREAD_PATTERN.test(normalized) ? normalized.slice(0, 500) : null;
}

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

export function extractRuleMemoryCandidates(content: string): MemoryCandidate[] {
  const source = content.trim();
  if (!source) return [];
  const candidates: MemoryCandidate[] = [];
  const collect = (pattern: RegExp, category: MemoryCategory, confidence: number, memoryKey?: string) => {
    const match = pattern.exec(source);
    const value = match?.[1]?.trim().replace(/[。！!？?]+$/, '');
    if (value) candidates.push({ category, content: value, confidence, memoryKey });
  };
  collect(/(?:请)?记住(?:我)?(?:是|的)?(.{2,120})/u, MemoryCategory.FACT, 0.92);
  collect(/我(?:喜欢|爱)(.{2,120})/u, MemoryCategory.PREFERENCE, 0.82);
  collect(/我(?:不喜欢|讨厌)(.{2,120})/u, MemoryCategory.PREFERENCE, 0.82);
  collect(/(?:我住在|我住于)([^，。！!?；;]{2,120}?)(?=(?:工作|上班|学习|读书|[，。！!?；;]|$))/u, MemoryCategory.PLACE, 0.78, 'place:residence');
  collect(/我在([^，。！!?；;]{2,120}?)(?:工作|上班|学习|读书)/u, MemoryCategory.PLACE, 0.72, 'place:work_or_study');
  collect(/(?:我叫|我的名字是|你可以叫我)(.{2,60})/u, MemoryCategory.RELATIONSHIP, 0.88, 'relationship:preferred_name');
  collect(/(?:别忘了|记得)(.{2,120})/u, MemoryCategory.COMMITMENT, 0.72);
  return candidates;
}

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: CompanionTimelineService,
  ) {}

  async extractCandidates(input: ExtractMemoryJob) {
    const candidates = uniqueCandidates(extractRuleMemoryCandidates(input.content));
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
      const memory = await this.prisma.memory.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          category: candidate.category,
          status: MemoryStatus.CANDIDATE,
          content: candidate.content,
          normalizedValue,
          memoryKey: candidate.memoryKey,
          sourceMessageId: input.sourceMessageId,
          confidence: candidate.confidence,
        },
      });
      await this.timeline.record({
        userId: input.userId,
        conversationId: input.conversationId,
        sourceMessageId: input.sourceMessageId,
        subject: CompanionEventSubject.MEMORY,
        subjectId: memory.id,
        eventType: 'memory.candidate_created',
        state: commitmentStateForMemory(memory.status),
        detail: { category: memory.category, confidence: memory.confidence },
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
        layer: MemoryLayer.USER_FACT,
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
    const episodes = await this.prisma.sharedEpisode.findMany({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        status: 'CONFIRMED',
        deletedAt: null,
        archivedAt: null,
      },
      orderBy: { occurredAt: 'desc' },
      take: 12,
      select: { title: true, content: true, occurredAt: true },
    });
    const relevantEpisodes = episodes
      .map((episode) => ({ episode, score: rankMemory(`${episode.title}\n${episode.content}`, terms) }))
      .sort((left, right) => right.score - left.score || right.episode.occurredAt.getTime() - left.episode.occurredAt.getTime())
      .slice(0, 4)
      .map(({ episode }) => `- ${episode.title}：${episode.content}`);
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
      relevantEpisodes.length ? `共同经历（只在相关时自然延续，不要捏造未发生的细节）：\n${relevantEpisodes.join('\n')}` : null,
      relevant.length ? `已确认的用户事实（仅在相关时使用，不要声称记忆来源）：\n${relevant.join('\n')}` : null,
    ].filter(Boolean).join('\n\n');
  }

  async list(conversationId: string) {
    return this.prisma.memory.findMany({
      where: { conversationId, status: { not: MemoryStatus.DELETED } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async listEpisodes(conversationId: string) {
    return this.prisma.sharedEpisode.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: [{ archivedAt: 'asc' }, { occurredAt: 'desc' }],
    });
  }

  async createEpisode(userId: string, conversationId: string, input: CreateSharedEpisodeDto) {
    const title = input.title.trim();
    const content = input.content.trim();
    const sourceMessageId = input.sourceMessageId?.trim() || undefined;
    const source = sourceMessageId
      ? await this.prisma.message.findFirst({ where: { id: sourceMessageId, conversationId }, select: { id: true } })
      : null;
    if (sourceMessageId && !source) throw new NotFoundException('共同经历的来源消息不存在');
    const episode = await this.prisma.sharedEpisode.create({
      data: {
        userId,
        conversationId,
        title,
        content,
        sourceMessageId: source?.id,
        kind: input.kind ?? SharedEpisodeKind.TODAY_FRAGMENT,
        ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
      },
    });
    await this.recordEpisodeEvent(episode, 'shared_episode.created', 'COMPLETED');
    return episode;
  }

  async createUnfinishedThreadCandidate(input: { userId: string; conversationId: string; sourceMessageId: string; content: string }) {
    const content = unfinishedThreadContent(input.content);
    if (!content) return null;
    const existing = await this.prisma.sharedEpisode.findFirst({
      where: { conversationId: input.conversationId, sourceMessageId: input.sourceMessageId, kind: SharedEpisodeKind.UNFINISHED_THREAD },
    });
    if (existing) return existing;
    const episode = await this.prisma.sharedEpisode.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        sourceMessageId: input.sourceMessageId,
        title: '还没说完的话',
        content,
        status: 'CANDIDATE',
        kind: SharedEpisodeKind.UNFINISHED_THREAD,
      },
    });
    await this.recordEpisodeEvent(episode, 'shared_episode.unfinished_candidate_created', 'AWAITING_CONFIRMATION');
    return episode;
  }

  async confirmEpisode(conversationId: string, id: string) {
    await this.requireConversationEpisode(conversationId, id);
    const updated = await this.prisma.sharedEpisode.update({
      where: { id },
      data: { status: 'CONFIRMED', archivedAt: null, deletedAt: null },
    });
    await this.recordEpisodeEvent(updated, 'shared_episode.confirmed', 'COMPLETED');
    return updated;
  }

  async updateEpisode(conversationId: string, id: string, input: UpdateSharedEpisodeDto) {
    const episode = await this.requireConversationEpisode(conversationId, id);
    const updated = await this.prisma.sharedEpisode.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.content !== undefined ? { content: input.content.trim() } : {}),
        ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        archivedAt: null,
      },
    });
    await this.recordEpisodeEvent(updated, 'shared_episode.updated', 'COMPLETED');
    return updated;
  }

  async archiveEpisode(conversationId: string, id: string) {
    await this.requireConversationEpisode(conversationId, id);
    const updated = await this.prisma.sharedEpisode.update({
      where: { id },
      data: { archivedAt: new Date(), resolution: SharedEpisodeResolution.CLOSED },
    });
    await this.recordEpisodeEvent(updated, 'shared_episode.archived', 'EXPIRED');
    return updated;
  }

  async removeEpisode(conversationId: string, id: string) {
    await this.requireConversationEpisode(conversationId, id);
    const updated = await this.prisma.sharedEpisode.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.recordEpisodeEvent(updated, 'shared_episode.deleted', 'CANCELLED');
    return updated;
  }

  async getEpisodeProvenance(conversationId: string, id: string) {
    const episode = await this.requireConversationEpisode(conversationId, id);
    const source = episode.sourceMessageId
      ? await this.prisma.message.findFirst({
        where: { id: episode.sourceMessageId, conversationId },
        select: { id: true, role: true, content: true, createdAt: true },
      })
      : null;
    return { episode, source };
  }

  async confirm(conversationId: string, id: string) {
    const memory = await this.requireConversationMemory(conversationId, id);
    const updated = await this.prisma.memory.update({
      where: { id },
      data: { status: MemoryStatus.CONFIRMED, confirmedAt: new Date() },
    });
    const superseded = await this.supersedeConflictingMemories(updated);
    await this.timeline.record({
      userId: memory.userId,
      conversationId,
      sourceMessageId: memory.sourceMessageId,
      subject: CompanionEventSubject.MEMORY,
      subjectId: id,
      eventType: 'memory.confirmed',
      state: commitmentStateForMemory(updated.status),
    });
    await this.recordSupersededMemories(superseded, updated.id, updated.conversationId);
    return updated;
  }

  async update(conversationId: string, id: string, input: UpdateMemoryDto) {
    const memory = await this.requireConversationMemory(conversationId, id);
    const updated = await this.prisma.memory.update({
      where: { id },
      data: {
        ...input,
        ...(input.content ? { normalizedValue: normalize(input.content) } : {}),
        ...(input.category !== undefined && input.category !== memory.category ? { memoryKey: null } : {}),
        status: MemoryStatus.CONFIRMED,
        confirmedAt: new Date(),
        archivedAt: null,
        supersededAt: null,
        supersededById: null,
      },
    });
    const superseded = await this.supersedeConflictingMemories(updated);
    await this.timeline.record({
      userId: memory.userId,
      conversationId,
      sourceMessageId: memory.sourceMessageId,
      subject: CompanionEventSubject.MEMORY,
      subjectId: id,
      eventType: 'memory.updated',
      state: commitmentStateForMemory(updated.status),
    });
    await this.recordSupersededMemories(superseded, updated.id, updated.conversationId);
    return updated;
  }

  async archive(conversationId: string, id: string) {
    const memory = await this.requireConversationMemory(conversationId, id);
    const updated = await this.prisma.memory.update({
      where: { id },
      data: { status: MemoryStatus.ARCHIVED, archivedAt: new Date() },
    });
    await this.timeline.record({
      userId: memory.userId,
      conversationId,
      sourceMessageId: memory.sourceMessageId,
      subject: CompanionEventSubject.MEMORY,
      subjectId: id,
      eventType: 'memory.archived',
      state: commitmentStateForMemory(updated.status),
    });
    return updated;
  }

  async remove(conversationId: string, id: string) {
    const memory = await this.requireConversationMemory(conversationId, id);
    const updated = await this.prisma.memory.update({
      where: { id },
      data: { status: MemoryStatus.DELETED, deletedAt: new Date() },
    });
    await this.timeline.record({
      userId: memory.userId,
      conversationId,
      sourceMessageId: memory.sourceMessageId,
      subject: CompanionEventSubject.MEMORY,
      subjectId: id,
      eventType: 'memory.deleted',
      state: commitmentStateForMemory(updated.status),
    });
    return updated;
  }

  async getProvenance(conversationId: string, id: string) {
    const memory = await this.requireConversationMemory(conversationId, id);
    const [source, supersededBy] = await Promise.all([
      memory.sourceMessageId
        ? this.prisma.message.findFirst({
          where: { id: memory.sourceMessageId, conversationId },
          select: { id: true, role: true, content: true, createdAt: true },
        })
        : null,
      memory.supersededById
        ? this.prisma.memory.findFirst({
          where: { id: memory.supersededById, conversationId },
          select: { id: true, content: true, status: true, updatedAt: true },
        })
        : null,
    ]);
    return {
      memory: {
        id: memory.id,
        category: memory.category,
        status: memory.status,
        content: memory.content,
        confidence: memory.confidence,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
        archivedAt: memory.archivedAt,
        supersededAt: memory.supersededAt,
      },
      source,
      supersededBy,
    };
  }

  async getRelationship(userId: string, conversationId: string) {
    return this.ensureRelationship(userId, conversationId);
  }

  async updateRelationship(userId: string, conversationId: string, input: UpdateRelationshipDto) {
    await this.ensureRelationship(userId, conversationId);
    return this.prisma.relationship.update({
      where: { conversationId },
      data: {
        ...(input.preferredName !== undefined ? { preferredName: input.preferredName?.trim() || null } : {}),
        ...(input.relationshipSummary !== undefined ? { relationshipSummary: input.relationshipSummary?.trim() || '' } : {}),
        ...(input.communicationStyle !== undefined ? { communicationStyle: input.communicationStyle?.trim() || '' } : {}),
      },
    });
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

  private async requireConversationEpisode(conversationId: string, id: string) {
    const episode = await this.prisma.sharedEpisode.findFirst({ where: { id, conversationId, deletedAt: null } });
    if (!episode) throw new NotFoundException('共同经历不存在');
    return episode;
  }

  private recordEpisodeEvent(
    episode: { id: string; userId: string; conversationId: string; sourceMessageId: string | null },
    eventType: string,
    state: 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED',
  ) {
    return this.timeline.record({
      userId: episode.userId,
      conversationId: episode.conversationId,
      sourceMessageId: episode.sourceMessageId,
      subject: CompanionEventSubject.SHARED_EPISODE,
      subjectId: episode.id,
      eventType,
      state,
    });
  }

  private async supersedeConflictingMemories(memory: {
    id: string;
    userId: string;
    conversationId: string | null;
    category: MemoryCategory;
    memoryKey: string | null;
  }) {
    if (!memory.conversationId || !memory.memoryKey) return [];
    const conflicts = await this.prisma.memory.findMany({
      where: {
        userId: memory.userId,
        conversationId: memory.conversationId,
        status: MemoryStatus.CONFIRMED,
        id: { not: memory.id },
        memoryKey: memory.memoryKey,
      },
      select: { id: true, userId: true, sourceMessageId: true },
    });
    if (!conflicts.length) return conflicts;
    const now = new Date();
    await this.prisma.memory.updateMany({
      where: { id: { in: conflicts.map((conflict) => conflict.id) } },
      data: {
        status: MemoryStatus.ARCHIVED,
        archivedAt: now,
        supersededAt: now,
        supersededById: memory.id,
      },
    });
    return conflicts;
  }

  private recordSupersededMemories(
    memories: Array<{ id: string; userId: string; sourceMessageId: string | null }>,
    replacementId: string,
    conversationId: string | null,
  ) {
    return Promise.all(memories.map((memory) => this.timeline.record({
      userId: memory.userId,
      conversationId,
      sourceMessageId: memory.sourceMessageId,
      subject: CompanionEventSubject.MEMORY,
      subjectId: memory.id,
      eventType: 'memory.superseded',
      state: commitmentStateForMemory(MemoryStatus.ARCHIVED),
      detail: { replacementId },
    })));
  }

}
