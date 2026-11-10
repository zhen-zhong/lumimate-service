import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryCategory, MemoryStatus } from '@prisma/client';

import { CompanionTimelineService } from '../companion/companion-timeline.service';
import { PrismaService } from '../database/prisma.service';
import { extractRuleMemoryCandidates, MemoryService } from './memory.service';

test('为姓名、居住地和工作地提取不同的稳定键', () => {
  const candidates = [
    ...extractRuleMemoryCandidates('我叫小林'),
    ...extractRuleMemoryCandidates('我住在上海。'),
    ...extractRuleMemoryCandidates('我在杭州上班'),
  ];

  assert.deepEqual(candidates.map((candidate) => [candidate.content, candidate.memoryKey]), [
    ['小林', 'relationship:preferred_name'],
    ['上海', 'place:residence'],
    ['杭州', 'place:work_or_study'],
  ]);
});

test('确认新记忆时只归档同一稳定键的旧记忆', async () => {
  const candidate = {
    id: 'new-name',
    userId: 'user-1',
    conversationId: 'conversation-1',
    category: MemoryCategory.RELATIONSHIP,
    status: MemoryStatus.CANDIDATE,
    memoryKey: 'relationship:preferred_name',
    sourceMessageId: 'message-2',
  };
  const archived = {
    id: 'old-name',
    userId: 'user-1',
    sourceMessageId: 'message-1',
  };
  const updateManyCalls: unknown[] = [];
  const conflictQueries: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const prisma = {
    memory: {
      findFirst: async () => candidate,
      update: async () => ({ ...candidate, status: MemoryStatus.CONFIRMED }),
      findMany: async (input: { where: Record<string, unknown> }) => {
        conflictQueries.push(input.where);
        return [archived];
      },
      updateMany: async (input: unknown) => {
        updateManyCalls.push(input);
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;
  const timeline = {
    record: async (event: Record<string, unknown>) => {
      events.push(event);
      return event;
    },
  } as unknown as CompanionTimelineService;

  await new MemoryService(prisma, timeline).confirm('conversation-1', candidate.id);

  assert.deepEqual(conflictQueries[0]?.memoryKey, 'relationship:preferred_name');
  assert.equal('category' in (conflictQueries[0] ?? {}), false);
  assert.equal(updateManyCalls.length, 1);
  const archiveUpdate = updateManyCalls[0] as { data: { status: MemoryStatus; supersededById: string } };
  assert.equal(archiveUpdate.data.status, MemoryStatus.ARCHIVED);
  assert.equal(archiveUpdate.data.supersededById, candidate.id);
  assert.equal(events.some((event) => event.eventType === 'memory.superseded'), true);
});

test('构建模型上下文时只查询已确认记忆', async () => {
  const memoryQueries: Array<Record<string, unknown>> = [];
  const prisma = {
    memory: {
      findMany: async (input: { where: Record<string, unknown> }) => {
        memoryQueries.push(input.where);
        return [];
      },
    },
    relationship: {
      upsert: async () => ({ preferredName: null, relationshipSummary: '', communicationStyle: '' }),
    },
    sharedEpisode: {
      findMany: async () => [],
    },
  } as unknown as PrismaService;

  await new MemoryService(prisma, {} as CompanionTimelineService).buildAgentContext({
    userId: 'user-1',
    conversationId: 'conversation-1',
    query: '你好',
  });

  assert.equal(memoryQueries[0]?.status, MemoryStatus.CONFIRMED);
  assert.equal(memoryQueries[0]?.layer, 'USER_FACT');
});

test('共同经历只接受本会话来源，并支持归档和删除审计', async () => {
  const events: Array<Record<string, unknown>> = [];
  const created: Array<Record<string, unknown>> = [];
  const episode = {
    id: 'episode-1',
    userId: 'user-1',
    conversationId: 'conversation-1',
    sourceMessageId: 'message-1',
    title: '雨天散步',
    content: '一起聊了下雨天想做的事',
  };
  const prisma = {
    message: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => (
        where.id === 'message-1' && where.conversationId === 'conversation-1' ? { id: 'message-1' } : null
      ),
    },
    sharedEpisode: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { ...episode, ...data };
      },
      findFirst: async () => episode,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...episode, ...data }),
    },
  } as unknown as PrismaService;
  const timeline = {
    record: async (event: Record<string, unknown>) => {
      events.push(event);
      return event;
    },
  } as unknown as CompanionTimelineService;
  const service = new MemoryService(prisma, timeline);

  await service.createEpisode('user-1', 'conversation-1', {
    title: ' 雨天散步 ',
    content: ' 一起聊了下雨天想做的事 ',
    sourceMessageId: 'message-1',
  });
  await service.archiveEpisode('conversation-1', episode.id);
  await service.removeEpisode('conversation-1', episode.id);

  assert.equal(created[0]?.title, '雨天散步');
  assert.equal(created[0]?.content, '一起聊了下雨天想做的事');
  assert.equal(events.map((event) => event.eventType).join(','), 'shared_episode.created,shared_episode.archived,shared_episode.deleted');
  assert.equal(events.every((event) => event.subject === 'SHARED_EPISODE'), true);
});
