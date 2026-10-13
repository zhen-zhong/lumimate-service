import { Injectable } from '@nestjs/common';
import { CompanionEventSubject, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

type TimelineWriter = Pick<PrismaService, 'companionEvent'> | Prisma.TransactionClient;

export type CompanionTimelineEvent = {
  userId: string;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  subject: CompanionEventSubject;
  subjectId: string;
  eventType: string;
  state: string;
  detail?: Prisma.InputJsonValue;
};

@Injectable()
export class CompanionTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: CompanionTimelineEvent) {
    return this.recordWith(this.prisma, input);
  }

  recordWith(writer: TimelineWriter, input: CompanionTimelineEvent) {
    return writer.companionEvent.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId ?? undefined,
        sourceMessageId: input.sourceMessageId ?? undefined,
        subject: input.subject,
        subjectId: input.subjectId,
        eventType: input.eventType,
        state: input.state,
        detail: input.detail,
      },
    });
  }

  list(userId: string, conversationId: string, take = 100) {
    return this.prisma.companionEvent.findMany({
      where: { userId, conversationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
    });
  }
}
