import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyLimit } from '../public/ai-policy.js';
test('daily AI limit defaults for older settings and supports an explicit pause', () => {
  assert.equal(dailyLimit(), 100);
  assert.equal(dailyLimit('25'), 25);
  assert.equal(dailyLimit(0), 0);
  for (const value of [-1, 101, 0.5, 'abc', Infinity]) assert.throws(() => dailyLimit(value));
});
