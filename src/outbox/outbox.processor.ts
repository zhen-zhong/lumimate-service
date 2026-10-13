import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import type { Job, Queue } from 'bullmq';

import { PrismaService } from '../database/prisma.service';
import { MEMORY_EXTRACTION_QUEUE, type ExtractMemoryJob } from '../memory/memory.types';
import { AGENT_INTENT_QUEUE, type ExecuteIntentJob } from '../tasks/tasks.types';
import { PUSH_QUEUE, type PushJob } from '../push/push.types';
import { OUTBOX_QUEUE, OUTBOX_TOPIC_INTENT_SCHEDULE, OUTBOX_TOPIC_MEMORY_EXTRACT, OUTBOX_TOPIC_PUSH_RECEIPT, OUTBOX_TOPIC_PUSH_SEND, type OutboxJob } from './outbox.types';

@Processor(OUTBOX_QUEUE)
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AGENT_INTENT_QUEUE) private readonly intents: Queue<ExecuteIntentJob>,
    @InjectQueue(MEMORY_EXTRACTION_QUEUE) private readonly memories: Queue<ExtractMemoryJob>,
    @InjectQueue(PUSH_QUEUE) private readonly push: Queue<PushJob>,
  ) { super(); }

  async process(job: Job<OutboxJob>) {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: job.data.eventId } });
    if (!event || event.status === OutboxStatus.DELIVERED) return;
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: { id: event.id, status: { in: [OutboxStatus.PENDING, OutboxStatus.FAILED] } },
      data: { status: OutboxStatus.PROCESSING, processingAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    if (!claimed.count) return;
    try {
      const payload = event.payload as { intentId?: unknown; dueAt?: unknown; deliveryId?: unknown; delayMs?: unknown; userId?: unknown; conversationId?: unknown; sourceMessageId?: unknown; content?: unknown };
      if (event.topic === OUTBOX_TOPIC_INTENT_SCHEDULE) {
        if (typeof payload.intentId !== 'string' || typeof payload.dueAt !== 'string') throw new Error('提醒调度 Outbox 参数无效');
        const dueAt = new Date(payload.dueAt);
        if (Number.isNaN(dueAt.getTime())) throw new Error('提醒调度时间无效');
        const maxDelay = 2_147_483_647;
        await this.intents.add('execute-intent', { intentId: payload.intentId }, {
          jobId: `intent-${payload.intentId}`,
          delay: Math.min(Math.max(0, dueAt.getTime() - Date.now()), maxDelay),
          attempts: 3, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 1_000, removeOnFail: 1_000,
        });
      } else if (event.topic === OUTBOX_TOPIC_MEMORY_EXTRACT) {
        if (typeof payload.userId !== 'string' || typeof payload.conversationId !== 'string' || typeof payload.sourceMessageId !== 'string' || typeof payload.content !== 'string') {
          throw new Error('记忆提取 Outbox 参数无效');
        }
        await this.memories.add('extract', {
          userId: payload.userId,
          conversationId: payload.conversationId,
          sourceMessageId: payload.sourceMessageId,
          content: payload.content,
        }, {
          jobId: `extract-${payload.sourceMessageId}`,
          attempts: 3, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 1_000, removeOnFail: 1_000,
        });
      } else if (event.topic === OUTBOX_TOPIC_PUSH_SEND || event.topic === OUTBOX_TOPIC_PUSH_RECEIPT) {
        if (typeof payload.deliveryId !== 'string') throw new Error('推送 Outbox 参数无效');
        const isReceipt = event.topic === OUTBOX_TOPIC_PUSH_RECEIPT;
        await this.push.add(isReceipt ? 'check-push-receipt' : 'send-push', { type: isReceipt ? 'receipt' : 'send', deliveryId: payload.deliveryId }, {
          jobId: `${isReceipt ? 'push-receipt' : 'push-send'}-${payload.deliveryId}`,
          delay: isReceipt && typeof payload.delayMs === 'number' ? payload.delayMs : 0,
          attempts: isReceipt ? 6 : 3, backoff: { type: 'exponential', delay: isReceipt ? 5_000 : 1_000 }, removeOnComplete: 1_000, removeOnFail: 1_000,
        });
      } else throw new Error(`未知 Outbox topic：${event.topic}`);
      await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: OutboxStatus.DELIVERED, deliveredAt: new Date() } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbox 投递失败';
      await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: OutboxStatus.FAILED, lastError: message.slice(0, 500) } }).catch(() => undefined);
      this.logger.warn(message);
      throw error;
    }
  }
}
