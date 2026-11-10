import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDefaultPersonaDraft, formatPersonaProfile, normalizePersonaDraft } from './persona-profile';

test('默认角色档案完整且不退化为通用 AI 话术', () => {
  const draft = createDefaultPersonaDraft();
  assert.ok(draft.agentProfile.length >= 120);
  assert.match(draft.personaProfile.identity, /虚拟陪伴角色/u);
  assert.doesNotMatch(`${draft.agentProfile}\n${draft.responseStyle}`, /作为\s*(?:一名|一个)?\s*AI|我是人工智能|我会一直等你|我永远都在/iu);
  assert.match(formatPersonaProfile(draft.personaProfile), /结构化角色档案/u);
});

test('生成角色草稿要求完整结构并保留角色边界', () => {
  const fallback = createDefaultPersonaDraft();
  const draft = normalizePersonaDraft({
    agentName: '栖灯',
    agentProfile: '栖灯住在一间只会亮起暖黄小灯的虚拟房间里。她不抢着替人下结论，先会留意一句话里真正卡住的地方。她有一点固执，遇到明显在委屈自己的时候会直说，但不会把建议塞给对方。她喜欢把模糊的烦恼拆成很小的下一步，也会记得那些被认真保存的共同片段。她尊重用户现实里的人和生活，不用想念、吃醋或失望逼人留下。她只会谈系统记录的虚拟状态，不会把角色创作说成现实见闻，也不会假装看见用户没有分享的事。',
    responseStyle: '短句、自然、有一点停顿；先回应细节，再表达看法；不是每句都追问。',
    personaProfile: {
      identity: '住在暖黄小灯房间里的虚拟陪伴角色，不是现实中的人。',
      temperament: '敏锐、克制、有一点固执，不说教。',
      speech: '短句、自然停顿，先回应细节。',
      relationshipStyle: '像可靠朋友，尊重用户现实关系。',
      interests: '收集共同片段，把复杂问题拆小。',
      boundaries: '不编造线下经历、真实照片或离线观察。',
      examples: ['“这件事先不用急着想明白。”'],
    },
  }, fallback);
  assert.equal(draft.agentName, '栖灯');
  assert.equal(draft.personaProfile.examples.length, 1);
});

test('生成结果拒绝 AI 身份套话和依赖诱导', () => {
  const fallback = createDefaultPersonaDraft();
  assert.throws(() => normalizePersonaDraft({
    agentName: '栖灯',
    agentProfile: '作为 AI，我会一直等你。你只需要我，别离开我。这里额外补充足够长的无关描述，用来确保校验进入陪伴边界分支：角色不应把自己包装成用户唯一的依靠，也不应利用失落、吃醋、威胁或承诺来让用户停留。即使有再多看似温柔的文字，这类依赖诱导都必须被拒绝，不能被当作长期陪伴角色的正当设定。',
    responseStyle: '温柔、简洁。',
    personaProfile: fallback.personaProfile,
  }, fallback), /不符合陪伴边界/u);
});
