import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { PrismaService } from '../database/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getHealth() {
    const redis = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await redis.connect();
      const [database, redisStatus] = await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        redis.ping(),
      ]);
      return { ok: true, database: Boolean(database), redis: redisStatus === 'PONG' };
    } finally {
      await redis.quit();
    }
  }
}
