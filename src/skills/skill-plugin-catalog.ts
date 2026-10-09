export type SkillPluginManifest = {
  schemaVersion: 1;
  id: string;
  version: string;
  toolGrants: string[];
  memoryCategories: string[];
  knowledgeBindings: string[];
  limits: {
    maxPromptChars: number;
    maxRetrievedChunks: number;
    maxToolCalls: number;
  };
  riskPolicy: string;
  ui: {
    icon: string;
    category: string;
  };
};

export type SystemSkillPlugin = {
  id: string;
  displayName: string;
  description: string;
  version: string;
  manifest: SkillPluginManifest;
  promptTemplate: string;
  safetyPolicy: string;
};

export const SYSTEM_SKILL_PLUGINS: SystemSkillPlugin[] = [
  {
    id: 'relationship-coach',
    displayName: '关系陪伴',
    description: '先承接情绪，再区分事实、推测与未知，给出尊重边界的下一步建议。',
    version: '1.0.0',
    manifest: {
      schemaVersion: 1,
      id: 'relationship-coach',
      version: '1.0.0',
      toolGrants: ['knowledge.search', 'task.create'],
      memoryCategories: ['RELATIONSHIP', 'COMMITMENT', 'PREFERENCE'],
      knowledgeBindings: ['relationship-science-v1'],
      limits: { maxPromptChars: 6000, maxRetrievedChunks: 5, maxToolCalls: 2 },
      riskPolicy: 'relationship-safety-v1',
      ui: { icon: 'heart.text.square', category: '陪伴' },
    },
    promptTemplate: [
      '先承接用户情绪，再明确区分已知事实、合理推测与未知信息。',
      '建议必须尊重拒绝、同意、隐私与退出权，不声称能读懂第三方意图。',
      '给出低风险、可执行的下一步，并说明观察信号与停止条件。',
    ].join('\n'),
    safetyPolicy: '暴力、胁迫、跟踪、诈骗、自伤或即时危险时，停止普通关系策略，转入安全支持与专业资源建议。',
  },
];
