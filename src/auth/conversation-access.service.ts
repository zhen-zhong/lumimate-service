import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ConversationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(userId: string, conversationReference: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        userId,
        OR: [{ id: conversationReference }, { externalId: conversationReference }],
      },
      select: { id: true, externalId: true, userId: true },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    return conversation;
  }
}
