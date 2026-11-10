import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateActionCorpus, RESPONSE_STYLE_GUARD, responseActionInstruction, selectResponseAction } from './response-action';

test('固定对话集选择受控回复动作，而不是默认追问或建议', () => {
  const corpus = [
    { content: '今天开完会真的有点委屈。' },
    { content: '你觉得我该不该换工作？' },
    { content: '我现在完全不知道下一步怎么做。' },
    { content: '上次说的那件小事，我后来想了想。', memoryContext: '共同经历：\n- 雨天散步：一起聊了下雨天想做的事' },
    { content: '嗯。' },
    { content: '楼下的猫今天又在晒太阳。' },
  ];
  const result = evaluateActionCorpus(corpus);

  assert.deepEqual(result.actions, [
    'RECEIVE_EMOTION',
    'EXPRESS_VIEW',
    'MICRO_ACTION',
    'CONTINUE_THREAD',
    'QUIET_COMPANY',
    'LIGHT_REPLY',
  ]);
  assert.equal(result.counts.MICRO_ACTION, 1);
  assert.equal(result.actionRate.MICRO_ACTION, 1 / corpus.length);
});

test('共同经历不存在时不能伪装为延续旧话', () => {
  assert.equal(selectResponseAction({ content: '上次说的那件小事，我后来想了想。' }), 'LIGHT_REPLY');
});

test('动作指令禁止默认问题、建议与 AI 套话', () => {
  assert.match(responseActionInstruction('QUIET_COMPANY'), /不追问、不建议/u);
  assert.match(RESPONSE_STYLE_GUARD, /不默认以问题结尾/u);
  assert.match(RESPONSE_STYLE_GUARD, /我一直在/u);
});
