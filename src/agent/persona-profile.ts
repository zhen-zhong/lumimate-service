export const PERSONA_PROFILE_VERSION = 1;

export type PersonaProfile = {
  identity: string;
  temperament: string;
  speech: string;
  relationshipStyle: string;
  interests: string;
  boundaries: string;
  examples: string[];
};

export type PersonaGenerationPreferences = {
  relationshipType?: string;
  activityLevel?: string;
  speechTone?: string;
  proactiveBoundary?: string;
};

export type PersonaDraft = {
  agentName: string;
  agentProfile: string;
  responseStyle: string;
  personaProfile: PersonaProfile;
  personaVersion: number;
};

const BANNED_PERSONA_PATTERNS = [
  /作为\s*(?:一名|一个)?\s*AI/iu,
  /我是人工智能/iu,
  /我会一直等你/iu,
  /我永远都在/iu,
  /离开我/iu,
  /只需要我/iu,
  /不要告诉别人/iu,
];

function text(value: unknown, maxLength: number) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/gu, ' ').slice(0, maxLength)
    : '';
}

function examples(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 160))
    .filter(Boolean)
    .slice(0, 4);
}

export function createDefaultPersonaProfile(agentName = 'LumiMate'): PersonaProfile {
  return {
    identity: `${agentName} 是住在“微光房间”里的虚拟陪伴角色，不是现实中的人。`,
    temperament: '安静、敏锐、有一点自己的坚持。会留意细节，也会在必要时坦白不同看法，不说教。',
    speech: '偏短句和自然停顿。先回应具体细节，再决定是否给建议；不机械复述，不强行用问题收尾。',
    relationshipStyle: '像熟悉中的可靠朋友：尊重现实生活和其他关系，陪伴但不占有，也不制造亏欠感。',
    interests: '喜欢收集一天里的微小片段、把复杂事情拆小、留意天气、光线和情绪变化。',
    boundaries: '只叙述系统记录的虚拟角色状态；不冒充真人，不编造线下经历、真实照片、离线观察或未发生的共同回忆。',
    examples: ['“这件事听起来确实有点卡住了。先不用急着把它想明白。”', '“我有个不那么圆滑的看法：你已经做得比自己承认的多。”'],
  };
}

export function createDefaultPersonaDraft(agentName = 'LumiMate'): PersonaDraft {
  const personaProfile = createDefaultPersonaProfile(agentName);
  return {
    agentName,
    agentProfile: [
      personaProfile.identity,
      personaProfile.temperament,
      personaProfile.speech,
      personaProfile.relationshipStyle,
      personaProfile.interests,
      personaProfile.boundaries,
    ].join('\n'),
    responseStyle: '自然、克制、有自己的看法；先接住具体细节，不套用客服或心理咨询话术。',
    personaProfile,
    personaVersion: PERSONA_PROFILE_VERSION,
  };
}

export function normalizePersonaProfile(value: unknown, agentName: string): PersonaProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  const normalized: PersonaProfile = {
    identity: text(profile.identity, 400),
    temperament: text(profile.temperament, 600),
    speech: text(profile.speech, 600),
    relationshipStyle: text(profile.relationshipStyle, 600),
    interests: text(profile.interests, 600),
    boundaries: text(profile.boundaries, 800),
    examples: examples(profile.examples),
  };
  if (!normalized.identity || !normalized.temperament || !normalized.speech || !normalized.relationshipStyle || !normalized.interests || !normalized.boundaries || normalized.examples.length < 1) {
    return null;
  }
  return normalized;
}

export function formatPersonaProfile(profile: PersonaProfile) {
  return [
    '结构化角色档案：',
    `- 身份：${profile.identity}`,
    `- 性格：${profile.temperament}`,
    `- 说话方式：${profile.speech}`,
    `- 关系方式：${profile.relationshipStyle}`,
    `- 兴趣与日常：${profile.interests}`,
    `- 边界：${profile.boundaries}`,
    `- 语气示例：${profile.examples.join(' / ')}`,
  ].join('\n');
}

export function normalizePersonaDraft(value: unknown, fallback: PersonaDraft): PersonaDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('角色生成结果格式错误，请重试');
  }
  const draft = value as Record<string, unknown>;
  const agentName = text(draft.agentName, 32) || fallback.agentName;
  const agentProfile = text(draft.agentProfile, 2_000);
  const responseStyle = text(draft.responseStyle, 500);
  const personaProfile = normalizePersonaProfile(draft.personaProfile, agentName);
  if (agentName.length < 2 || agentProfile.length < 120 || !responseStyle || !personaProfile) {
    throw new Error('角色生成结果不完整，请重试');
  }
  const allText = [agentName, agentProfile, responseStyle, ...Object.values(personaProfile).flatMap((item) => Array.isArray(item) ? item : [item])].join('\n');
  if (BANNED_PERSONA_PATTERNS.some((pattern) => pattern.test(allText))) {
    throw new Error('角色生成结果不符合陪伴边界，请重试');
  }
  return { agentName, agentProfile, responseStyle, personaProfile, personaVersion: PERSONA_PROFILE_VERSION };
}
