import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateReplyQuality } from './response-quality';

test('固定对话集的受控回复降低套话、追问、建议和不实陈述', () => {
  const before = evaluateReplyQuality([
    '我理解你，抱抱。你要不要试试先休息一下？',
    '我一直在这里等你。你可以列个计划。',
    '作为 AI，我建议你冷静一下。',
    '一切都会好起来的，你觉得呢？',
  ]);
  const after = evaluateReplyQuality([
    '开完会之后还要把委屈收起来，这一下确实不好受。',
    '这件事先放在这儿也行，不急着把它说圆。',
    '我偏向不急着答应。现在的信息还不够让你站稳。',
    '先只写下最卡的那一步；要不要做，还是你说了算。',
  ]);

  assert.equal(before.total, after.total);
  assert.ok(after.templateRate < before.templateRate);
  assert.ok(after.questionEndingRate < before.questionEndingRate);
  assert.ok(after.suggestionRate < before.suggestionRate);
  assert.ok(after.roleViolationRate < before.roleViolationRate);
  assert.ok(after.unsupportedClaimRate < before.unsupportedClaimRate);
});
