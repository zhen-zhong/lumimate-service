import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentIntentType, PushDeliveryStatus, PushPlatform } from '@prisma/client';
import type { Queue } from 'bullmq';
import { request } from 'undici';

import { PrismaService } from '../database/prisma.service';
import type { RegisterPushDeviceDto } from './dto/register-push-device.dto';
import { PUSH_QUEUE, type PushJob } from './push.types';

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
    @InjectQueue(PUSH_QUEUE) private readonly queue: Queue<PushJob>,
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

  async enqueueIntent(input: {
    id: string;
    userId: string;
    conversationId: string | null;
    type: AgentIntentType;
    title: string;
  }) {
    if (!input.conversationId) return;
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: input.userId, enabled: true },
      select: { id: true },
    });
    if (!devices.length) return;

    const title = input.type === AgentIntentType.REMINDER ? 'LumiMate 提醒' : 'LumiMate';
    const body = input.type === AgentIntentType.REMINDER ? `提醒你：${input.title}` : input.title;
    const deliveries = await this.prisma.$transaction(
      devices.map((device) => this.prisma.pushDelivery.create({
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
      })),
    );
    await Promise.all(deliveries.map((delivery) => this.queue.add('send-push', {
      type: 'send', deliveryId: delivery.id,
    }, {
      jobId: `push:send:${delivery.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    })));
  }

  async sendDelivery(deliveryId: string) {
    const delivery = await this.prisma.pushDelivery.findUnique({
      where: { id: deliveryId },
      include: { device: true },
    });
    if (!delivery || delivery.status !== PushDeliveryStatus.QUEUED) return;
    if (!delivery.device.enabled) {
      await this.prisma.pushDelivery.update({
        where: { id: delivery.id },
        data: { status: PushDeliveryStatus.CANCELLED, error: '设备已停用' },
      });
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
    await this.prisma.pushDelivery.update({
      where: { id: delivery.id },
      data: { status: PushDeliveryStatus.SENT, expoTicketId: ticket.id, sentAt: new Date(), error: null },
    });
    await this.queue.add('check-push-receipt', { type: 'receipt', deliveryId: delivery.id }, {
      jobId: `push:receipt:${delivery.id}`,
      delay: PUSH_RECEIPT_DELAY_MS,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    });
  }

  async checkReceipt(deliveryId: string) {
    const delivery = await this.prisma.pushDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== PushDeliveryStatus.SENT || !delivery.expoTicketId) return;
    const response = await this.expoRequest(EXPO_PUSH_RECEIPTS_URL, { ids: [delivery.expoTicketId] });
    const receipts = response.data && typeof response.data === 'object' && !Array.isArray(response.data)
      ? response.data as Record<string, ExpoPushReceipt>
      : {};
    const receipt = receipts[delivery.expoTicketId];
    if (!receipt) return;
    if (receipt.status === 'ok') {
      await this.prisma.pushDelivery.update({
        where: { id: delivery.id },
        data: { status: PushDeliveryStatus.DELIVERED, deliveredAt: new Date(), error: null },
      });
      return;
    }
    await this.failFromExpo(delivery.id, delivery.deviceId, receipt, '推送未被设备服务接收');
  }

  async markDeliveryFailed(deliveryId: string, error: unknown) {
    await this.prisma.pushDelivery.updateMany({
      where: { id: deliveryId, status: PushDeliveryStatus.QUEUED },
      data: { status: PushDeliveryStatus.FAILED, failedAt: new Date(), error: errorMessage(error, '推送请求失败') },
    });
  }

  private async failFromExpo(
    deliveryId: string,
    deviceId: string,
    expoError: ExpoPushError | undefined,
    fallback: string,
  ) {
    await this.prisma.pushDelivery.update({
      where: { id: deliveryId },
      data: {
        status: PushDeliveryStatus.FAILED,
        failedAt: new Date(),
        error: expoError?.message ?? fallback,
      },
    });
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
}
