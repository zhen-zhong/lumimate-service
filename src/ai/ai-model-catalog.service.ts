import { Injectable, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';
import { AI_MODELS, type AiModelCapability } from './model-catalog';

@Injectable()
export class AiModelCatalogService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await Promise.all(AI_MODELS.map((model, sortOrder) => this.prisma.aiModel.upsert({
      where: { id: model.id },
      update: {
        label: model.label,
        provider: model.provider,
        protocol: model.protocol,
        capability: model.capability,
        apiKeyEnv: model.apiKeyEnv,
        sortOrder,
      },
      create: { ...model, sortOrder },
    })));
  }

  listEnabled(capability: AiModelCapability = 'chat') {
    return this.prisma.aiModel.findMany({
      where: { enabled: true, capability },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, label: true, protocol: true },
    });
  }

  findEnabled(modelId: string, capability: AiModelCapability = 'chat') {
    return this.prisma.aiModel.findFirst({ where: { id: modelId, enabled: true, capability } });
  }
}
