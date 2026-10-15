import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentIntentType, CompanionEventSubject, Prisma, PushDeliveryStatus, PushPlatform } from '@prisma/client';
import { request } from 'undici';

import { PrismaService } from '../database/prisma.service';
import { CompanionTimelineService } from '../companion/companion-timeline.service';
import { commitmentStateForPush } from '../companion/companion-state';
import { OutboxService } from '../outbox/outbox.service';
import { OUTBOX_TOPIC_PUSH_RECEIPT, OUTBOX_TOPIC_PUSH_SEND } from '../outbox/outbox.types';
import type { RegisterPushDeviceDto } from './dto/register-push-device.dto';

const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const PUSH_RECEIPT_DELAY_MS = 15 * 60_000;

type ExpoPushError = {
  message?: string;
  details?: { error?: string };
};

type ExpoPushTicket = ExpoPushError & {
  status?: 'ok' | 'error';
  id?: string;
};

type ExpoPushReceipt = ExpoPushError & {
  status?: 'ok' | 'error';
};

type IntentPushInput = {
  id: string;
  userId: string;
  conversationId: string | null;
  type: AgentIntentType;
  title: string;
};

type StagedPushDelivery = {
  delivery: { id: string };
  outbox: { id: string };
};

function errorMessage(value: unknown, fallback: string) {
  if (value instanceof Error && value.message) return value.message;
  return fallback;
}

function isDeviceNotRegistered(error?: ExpoPushError) {
  return error?.details?.error === 'DeviceNotRegistered';
}

