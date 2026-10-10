import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentIntentType, AgentRunStatus, AgentToolPermission, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../database/prisma.service';
import { type ReminderCandidate, TasksService } from '../tasks/tasks.service';

export const AGENT_TOOL_NAMES = {
  TASK_CREATE: 'task.create',
  TASK_CANCEL: 'task.cancel',
  TASK_LIST: 'task.list',
} as const;

type TaskCreateInput = {
  type: 'REMINDER';
  title: string;
  dueAt: string;
  timezone: string;
};

function isTaskCreateInput(value: unknown): value is TaskCreateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return input.type === AgentIntentType.REMINDER &&
    typeof input.title === 'string' &&
    typeof input.dueAt === 'string' &&
    typeof input.timezone === 'string';
}

@Injectable()
export class AgentToolService {
  constructor(private readonly prisma: PrismaService, private readonly tasks: TasksService) {}

  async proposeReminder(input: {
    userId: string;
    conversationId: string;
    sourceMessageId: string;
    content: string;
    timezone?: string;
    pluginVersionId?: string;
    candidate?: ReminderCandidate | null;
  }) {
    const timezone = input.timezone ?? 'Asia/Shanghai';
    const candidate = input.candidate ?? this.tasks.getReminderCandidate(input.content, timezone);
    if (!candidate) return null;
    const existing = await this.prisma.agentRun.findFirst({
      where: {
        sourceMessageId: input.sourceMessageId,
        pluginVersionId: input.pluginVersionId,
        toolName: AGENT_TOOL_NAMES.TASK_CREATE,
        status: { in: [AgentRunStatus.AWAITING_CONFIRMATION, AgentRunStatus.RUNNING, AgentRunStatus.COMPLETED] },
      },
    });
    if (existing) return existing;
    return this.prisma.agentRun.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        toolName: AGENT_TOOL_NAMES.TASK_CREATE,
        permission: AgentToolPermission.WRITE,
        sourceMessageId: input.sourceMessageId,
        pluginVersionId: input.pluginVersionId,
        idempotencyKey: randomUUID(),
        input: {
          type: AgentIntentType.REMINDER,
          title: candidate.title,
          dueAt: candidate.dueAt.toISOString(),
          timezone,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async list(conversationId: string) {
    return this.prisma.agentRun.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  getReminderCandidate(content: string, timezone = 'Asia/Shanghai') {
    return this.tasks.getReminderCandidate(content, timezone);
  }

  hasReminderIntent(content: string) {
    return this.tasks.hasReminderIntent(content);
  }

  async confirm(conversationId: string, id: string) {
    const run = await this.requireRun(conversationId, id);
    if (run.status === AgentRunStatus.COMPLETED) return run;
    if (run.status !== AgentRunStatus.AWAITING_CONFIRMATION && run.status !== AgentRunStatus.FAILED) {
      throw new ConflictException('此提醒无法确认，请重新创建');
    }
    const claimed = await this.prisma.agentRun.updateMany({
      where: { id, conversationId, status: { in: [AgentRunStatus.AWAITING_CONFIRMATION, AgentRunStatus.FAILED] } },
      data: { status: AgentRunStatus.RUNNING, confirmedAt: new Date(), startedAt: new Date(), error: null },
    });
    if (!claimed.count) {
      const current = await this.requireRun(conversationId, id);
      if (current.status === AgentRunStatus.COMPLETED) return current;
      throw new ConflictException('此提醒状态已变化，请重新创建');
    }

    try {
      const current = await this.prisma.agentRun.findUniqueOrThrow({ where: { id } });
      const output = await this.execute(current.userId, current.conversationId, current.toolName, current.input);
      return this.prisma.agentRun.update({
        where: { id },
        data: { status: AgentRunStatus.COMPLETED, output: output as Prisma.InputJsonValue, completedAt: new Date() },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '工具执行失败';
      await this.prisma.agentRun.update({
        where: { id },
        data: { status: AgentRunStatus.FAILED, error: message },
      });
      throw error;
    }
  }

  async cancel(conversationId: string, id: string) {
    const run = await this.requireRun(conversationId, id);
    if (run.status !== AgentRunStatus.AWAITING_CONFIRMATION) return run;
    return this.prisma.agentRun.update({
      where: { id },
      data: { status: AgentRunStatus.CANCELLED, cancelledAt: new Date() },
    });
  }

  private async execute(userId: string, conversationId: string, toolName: string, rawInput: unknown) {
    if (toolName !== AGENT_TOOL_NAMES.TASK_CREATE || !isTaskCreateInput(rawInput)) {
      throw new Error('不支持或无效的工具调用');
    }
    const dueAt = new Date(rawInput.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new Error('提醒时间无效');
    const intent = await this.tasks.createScheduled(conversationId, userId, {
      type: rawInput.type,
      title: rawInput.title,
      dueAt,
      timezone: rawInput.timezone,
    });
    return { intentId: intent.id, status: intent.status, dueAt: intent.dueAt.toISOString() };
  }

  private async requireRun(conversationId: string, id: string) {
    const run = await this.prisma.agentRun.findFirst({ where: { id, conversationId } });
    if (!run) throw new NotFoundException('工具调用不存在');
    return run;
  }
}
