import type { AiChatMessage } from '../ai/interfaces/ai-chat-provider';

export const RESPONSE_ACTIONS = [
  'RECEIVE_EMOTION',
  'EXPRESS_VIEW',
  'LIGHT_REPLY',
  'CONTINUE_THREAD',
  'MICRO_ACTION',
  'QUIET_COMPANY',
] as const;

export type ResponseAction = (typeof RESPONSE_ACTIONS)[number];

export type ResponseActionInput = {
  content: string;
  memoryContext?: string;
  history?: AiChatMessage[];
};

const EMOTION_PATTERN = /难过|伤心|委屈|烦|焦虑|害怕|累(?:了)?|崩溃|孤独|失眠|压抑|不想动|好难/iu;
const OPINION_PATTERN = /你觉得|你怎么看|你的看法|你会怎么选|该不该/iu;
const ACTION_PATTERN = /怎么办|怎么做|计划|拆(?:开|成)|开始不了|拖延|下一步|帮我理(?:一理|清)/iu;
const CONTINUATION_PATTERN = /上次|之前|还没说完|接着说|后来呢|记得(?:吗)?/iu;
const QUIET_PATTERN = /^(?:嗯+|哦+|好+|知道了|没事|算了|…+|\.{3,})[。！!？?\s]*$/iu;

export function selectResponseAction(input: ResponseActionInput): ResponseAction {
  const content = input.content.trim();
  if (EMOTION_PATTERN.test(content)) return 'RECEIVE_EMOTION';
  if (ACTION_PATTERN.test(content)) return 'MICRO_ACTION';
  if (OPINION_PATTERN.test(content)) return 'EXPRESS_VIEW';
  if (CONTINUATION_PATTERN.test(content) && input.memoryContext?.includes('共同经历')) return 'CONTINUE_THREAD';
  if (QUIET_PATTERN.test(content)) return 'QUIET_COMPANY';
  return 'LIGHT_REPLY';
}

export function responseActionInstruction(action: ResponseAction) {
  const instructions: Record<ResponseAction, string> = {
    RECEIVE_EMOTION: '本轮动作：接住情绪。点到用户刚说的一个具体细节，允许情绪停在那里；除非用户明确求助，不给建议、不追问。',
    EXPRESS_VIEW: '本轮动作：表达看法。给出明确但不过度确定的个人判断，说明依据只限用户当前提供的信息；不把问题抛回给用户。',
    LIGHT_REPLY: '本轮动作：轻松回应。自然接话或分享一个贴合细节的小反应，不总结、不教育、不为了延续而提问。',
    CONTINUE_THREAD: '本轮动作：延续旧话。只可使用已给出的共同经历或近期对话，不补写不存在的细节；自然接上，不审问。',
    MICRO_ACTION: '本轮动作：推动小行动。最多给一个可选、可拒绝的小步骤；不要列清单，不把建议包装成命令。',
    QUIET_COMPANY: '本轮动作：安静陪伴。用一两句简短、不过度抒情的话留出空间；不追问、不建议。',
  };
  return instructions[action];
}

export const RESPONSE_STYLE_GUARD = [
  '不要使用空泛肯定、重复复述、模板化共情或无依据的陪伴承诺。',
  '避免“我理解你”“抱抱”“你不是一个人”“一切都会好起来”“我一直在”等套话；有具体信息才回应具体信息。',
  '不默认以问题结尾；只有确实缺少完成用户明确请求所必需的信息时才提问。',
  '不默认给建议；建议只能来自“推动小行动”动作，并且必须可选。',
].join('\n');

export function evaluateActionCorpus(cases: ResponseActionInput[]) {
  const actions = cases.map(selectResponseAction);
  const counts = Object.fromEntries(RESPONSE_ACTIONS.map((action) => [action, 0])) as Record<ResponseAction, number>;
  for (const action of actions) counts[action] += 1;
  return {
    actions,
    counts,
    actionRate: cases.length ? Object.fromEntries(RESPONSE_ACTIONS.map((action) => [action, counts[action] / cases.length])) : {},
  };
}
