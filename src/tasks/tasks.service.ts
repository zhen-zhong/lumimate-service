import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AgentIntentStatus, AgentIntentType, MessageRole, Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../database/prisma.service';
import { PushService } from '../push/push.service';
import type { CreateIntentDto } from './dto/create-intent.dto';
import type { UpdateIntentDto } from './dto/update-intent.dto';
import { AGENT_INTENT_QUEUE, type ExecuteIntentJob } from './tasks.types';

const MAX_SCHEDULE_DELAY = 2_147_483_647;
const REMINDER_ACTION = /(?:提醒(?:我|一下)?|别忘了|记得|叫(?:醒)?我|通知我|推送(?:给我|我)?|(?:给我|帮我)?(?:设|设置|设定|创建|定)(?:个|一个|一条)?(?:提醒|闹钟))/u;
const CLOCK_TIME = /(?:(上午|早上|清晨|中午|下午|傍晚|晚上|夜里|凌晨)\s*)?(\d{1,2})\s*(?:[:：]|点)\s*(\d{1,2})?/u;
const TERMINAL_INTENT_STATUSES: AgentIntentStatus[] = [
  AgentIntentStatus.COMPLETED,
  AgentIntentStatus.CANCELLED,
  AgentIntentStatus.EXPIRED,
];
const EDITABLE_INTENT_STATUSES: AgentIntentStatus[] = [
  AgentIntentStatus.AWAITING_CONFIRMATION,
  AgentIntentStatus.SCHEDULED,
];

