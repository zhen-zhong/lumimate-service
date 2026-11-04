import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

const RECENT_INTERACTION_WINDOW_MS = 30 * 60 * 1_000;
const RECENT_EVENT_LIMIT = 6;

const IDLE_PRESENCE = {
  activityKey: 'idle',
  activityLabel: '现在空闲',
  nextPlan: '等你下次来聊天',
  source: 'SYSTEM_DEFAULT',
} as const;

type PresenceRecord = {
  activityKey: string;
  activityLabel: string;
  nextPlan: string | null;
  source: string;
  lastActivityAt: Date;
  expiresAt: Date | null;
};

@Injectable()
export class CompanionPresenceService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(userId: string, conversationId: string) {
    const [presence, events] = await Promise.all([
      this.prisma.companionPresence.findFirst({
        where: { userId, conversationId },
        select: {
          activityKey: true,
          activityLabel: true,
          nextPlan: true,
          source: true,
          lastActivityAt: true,
          expiresAt: true,
        },
      }),
      this.prisma.companionLifeEvent.findMany({
        where: { userId, conversationId },
        orderBy: { occurredAt: 'desc' },
        take: RECENT_EVENT_LIMIT,
        select: { id: true, eventType: true, content: true, truth: true, occurredAt: true },
      }),
    ]);
    const resolved = this.resolvePresence(presence, new Date());
    return { ...resolved, recentEvents: events };
  }

  async buildAgentContext(userId: string, conversationId: string) {
    const presence = await this.snapshot(userId, conversationId);
    return [
      '陪伴状态（系统记录的虚拟状态，不是现实生活或后台持续活动）：',
      `- 当前：${presence.activityLabel}`,
      presence.nextPlan ? `- 下一步：${presence.nextPlan}` : null,
      '只能依据以上已记录状态回答“在做什么”；状态为空闲时，直接说明空闲。不得编造未记录的经历、感受、地点或持续进行的活动。',
    ].filter(Boolean).join('\n');
  }

  async recordCompletedConversation(input: { userId: string; conversationId: string; sourceMessageId: string }) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RECENT_INTERACTION_WINDOW_MS);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.companionPresence.upsert({
        where: { conversationId: input.conversationId },
        create: {
          userId: input.userId,
          conversationId: input.conversationId,
          activityKey: 'recent_conversation',
          activityLabel: '刚和你聊过天',
          nextPlan: '等你下次来聊天',
          source: 'CHAT_COMPLETED',
          lastActivityAt: now,
          expiresAt,
        },
        update: {
          activityKey: 'recent_conversation',
          activityLabel: '刚和你聊过天',
          nextPlan: '等你下次来聊天',
          source: 'CHAT_COMPLETED',
          lastActivityAt: now,
          expiresAt,
        },
      });
      await transaction.companionLifeEvent.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          sourceMessageId: input.sourceMessageId,
          eventType: 'conversation.completed',
          content: '完成了一次与你的对话',
          truth: 'SYSTEM',
          occurredAt: now,
        },
      });
    });
  }

  private resolvePresence(presence: PresenceRecord | null, now: Date) {
    if (!presence || (presence.expiresAt && presence.expiresAt <= now)) {
      return { ...IDLE_PRESENCE, lastActivityAt: presence?.lastActivityAt ?? null, expiresAt: null };
    }
    return presence;
  }
}
