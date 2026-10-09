import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { SkillPluginStatus, SkillPluginVersionStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { SYSTEM_SKILL_PLUGINS } from './skill-plugin-catalog';
import type { UpdateConversationSkillPluginDto } from './dto/update-conversation-skill-plugin.dto';

function memoryEnabled(userConfig: unknown) {
  return Boolean(
    userConfig &&
    typeof userConfig === 'object' &&
    !Array.isArray(userConfig) &&
    (userConfig as Record<string, unknown>).memoryEnabled === true,
  );
}

function updateUserConfig(current: unknown, nextMemoryEnabled?: boolean) {
  const base = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  return {
    ...base,
    ...(nextMemoryEnabled === undefined ? {} : { memoryEnabled: nextMemoryEnabled }),
  };
}

@Injectable()
export class SkillPluginService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    for (const plugin of SYSTEM_SKILL_PLUGINS) {
      await this.prisma.skillPlugin.upsert({
        where: { id: plugin.id },
        update: {
          displayName: plugin.displayName,
          description: plugin.description,
          status: SkillPluginStatus.ENABLED,
        },
        create: {
          id: plugin.id,
          displayName: plugin.displayName,
          description: plugin.description,
          status: SkillPluginStatus.ENABLED,
        },
      });
      await this.prisma.skillPluginVersion.upsert({
        where: { pluginId_version: { pluginId: plugin.id, version: plugin.version } },
        update: { status: SkillPluginVersionStatus.PUBLISHED },
        create: {
          pluginId: plugin.id,
          version: plugin.version,
          manifest: plugin.manifest,
          promptTemplate: plugin.promptTemplate,
          safetyPolicy: plugin.safetyPolicy,
          status: SkillPluginVersionStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      });
    }
  }

  async listCatalog() {
    const plugins = await this.prisma.skillPlugin.findMany({
      where: { status: SkillPluginStatus.ENABLED },
      include: {
        versions: {
          where: { status: SkillPluginVersionStatus.PUBLISHED },
          orderBy: { publishedAt: 'desc' },
          select: { id: true, version: true, manifest: true, publishedAt: true },
        },
      },
      orderBy: { displayName: 'asc' },
    });
    return plugins.map((plugin) => ({
      id: plugin.id,
      displayName: plugin.displayName,
      description: plugin.description,
      versions: plugin.versions,
    }));
  }

  async listConversationPlugins(conversationId: string) {
    const bindings = await this.prisma.conversationSkillPlugin.findMany({
      where: { conversationId },
      include: {
        plugin: { select: { id: true, displayName: true, description: true, status: true } },
        pluginVersion: { select: { id: true, version: true, manifest: true, publishedAt: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return bindings.map((binding) => ({
      id: binding.id,
      enabled: binding.enabled,
      priority: binding.priority,
      memoryEnabled: memoryEnabled(binding.userConfig),
      plugin: binding.plugin,
      version: binding.pluginVersion,
    }));
  }

  async updateConversationPlugin(
    conversationId: string,
    pluginId: string,
    input: UpdateConversationSkillPluginDto,
  ) {
    const plugin = await this.prisma.skillPlugin.findFirst({
      where: { id: pluginId, status: SkillPluginStatus.ENABLED },
      select: { id: true },
    });
    if (!plugin) throw new NotFoundException('技能不存在或已停用');
    const current = await this.prisma.conversationSkillPlugin.findUnique({
      where: { conversationId_pluginId: { conversationId, pluginId } },
      select: { pluginVersionId: true, priority: true, userConfig: true },
    });
    const version = input.version
      ? await this.prisma.skillPluginVersion.findFirst({
          where: { pluginId, version: input.version, status: SkillPluginVersionStatus.PUBLISHED },
          select: { id: true },
        })
      : current
        ? { id: current.pluginVersionId }
        : await this.prisma.skillPluginVersion.findFirst({
            where: { pluginId, status: SkillPluginVersionStatus.PUBLISHED },
            orderBy: { publishedAt: 'desc' },
            select: { id: true },
          });
    if (!version) throw new NotFoundException('技能没有可用版本');

    await this.prisma.conversationSkillPlugin.upsert({
      where: { conversationId_pluginId: { conversationId, pluginId } },
      update: {
        enabled: input.enabled,
        priority: input.priority ?? current?.priority,
        pluginVersionId: version.id,
        userConfig: updateUserConfig(current?.userConfig, input.memoryEnabled),
      },
      create: {
        conversationId,
        pluginId,
        pluginVersionId: version.id,
        enabled: input.enabled,
        priority: input.priority ?? 0,
        userConfig: updateUserConfig(undefined, input.memoryEnabled),
      },
    });
    return this.listConversationPlugins(conversationId);
  }

  async getEffectivePlugins(conversationId: string) {
    return this.prisma.conversationSkillPlugin.findMany({
      where: {
        conversationId,
        enabled: true,
        plugin: { status: SkillPluginStatus.ENABLED },
        pluginVersion: { status: SkillPluginVersionStatus.PUBLISHED },
      },
      include: { pluginVersion: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }
}
