import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentIntentType, AgentRunStatus, AgentToolPermission, CompanionEventSubject, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../database/prisma.service';
import { CompanionTimelineService } from '../companion/companion-timeline.service';
import { CompanionCommitmentState, commitmentStateForRun } from '../companion/companion-state';
import { type ReminderCandidate, TasksService } from '../tasks/tasks.service';

export const AGENT_TOOL_NAMES = {
  TASK_CREATE: 'task.create',
  TASK_CANCEL: 'task.cancel',
  TASK_LIST: 'task.list',
  TASK_UPDATE: 'task.update',
} as const;

type TaskCreateInput = {
  type: 'REMINDER';
  title: string;
  dueAt: string;
  timezone: string;
};

type TaskCancelInput = { intentId: string };
type TaskUpdateInput = { intentId: string; title?: string; dueAt?: string; timezone?: string };

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly timeline: CompanionTimelineService,
  ) {}

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
    const run = await this.prisma.agentRun.create({
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
    await this.recordRun(run, 'agent_run.proposed', undefined, CompanionCommitmentState.PROPOSED);
    await this.recordRun(run, 'agent_run.awaiting_confirmation');
    return run;
  }

  async list(conversationId: string) {
    return this.prisma.agentRun.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  listTasks(conversationId: string) {
    return this.tasks.list(conversationId);
  }

  hasTaskManagementIntent(content: string) {
    return /(?:查看|列出|有哪些|管理|修改|更改|改成|取消|删除).{0,16}(?:提醒|任务|闹钟)|(?:提醒|任务|闹钟).{0,16}(?:查看|列出|修改|更改|取消|删除)/u.test(content);
  }

  async prepareTaskTool(input: {
    userId: string;
    conversationId: string;
    sourceMessageId: string;
    tool: { name: 'task.list' | 'task.update' | 'task.cancel'; input: Record<string, unknown> };
    pluginVersionId?: string;
  }) {
    if (input.tool.name === AGENT_TOOL_NAMES.TASK_LIST) {
      const tasks = await this.tasks.list(input.conversationId);
      return { taskToolResult: tasks.length ? `当前任务：${tasks.map((task) => `${task.id} ${task.title}，${task.dueAt.toISOString()}，${task.status}`).join('；')}` : '当前没有提醒任务。' };
    }

    const intentId = input.tool.input.intentId;
    if (typeof intentId !== 'string' || !intentId) throw new BadRequestException('任务 ID 无效');
    const intent = await this.tasks.requireForTool(input.conversationId, intentId);
    const toolName = input.tool.name;
    const mutationInput = toolName === AGENT_TOOL_NAMES.TASK_CANCEL
      ? { intentId } satisfies TaskCancelInput
      : this.toUpdateInput(input.tool.input, intentId);
    const existing = await this.prisma.agentRun.findFirst({
      where: {
        sourceMessageId: input.sourceMessageId,
        toolName,
        status: { in: [AgentRunStatus.AWAITING_CONFIRMATION, AgentRunStatus.RUNNING, AgentRunStatus.COMPLETED] },
      },
    });
    const run = existing ?? await this.prisma.agentRun.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        toolName,
        permission: AgentToolPermission.WRITE,
        sourceMessageId: input.sourceMessageId,
        pluginVersionId: input.pluginVersionId,
        idempotencyKey: randomUUID(),
        input: mutationInput as Prisma.InputJsonValue,
      },
    });
    if (!existing) {
      await this.recordRun(run, 'agent_run.proposed', undefined, CompanionCommitmentState.PROPOSED);
      await this.recordRun(run, 'agent_run.awaiting_confirmation');
    }
    return { run, taskToolResult: toolName === AGENT_TOOL_NAMES.TASK_CANCEL ? `已识别到要取消的提醒“${intent.title}”，等待用户确认。` : `已识别到要修改的提醒“${intent.title}”，等待用户确认。` };
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
      await this.recordRun(current, 'agent_run.executing');
      const output = await this.execute(current.userId, current.conversationId, current.toolName, current.input);
      const completed = await this.prisma.agentRun.update({
        where: { id },
        data: { status: AgentRunStatus.COMPLETED, output: output as Prisma.InputJsonValue, completedAt: new Date() },
      });
      await this.recordRun(completed, 'agent_run.completed');
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : '工具执行失败';
      const failed = await this.prisma.agentRun.update({
        where: { id },
        data: { status: AgentRunStatus.FAILED, error: message },
      });
      await this.recordRun(failed, 'agent_run.failed', { error: message });
      throw error;
    }
  }

  async cancel(conversationId: string, id: string) {
    const run = await this.requireRun(conversationId, id);
    if (run.status !== AgentRunStatus.AWAITING_CONFIRMATION) return run;
    const cancelled = await this.prisma.agentRun.update({
      where: { id },
      data: { status: AgentRunStatus.CANCELLED, cancelledAt: new Date() },
    });
    await this.recordRun(cancelled, 'agent_run.cancelled');
    return cancelled;
  }

  private async execute(userId: string, conversationId: string, toolName: string, rawInput: unknown) {
    if (toolName === AGENT_TOOL_NAMES.TASK_CREATE && isTaskCreateInput(rawInput)) {
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
    if (toolName === AGENT_TOOL_NAMES.TASK_CANCEL && this.isCancelInput(rawInput)) {
      const intent = await this.tasks.cancel(conversationId, rawInput.intentId);
      return { intentId: intent.id, status: intent.status };
    }
    if (toolName === AGENT_TOOL_NAMES.TASK_UPDATE && this.isUpdateInput(rawInput)) {
      const intent = await this.tasks.update(conversationId, rawInput.intentId, {
        title: rawInput.title,
        dueAt: rawInput.dueAt ? new Date(rawInput.dueAt) : undefined,
        timezone: rawInput.timezone,
      });
      return { intentId: intent.id, status: intent.status, dueAt: intent.dueAt.toISOString() };
    }
    throw new Error('不支持或无效的工具调用');
  }

  private toUpdateInput(value: Record<string, unknown>, intentId: string): TaskUpdateInput {
    const input: TaskUpdateInput = { intentId };
    if (typeof value.title === 'string' && value.title.trim()) input.title = value.title.trim().slice(0, 500);
    if (typeof value.dueAt === 'string' && !Number.isNaN(new Date(value.dueAt).getTime())) input.dueAt = value.dueAt;
    if (typeof value.timezone === 'string' && value.timezone.trim()) input.timezone = value.timezone.trim().slice(0, 100);
    if (Object.keys(input).length === 1) throw new BadRequestException('未识别到需要修改的字段');
    return input;
  }

  private isCancelInput(value: unknown): value is TaskCancelInput {
    return Boolean(value && typeof value === 'object' && typeof (value as { intentId?: unknown }).intentId === 'string');
  }

  private isUpdateInput(value: unknown): value is TaskUpdateInput {
    return this.isCancelInput(value);
  }

  private async requireRun(conversationId: string, id: string) {
    const run = await this.prisma.agentRun.findFirst({ where: { id, conversationId } });
    if (!run) throw new NotFoundException('工具调用不存在');
    return run;
  }

  private recordRun(
    run: { id: string; userId: string; conversationId: string; sourceMessageId: string | null; status: AgentRunStatus; toolName: string },
    eventType: string,
    detail?: Prisma.InputJsonValue,
    state = commitmentStateForRun(run.status),
  ) {
    return this.timeline.record({
      userId: run.userId,
      conversationId: run.conversationId,
      sourceMessageId: run.sourceMessageId,
      subject: CompanionEventSubject.AGENT_RUN,
      subjectId: run.id,
      eventType,
      state,
      detail: detail ?? { toolName: run.toolName },
    });
  }
}
