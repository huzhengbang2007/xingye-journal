import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLoginLimiter, durableWrite, streamWrite } from '../lib/runtime.mjs';
test('login failures isolate source addresses and expire without extending a lock', () => {
  let now = 0;
  const limiter = createLoginLimiter({ now: () => now });
  for (let n = 0; n < 5; n++) limiter.fail('attacker');
  assert.equal(limiter.blocked('attacker'), true);
  assert.equal(limiter.blocked('owner'), false);
  now = 60000;
  assert.equal(limiter.blocked('attacker'), false);
  limiter.fail('owner');
  limiter.clear('owner');
  assert.equal(limiter.blocked('owner'), false);
});
test('atomic persistence retains the previous encrypted generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xingye-save-'));
  try {
    const path = join(dir, 'test.vault');
    durableWrite(path, 'first ciphertext');
    durableWrite(path, 'second ciphertext');
    assert.equal(readFileSync(path, 'utf8'), 'second ciphertext');
    assert.equal(readFileSync(path + '.previous', 'utf8'), 'first ciphertext');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('SSE writes skip closed streams and end slow readers', () => {
  assert.equal(streamWrite({ destroyed: true }, 'message'), false);
  let ended = false;
  assert.equal(streamWrite({ write: () => false, end: () => (ended = true) }, 'message'), false);
  assert.equal(ended, true);
});
