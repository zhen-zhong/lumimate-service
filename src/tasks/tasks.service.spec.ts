import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { proactiveTitle } from './tasks.service';

test('主动陪伴文案仅引用共同经历，不追问、不施压、不制造依赖', () => {
  const title = proactiveTitle('下班路上的风');
  assert.match(title, /下班路上的风/u);
  assert.doesNotMatch(title, /[？?]|为什么不回|我一直在等|别离开|只需要我/u);
  assert.match(title, /不急着回应/u);
});