function localDay(timezone: string, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

function localMinutes(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function parseMinutes(value?: string | null) {
  if (!value) return undefined;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function isQuietNow(timezone: string, start?: string | null, end?: string | null) {
  const startMinutes = parseMinutes(start);
  const endMinutes = parseMinutes(end);
  if (startMinutes === undefined || endMinutes === undefined || startMinutes === endMinutes) return false;
  const current = localMinutes(timezone);
  return startMinutes < endMinutes
    ? current >= startMinutes && current < endMinutes
    : current >= startMinutes || current < endMinutes;
}

function localDateParts(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function zonedDate(timezone: string, year: number, month: number, day: number, hour: number, minute: number) {
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(utc))
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return new Date(utc);
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1);
  return new Date(utc - minutes * 60_000);
}

function localDayAfter(timezone: string, days: number) {
  const today = localDateParts(timezone);
  return localDateParts(timezone, zonedDate(timezone, today.year, today.month, today.day + days, 12, 0));
}

function parseReminder(content: string, timezone: string) {
  if (!REMINDER_ACTION.test(content)) return null;
  const explicitDate = /(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/u.exec(content);
  const relativeDate = /(?:今天|今日|明天|明日|后天|(\d{1,3})\s*天后)/u.exec(content);
  const timeMatch = CLOCK_TIME.exec(content);
  if (!timeMatch) return null;
  const period = timeMatch[1];
  let hour = Number(timeMatch[2]);
  const minute = Number(timeMatch[3] ?? 0);
  if (['下午', '傍晚', '晚上', '夜里'].includes(period) && hour < 12) hour += 12;
  if (['凌晨', '早上', '清晨'].includes(period) && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const relativeText = relativeDate?.[0] ?? '';
  const relativeDays = relativeText === '明天' || relativeText === '明日'
    ? 1
    : relativeText === '后天'
      ? 2
      : relativeDate?.[1]
        ? Number(relativeDate[1])
        : 0;
  const date = explicitDate
    ? { year: Number(explicitDate[1]), month: Number(explicitDate[2]), day: Number(explicitDate[3]) }
    : relativeDate
      ? localDayAfter(timezone, relativeDays)
      : localDateParts(timezone);
  const dueAt = zonedDate(timezone, date.year, date.month, date.day, hour, minute);
  if (dueAt.getTime() <= Date.now()) return null;
  const title = content
    .replace(new RegExp(REMINDER_ACTION.source, 'gu'), '')
    .replace(explicitDate?.[0] ?? '', '')
    .replace(relativeText, '')
    .replace(timeMatch[0], '')
    .replace(/(?:请|帮我|给我|在|到|于|设置|设定|创建|定一个|定一条|一条|一个)/gu, ' ')
    .replace(/[，,。！!？?]/gu, ' ')
    .trim()
    .replace(/^(?:消息|信息)\s*/u, '');
  return title ? { title: title.slice(0, 500), dueAt } : null;
}

export type ReminderCandidate = NonNullable<ReturnType<typeof parseReminder>>;

@Injectable()
export class TasksService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    @InjectQueue(AGENT_INTENT_QUEUE) private readonly queue: Queue<ExecuteIntentJob>,
  ) {}

  async onModuleInit() {
    const scheduled = await this.prisma.agentIntent.findMany({
      where: { status: AgentIntentStatus.SCHEDULED },
      select: { id: true, dueAt: true },
    });
    await Promise.all(scheduled.map((intent) => this.enqueue(intent.id, intent.dueAt)));
  }

  async create(conversationId: string, userId: string, input: CreateIntentDto) {
    if (input.dueAt.getTime() <= Date.now()) throw new BadRequestException('任务时间必须晚于当前时间');
    this.assertTimeZone(input.timezone);
    return this.prisma.agentIntent.create({
      data: {
        conversationId,
        userId,
        type: input.type,
        title: input.title.trim(),
        dueAt: input.dueAt,
        timezone: input.timezone,
        payload: input.payload as Prisma.InputJsonValue | undefined,
        idempotencyKey: randomUUID(),
      },
    });
  }

  async list(conversationId: string) {
    return this.prisma.agentIntent.findMany({
      where: { conversationId },
      orderBy: { dueAt: 'asc' },
    });
  }

  getReminderCandidate(content: string, timezone = 'Asia/Shanghai') {
    this.assertTimeZone(timezone);
    return parseReminder(content, timezone);
  }

  hasReminderIntent(content: string) {
    return REMINDER_ACTION.test(content);
  }

  async createScheduled(conversationId: string, userId: string, input: CreateIntentDto) {
    if (input.dueAt.getTime() <= Date.now()) throw new BadRequestException('任务时间必须晚于当前时间');
    this.assertTimeZone(input.timezone);
    const scheduled = await this.prisma.agentIntent.create({
      data: {
        conversationId,
        userId,
        type: input.type,
        title: input.title.trim(),
        dueAt: input.dueAt,
        timezone: input.timezone,
        payload: input.payload as Prisma.InputJsonValue | undefined,
        idempotencyKey: randomUUID(),
        status: AgentIntentStatus.SCHEDULED,
        confirmedAt: new Date(),
      },
    });
    await this.enqueue(scheduled.id, scheduled.dueAt);
    return scheduled;
  }

  async confirm(conversationId: string, intentId: string) {
    const intent = await this.requireIntent(conversationId, intentId);
    if (intent.status !== AgentIntentStatus.AWAITING_CONFIRMATION) return intent;
    if (intent.dueAt.getTime() <= Date.now()) {
      return this.prisma.agentIntent.update({
        where: { id: intent.id },
        data: { status: AgentIntentStatus.EXPIRED, lastError: '确认时任务已过期' },
      });
    }
    const scheduled = await this.prisma.agentIntent.update({
      where: { id: intent.id },
      data: { status: AgentIntentStatus.SCHEDULED, confirmedAt: new Date() },
    });
    await this.enqueue(scheduled.id, scheduled.dueAt);
    return scheduled;
  }

  async update(conversationId: string, intentId: string, input: UpdateIntentDto) {
    if (input.title === undefined && input.dueAt === undefined && input.timezone === undefined && input.payload === undefined) {
      throw new BadRequestException('请提供需要修改的任务字段');
    }

    const intent = await this.requireIntent(conversationId, intentId);
    if (!EDITABLE_INTENT_STATUSES.includes(intent.status)) {
      throw new ConflictException('仅待确认或已安排的任务可以修改');
    }

    const title = input.title === undefined ? intent.title : input.title.trim();
    if (!title) throw new BadRequestException('任务内容不能为空');

    const timezone = input.timezone ?? intent.timezone;
    this.assertTimeZone(timezone);
    const dueAt = input.dueAt ?? intent.dueAt;
    if (dueAt.getTime() <= Date.now()) throw new BadRequestException('任务时间必须晚于当前时间');

    const wasScheduled = intent.status === AgentIntentStatus.SCHEDULED;
    if (wasScheduled) {
      await this.queue.remove(`intent-${intent.id}`);
    }

    try {
      const updated = await this.prisma.agentIntent.update({
        where: { id: intent.id },
        data: {
          title,
          dueAt,
          timezone,
          ...(input.payload === undefined ? {} : { payload: input.payload as Prisma.InputJsonValue }),
        },
      });

      if (updated.status === AgentIntentStatus.SCHEDULED) {
        await this.enqueue(updated.id, updated.dueAt);
      }
      return updated;
    } catch (error) {
      // Keep the original schedule alive when database or queue persistence fails.
      if (wasScheduled) await this.enqueue(intent.id, intent.dueAt).catch(() => undefined);
      throw error;
    }
  }

  async cancel(conversationId: string, intentId: string) {
    const intent = await this.requireIntent(conversationId, intentId);
    if (TERMINAL_INTENT_STATUSES.includes(intent.status)) return intent;
    await this.queue.remove(`intent-${intent.id}`);
    return this.prisma.agentIntent.update({
      where: { id: intent.id },
      data: { status: AgentIntentStatus.CANCELLED, cancelledAt: new Date() },
    });
  }

  async executeIntent(intentId: string) {
    const now = new Date();
    const claimed = await this.prisma.agentIntent.updateMany({
      where: { id: intentId, status: AgentIntentStatus.SCHEDULED, dueAt: { lte: now } },
      data: { status: AgentIntentStatus.RUNNING, startedAt: now },
    });
    if (claimed.count === 0) {
      // BullMQ delayed jobs cannot exceed about 24.8 days. Requeue long-term tasks
      // whenever their intermediate wake-up happens before their actual due time.
      const pending = await this.prisma.agentIntent.findUnique({
        where: { id: intentId },
        select: { status: true, dueAt: true },
      });
      if (pending?.status === AgentIntentStatus.SCHEDULED && pending.dueAt > now) {
        await this.enqueue(intentId, pending.dueAt);
      }
      return;
    }
    const intent = await this.prisma.agentIntent.findUniqueOrThrow({ where: { id: intentId } });
    try {
      if (intent.type === AgentIntentType.PROACTIVE) {
        const result = await this.checkProactivePolicy(intent.userId, intent.timezone);
        if (!result.allowed) {
          if (result.defer) {
            const dueAt = new Date(Date.now() + 15 * 60_000);
            await this.prisma.agentIntent.update({
              where: { id: intent.id },
              data: { status: AgentIntentStatus.SCHEDULED, dueAt, startedAt: null, lastError: result.reason },
            });
            await this.enqueue(intent.id, dueAt);
            return;
          }
          await this.prisma.agentIntent.update({
            where: { id: intent.id },
            data: { status: AgentIntentStatus.EXPIRED, failedAt: new Date(), lastError: result.reason },
          });
          return;
        }
      }
      await this.prisma.$transaction(async (transaction) => {
        if (intent.conversationId) {
          await transaction.message.create({
            data: {
              conversationId: intent.conversationId,
              role: MessageRole.ASSISTANT,
              content: intent.type === AgentIntentType.REMINDER ? `提醒你：${intent.title}` : intent.title,
              metadata: { intentId: intent.id, intentType: intent.type } as Prisma.InputJsonValue,
            },
          });
        }
        await transaction.agentIntent.update({
          where: { id: intent.id },
          data: { status: AgentIntentStatus.COMPLETED, completedAt: new Date(), lastError: null },
        });
        if (intent.type === AgentIntentType.PROACTIVE) {
          const policy = await transaction.proactivePolicy.findUniqueOrThrow({ where: { userId: intent.userId } });
          const today = localDay(intent.timezone);
          await transaction.proactivePolicy.update({
            where: { userId: intent.userId },
            data: {
              lastProactiveAt: new Date(),
              dailyUsageDate: today,
              dailyUsageCount: policy.dailyUsageDate === today ? { increment: 1 } : 1,
            },
          });
        }
      });
      try {
        await this.push.enqueueIntent(intent);
      } catch {
        // A push failure must not undo a completed reminder or assistant message.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '任务执行失败';
      await this.prisma.agentIntent.update({
        where: { id: intent.id },
        data: { status: AgentIntentStatus.FAILED, failedAt: new Date(), lastError: message },
      });
      throw error;
    }
  }

  private async enqueue(intentId: string, dueAt: Date) {
    const delay = Math.max(0, dueAt.getTime() - Date.now());
    if (delay > MAX_SCHEDULE_DELAY) {
      await this.queue.add('execute-intent', { intentId }, {
        jobId: `intent-${intentId}`,
        delay: MAX_SCHEDULE_DELAY,
        removeOnComplete: 1_000,
        removeOnFail: 1_000,
      });
      return;
    }
    await this.queue.add('execute-intent', { intentId }, {
      jobId: `intent-${intentId}`,
      delay,
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  }

  private async requireIntent(conversationId: string, intentId: string) {
    const intent = await this.prisma.agentIntent.findFirst({ where: { id: intentId, conversationId } });
    if (!intent) throw new NotFoundException('任务不存在');
    return intent;
  }

  private assertTimeZone(timezone: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException('无效时区');
    }
  }

  private async checkProactivePolicy(userId: string, timezone: string) {
    const policy = await this.prisma.proactivePolicy.upsert({ where: { userId }, update: {}, create: { userId } });
    if (!policy.enabled) return { allowed: false, defer: false, reason: '用户未授权主动陪伴' };
    if (isQuietNow(timezone, policy.quietHoursStart, policy.quietHoursEnd)) return { allowed: false, defer: true, reason: '当前处于静默时间' };
    const today = localDay(timezone);
    const todayCount = policy.dailyUsageDate === today ? policy.dailyUsageCount : 0;
    if (todayCount >= policy.dailyLimit) return { allowed: false, defer: false, reason: '已达到每日主动消息上限' };
    if (policy.lastProactiveAt && Date.now() - policy.lastProactiveAt.getTime() < policy.minimumIntervalMinutes * 60_000) {
      return { allowed: false, defer: true, reason: '未达到主动消息最短间隔' };
    }
    return { allowed: true, defer: false, reason: null };
  }
}