@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly timeline: CompanionTimelineService,
    private readonly outbox: OutboxService,
  ) {}

  async listDevices(userId: string) {
    return this.prisma.pushDevice.findMany({
      where: { userId },
      select: { id: true, platform: true, enabled: true, lastSeenAt: true, createdAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async registerDevice(userId: string, input: RegisterPushDeviceDto) {
    const existing = await this.prisma.pushDevice.findUnique({
      where: { expoPushToken: input.expoPushToken },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId !== userId) {
      throw new ConflictException('该推送设备已绑定到其他账户');
    }
    return this.prisma.pushDevice.upsert({
      where: { expoPushToken: input.expoPushToken },
      update: {
        platform: input.platform === 'ios' ? PushPlatform.IOS : PushPlatform.ANDROID,
        enabled: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        expoPushToken: input.expoPushToken,
        platform: input.platform === 'ios' ? PushPlatform.IOS : PushPlatform.ANDROID,
      },
      select: { id: true, platform: true, enabled: true, lastSeenAt: true, createdAt: true },
    });
  }

  async disableDevice(userId: string, expoPushToken: string) {
    await this.prisma.pushDevice.updateMany({
      where: { userId, expoPushToken },
      data: { enabled: false, lastSeenAt: new Date() },
    });
  }

  async retryDelivery(userId: string, conversationId: string, deliveryId: string) {
    const { queued, outbox } = await this.prisma.$transaction(async (transaction) => {
      const delivery = await transaction.pushDelivery.findFirst({
        where: { id: deliveryId, userId, conversationId },
        include: { device: { select: { enabled: true } } },
      });
      if (!delivery) throw new NotFoundException('推送记录不存在');
      if (delivery.status !== PushDeliveryStatus.FAILED) throw new ConflictException('仅失败的推送可以重试');
      if (!delivery.device.enabled) throw new ConflictException('推送设备已停用，请重新开启通知后再试');
      const queued = await transaction.pushDelivery.update({
        where: { id: delivery.id },
        data: {
          status: PushDeliveryStatus.QUEUED,
          expoTicketId: null,
          failedAt: null,
          error: null,
        },
      });
      const outbox = await this.outbox.create(transaction, {
        topic: OUTBOX_TOPIC_PUSH_SEND,
        dedupKey: `push-send:${delivery.id}:retry:${delivery.attemptCount + 1}`,
        payload: { deliveryId: delivery.id },
      });
      return { queued, outbox };
    });
    await this.recordDelivery(queued, 'push.queued', { intentId: queued.intentId, title: queued.title, retry: true });
    await this.outbox.publish(outbox.id).catch(() => undefined);
    return queued;
  }

  async enqueueIntent(input: IntentPushInput) {
    const queued = await this.prisma.$transaction((transaction) => this.stageIntentDeliveries(transaction, input));
    await this.publishStagedIntent(input, queued);
  }

  async stageIntentDeliveries(transaction: Prisma.TransactionClient, input: IntentPushInput): Promise<StagedPushDelivery[]> {
    if (!input.conversationId) return [];
    const devices = await transaction.pushDevice.findMany({
      where: { userId: input.userId, enabled: true },
      select: { id: true },
    });
    if (!devices.length) return [];

    const title = input.type === AgentIntentType.REMINDER ? 'LumiMate 提醒' : 'LumiMate';
    const body = input.type === AgentIntentType.REMINDER ? `提醒你：${input.title}` : input.title;
    return Promise.all(devices.map(async (device) => {
      const delivery = await transaction.pushDelivery.create({
        data: {
          deviceId: device.id,
          userId: input.userId,
          conversationId: input.conversationId!,
          intentId: input.id,
          type: input.type,
          title: title.slice(0, 120),
          body: body.slice(0, 500),
        },
        select: { id: true },
      });
      const outbox = await this.outbox.create(transaction, {
        topic: OUTBOX_TOPIC_PUSH_SEND,
        dedupKey: `push-send:${delivery.id}`,
        payload: { deliveryId: delivery.id },
      });
      return { delivery, outbox };
    }));
  }

  async publishStagedIntent(input: IntentPushInput, queued: StagedPushDelivery[]) {
    await Promise.all(queued.map(({ delivery }) => this.timeline.record({
      userId: input.userId,
      conversationId: input.conversationId,
      subject: CompanionEventSubject.PUSH_DELIVERY,
      subjectId: delivery.id,
      eventType: 'push.queued',
      state: commitmentStateForPush(PushDeliveryStatus.QUEUED),
      detail: { intentId: input.id, title: input.title },
    })));
    await Promise.all(queued.map(({ outbox }) => this.outbox.publish(outbox.id)));
  }

  async sendDelivery(deliveryId: string) {
    const delivery = await this.prisma.pushDelivery.findUnique({
      where: { id: deliveryId },
      include: { device: true },
    });
    if (!delivery || delivery.status !== PushDeliveryStatus.QUEUED) return;
    if (!delivery.device.enabled) {
      const cancelled = await this.prisma.pushDelivery.update({
        where: { id: delivery.id },
        data: { status: PushDeliveryStatus.CANCELLED, error: '设备已停用' },
      });
      await this.recordDelivery(cancelled, 'push.cancelled');
      return;
    }

    await this.prisma.pushDelivery.update({
      where: { id: delivery.id },
      data: { attemptCount: { increment: 1 }, error: null },
    });

    const response = await this.expoRequest(EXPO_PUSH_SEND_URL, [{
      to: delivery.device.expoPushToken,
      title: delivery.title,
      body: delivery.body,
      sound: 'default',
      priority: 'high',
      channelId: 'reminders',
      data: {
        url: `lumimate://companion/${delivery.conversationId}`,
        conversationId: delivery.conversationId,
        intentId: delivery.intentId,
        deliveryId: delivery.id,
      },
    }]);
    const ticket = Array.isArray(response.data) ? response.data[0] as ExpoPushTicket | undefined : undefined;
    if (!ticket || ticket.status !== 'ok' || !ticket.id) {
      await this.failFromExpo(delivery.id, delivery.deviceId, ticket, 'Expo 未接收推送请求');
      return;
    }
    const { sent, outbox } = await this.prisma.$transaction(async (transaction) => {
      const sent = await transaction.pushDelivery.update({
        where: { id: delivery.id },
        data: { status: PushDeliveryStatus.SENT, expoTicketId: ticket.id, sentAt: new Date(), error: null },
      });
      const outbox = await this.outbox.create(transaction, {
        topic: OUTBOX_TOPIC_PUSH_RECEIPT,
        dedupKey: `push-receipt:${delivery.id}:${ticket.id}`,
        payload: { deliveryId: delivery.id, delayMs: PUSH_RECEIPT_DELAY_MS },
      });
      return { sent, outbox };
    });
    await this.recordDelivery(sent, 'push.sent');
    await this.outbox.publish(outbox.id);
  }

  async checkReceipt(deliveryId: string) {
    const delivery = await this.prisma.pushDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== PushDeliveryStatus.SENT || !delivery.expoTicketId) return;
    const response = await this.expoRequest(EXPO_PUSH_RECEIPTS_URL, { ids: [delivery.expoTicketId] });
    const receipts = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
      ? response.data as Record<string, ExpoPushReceipt>
      : {};
    const receipt = receipts[delivery.expoTicketId];
    if (!receipt) throw new Error('Expo 回执尚未就绪');
    if (receipt.status === 'ok') {
      const delivered = await this.prisma.pushDelivery.update({
        where: { id: delivery.id },
        data: { status: PushDeliveryStatus.DELIVERED, deliveredAt: new Date(), error: null },
      });
      await this.recordDelivery(delivered, 'push.delivered');
      return;
    }
    await this.failFromExpo(delivery.id, delivery.deviceId, receipt, '推送未被设备服务接收');
  }

  async markDeliveryFailed(deliveryId: string, error: unknown) {
    const failed = await this.prisma.pushDelivery.updateMany({
      where: { id: deliveryId, status: PushDeliveryStatus.QUEUED },
      data: { status: PushDeliveryStatus.FAILED, failedAt: new Date(), error: errorMessage(error, '推送请求失败') },
    });
    if (failed.count) {
      const delivery = await this.prisma.pushDelivery.findUnique({ where: { id: deliveryId } });
      if (delivery) await this.recordDelivery(delivery, 'push.failed', { reason: errorMessage(error, '推送请求失败') });
    }
  }

  private async failFromExpo(
    deliveryId: string,
    deviceId: string,
    expoError: ExpoPushError | undefined,
    fallback: string,
  ) {
    const failed = await this.prisma.pushDelivery.update({
      where: { id: deliveryId },
      data: {
        status: PushDeliveryStatus.FAILED,
        failedAt: new Date(),
        error: expoError?.message ?? fallback,
      },
    });
    await this.recordDelivery(failed, 'push.failed', { reason: expoError?.message ?? fallback });
    if (isDeviceNotRegistered(expoError)) {
      await this.prisma.pushDevice.update({ where: { id: deviceId }, data: { enabled: false } });
    }
  }

  private async expoRequest(url: string, body: unknown): Promise<{ data?: unknown }> {
    const accessToken = this.config.get<string>('EXPO_PUSH_ACCESS_TOKEN')?.trim();
    const response = await request(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.body.json() as { data?: unknown; errors?: ExpoPushError[] };
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(payload.errors?.[0]?.message ?? `Expo Push 请求失败（HTTP ${response.statusCode}）`);
    }
    return payload;
  }

  private recordDelivery(
    delivery: { id: string; userId: string; conversationId: string; status: PushDeliveryStatus; intentId: string | null; title: string },
    eventType: string,
    detail?: Record<string, unknown>,
  ) {
    return this.timeline.record({
      userId: delivery.userId,
      conversationId: delivery.conversationId,
      subject: CompanionEventSubject.PUSH_DELIVERY,
      subjectId: delivery.id,
      eventType,
      state: commitmentStateForPush(delivery.status),
      detail: (detail ?? (delivery.intentId ? { intentId: delivery.intentId, title: delivery.title } : undefined)) as Prisma.InputJsonValue | undefined,
    });
  }
}
