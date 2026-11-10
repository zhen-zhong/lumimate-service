import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { scheduledPresenceAt } from './companion-presence.service';

test('角色状态只由 Asia/Shanghai 时间规则决定', () => {
  assert.equal(scheduledPresenceAt(new Date('2026-11-10T17:00:00.000Z')).activityKey, 'resting');
  assert.equal(scheduledPresenceAt(new Date('2026-11-10T02:00:00.000Z')).activityKey, 'available');
  assert.equal(scheduledPresenceAt(new Date('2026-11-10T12:00:00.000Z')).activityKey, 'collecting_day');
});
