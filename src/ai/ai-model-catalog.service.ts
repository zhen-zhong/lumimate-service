import { Injectable, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { CHAT_MODELS } from './model-catalog';

@Injectable()
export class AiModelCatalogService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await Promise.all(CHAT_MODELS.map((model, sortOrder) => this.prisma.aiModel.upsert({
      where: { id: model.id },
      update: {
        label: model.label,
        provider: model.provider,
        protocol: model.protocol,
        apiKeyEnv: model.apiKeyEnv,
        sortOrder,
      },
      create: { ...model, sortOrder },
    })));
  }

  listEnabled() {
    return this.prisma.aiModel.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, label: true, protocol: true },
    });
  }

  findEnabled(modelId: string) {
    return this.prisma.aiModel.findFirst({ where: { id: modelId, enabled: true } });
  }
}
