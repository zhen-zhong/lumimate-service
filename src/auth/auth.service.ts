import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async createGuestSession() {
    const accessToken = `lmt_${randomBytes(32).toString('base64url')}`;
    const user = await this.prisma.user.create({ data: {} });
    const session = await this.prisma.apiSession.create({
      data: { userId: user.id, tokenHash: this.hashToken(accessToken) },
    });
    return { accessToken, userId: user.id, sessionId: session.id };
  }

  async authenticate(accessToken: string): Promise<AuthenticatedUser | null> {
    if (!/^lmt_[A-Za-z0-9_-]{32,}$/u.test(accessToken)) return null;
    const session = await this.prisma.apiSession.findUnique({
      where: { tokenHash: this.hashToken(accessToken) },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session || session.revokedAt) return null;
    void this.prisma.apiSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    }).catch(() => undefined);
    return { sessionId: session.id, userId: session.userId };
  }

  private hashToken(accessToken: string) {
    return createHash('sha256').update(accessToken).digest('hex');
  }
}
