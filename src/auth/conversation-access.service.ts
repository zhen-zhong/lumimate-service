import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ConversationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(userId: string, conversationReference: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        userId,
        OR: [{ id: conversationReference }, { externalId: conversationReference }],
      },
      select: { id: true, externalId: true, userId: true },
    });
    if (existing) return existing;

    // A guest receives a fresh API identity before opening any conversation.
    // Task, push, and media routes may be the first request for that identity,
    // so create its external conversation atomically instead of returning 404.
    return this.prisma.conversation.upsert({
      where: { userId_externalId: { userId, externalId: conversationReference } },
      create: { userId, externalId: conversationReference },
      update: {},
      select: { id: true, externalId: true, userId: true },
    });
  }
}
