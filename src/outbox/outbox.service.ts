import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { OutboxStatus, Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';

import { PrismaService } from '../database/prisma.service';
import { OUTBOX_QUEUE, type OutboxJob } from './outbox.types';

@Injectable()
export class OutboxService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(OUTBOX_QUEUE) private readonly queue: Queue<OutboxJob>,
  ) {}

  async onModuleInit() {
    await this.prisma.outboxEvent.updateMany({
      where: {
        status: OutboxStatus.PROCESSING,
        processingAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
      data: { status: OutboxStatus.PENDING, processingAt: null, lastError: '投递进程中断，等待恢复' },
    });
    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] } },
      select: { id: true },
      take: 1_000,
    });
    await Promise.all(pending.map((event) => this.publish(event.id)));
  }

  async create(
    transaction: Prisma.TransactionClient,
    input: { topic: string; dedupKey: string; payload: Prisma.InputJsonValue },
  ) {
    return transaction.outboxEvent.upsert({
      where: { dedupKey: input.dedupKey },
      update: { payload: input.payload, status: OutboxStatus.PENDING, availableAt: new Date(), lastError: null },
      create: input,
      select: { id: true },
    });
  }

  async publish(eventId: string) {
    const jobId = `outbox-${eventId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed' || state === 'completed') await existing.remove();
      else return existing;
    }
    return this.queue.add('dispatch', { eventId }, {
      jobId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    });
  }
}
