import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { SkillPluginManifest } from './skill-plugin-catalog';
import { SkillPluginService } from './skill-plugin.service';

export const GLOBAL_TOOL_ALLOWLIST = {
  'knowledge.search': 'READ',
  'map.searchNearby': 'READ',
  'map.planRoute': 'READ',
  'task.create': 'WRITE',
  'task.cancel': 'WRITE',
  'image.generate': 'WRITE',
  'image.edit': 'WRITE',
} as const;

const MAX_COMPOSED_SKILL_PROMPT_CHARS = 8_000;

export type EffectiveSkillPlugin = {
  pluginId: string;
  pluginVersionId: string;
  version: string;
  priority: number;
  promptTemplate: string;
  safetyPolicy: string;
  toolGrants: Array<keyof typeof GLOBAL_TOOL_ALLOWLIST>;
  memoryEnabled: boolean;
  memoryCategories: string[];
};

function memoryEnabled(userConfig: unknown) {
  return Boolean(
    userConfig &&
    typeof userConfig === 'object' &&
    !Array.isArray(userConfig) &&
    (userConfig as Record<string, unknown>).memoryEnabled === true,
  );
}

function isManifest(value: Prisma.JsonValue, pluginId: string, version: string): value is SkillPluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  const limits = manifest.limits;
  return manifest.schemaVersion === 1 &&
    manifest.id === pluginId &&
    manifest.version === version &&
    Array.isArray(manifest.toolGrants) && manifest.toolGrants.every((tool) => typeof tool === 'string') &&
    Array.isArray(manifest.memoryCategories) &&
    Array.isArray(manifest.knowledgeBindings) &&
    !!limits && typeof limits === 'object' && !Array.isArray(limits) &&
    Number.isInteger((limits as Record<string, unknown>).maxPromptChars) &&
    Number.isInteger((limits as Record<string, unknown>).maxRetrievedChunks) &&
    Number.isInteger((limits as Record<string, unknown>).maxToolCalls);
}

@Injectable()
export class SkillPolicyResolverService {
  constructor(private readonly skills: SkillPluginService) {}

  async resolve(conversationId: string) {
    const bindings = await this.skills.getEffectivePlugins(conversationId);
    let remainingPromptChars = MAX_COMPOSED_SKILL_PROMPT_CHARS;
    const plugins: EffectiveSkillPlugin[] = [];
    const toolOwners = new Map<keyof typeof GLOBAL_TOOL_ALLOWLIST, string>();
    const memoryAllowedByPlugin = new Set<string>();
    const memoryBlockedByPlugin = new Set<string>();

    for (const binding of bindings) {
      if (!isManifest(binding.pluginVersion.manifest, binding.pluginId, binding.pluginVersion.version)) continue;
      const declaredLimit = Math.min(
        MAX_COMPOSED_SKILL_PROMPT_CHARS,
        Math.max(0, binding.pluginVersion.manifest.limits.maxPromptChars),
      );
      const promptTemplate = binding.pluginVersion.promptTemplate.trim().slice(0, Math.min(remainingPromptChars, declaredLimit));
      if (!promptTemplate) continue;
      remainingPromptChars -= promptTemplate.length;
      const toolGrants = binding.pluginVersion.manifest.toolGrants.filter(
        (tool): tool is keyof typeof GLOBAL_TOOL_ALLOWLIST => tool in GLOBAL_TOOL_ALLOWLIST,
      );
      const pluginMemoryEnabled = memoryEnabled(binding.userConfig);
      const memoryCategories = binding.pluginVersion.manifest.memoryCategories;
      const plugin: EffectiveSkillPlugin = {
        pluginId: binding.pluginId,
        pluginVersionId: binding.pluginVersionId,
        version: binding.pluginVersion.version,
        priority: binding.priority,
        promptTemplate,
        safetyPolicy: binding.pluginVersion.safetyPolicy.trim().slice(0, 2_000),
        toolGrants,
        memoryEnabled: pluginMemoryEnabled,
        memoryCategories,
      };
      plugins.push(plugin);
      for (const category of memoryCategories) {
        if (pluginMemoryEnabled) memoryAllowedByPlugin.add(category);
        else memoryBlockedByPlugin.add(category);
      }
      for (const tool of toolGrants) {
        if (!toolOwners.has(tool)) toolOwners.set(tool, plugin.pluginVersionId);
      }
      if (remainingPromptChars <= 0) break;
    }

    for (const category of memoryAllowedByPlugin) memoryBlockedByPlugin.delete(category);

    return {
      plugins,
      toolOwners,
      blockedMemoryCategories: [...memoryBlockedByPlugin],
      instructions: plugins.flatMap((plugin) => [
        `技能 ${plugin.pluginId}@${plugin.version}：${plugin.promptTemplate}`,
        plugin.safetyPolicy ? `安全边界：${plugin.safetyPolicy}` : null,
        plugin.memoryCategories.length && !plugin.memoryEnabled
          ? `记忆授权：未开启。不得依据 ${plugin.memoryCategories.join('、')} 类长期记忆或关系资料作答。`
          : null,
      ]).filter((value): value is string => Boolean(value)),
    };
  }
}
