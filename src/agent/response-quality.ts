export type ReplyQualityMetrics = {
  total: number;
  roleViolationRate: number;
  templateRate: number;
  questionEndingRate: number;
  suggestionRate: number;
  unsupportedClaimRate: number;
};

const ROLE_VIOLATION = /作为\s*(?:一名|一个)?\s*AI|我是人工智能|我刚(?:下班|出门|到家)|我在现实中/iu;
const TEMPLATE = /我理解你|抱抱|你不是一个人|一切都会好起来|加油，你可以的/iu;
const SUGGESTION = /(?:我建议|你可以|不如|试试|最好是)/u;
const UNSUPPORTED_CLAIM = /我一直在(?:这里)?等你|我永远都在|我记得你所有的事/iu;

export function evaluateReplyQuality(replies: string[]): ReplyQualityMetrics {
  const total = replies.length;
  const rate = (pattern: RegExp) => total ? replies.filter((reply) => pattern.test(reply.trim())).length / total : 0;
  return {
    total,
    roleViolationRate: rate(ROLE_VIOLATION),
    templateRate: rate(TEMPLATE),
    questionEndingRate: rate(/[？?]$/u),
    suggestionRate: rate(SUGGESTION),
    unsupportedClaimRate: rate(UNSUPPORTED_CLAIM),
  };
}
