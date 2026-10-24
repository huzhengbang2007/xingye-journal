import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { derive, seal, unseal } from '../lib/core.mjs';

const binary =
  process.env.XINGYE_TEST_VAULT_HELPER ||
  ['release', 'debug']
    .map((profile) =>
      resolve(
        `native/target/${profile}/xingye-vault` + (process.platform === 'win32' ? '.exe' : ''),
      ),
    )
    .find(existsSync);
const skip = !binary || !existsSync(binary);
if (skip && process.env.XINGYE_REQUIRE_VAULT_HELPER === '1')
  throw new Error(
    'Rust helper missing: build xingye-vault first; skipping is not a successful Rust check',
  );
function native(request) {
  const result = spawnSync(binary, [], {
    input: JSON.stringify(request),
    timeout: 60000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const parsed = JSON.parse(result.stdout.toString());
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.data;
}
const password = '兼容-password-2026🔑';
const data = { events: [{ title: '中文与 emoji 🌙', done: false }], settings: { budget: 0 } };

test('Rust scrypt matches the existing Node engine including unicode passwords', { skip }, () => {
  const salt = randomBytes(16).toString('base64');
  assert.equal(
    native({ action: 'derive', password, salt }).key,
    derive(password, salt).toString('base64'),
  );
});
test('Rust reads existing v1 vaults; Node reads Rust vaults', { skip }, () => {
  const salt = randomBytes(16).toString('base64');
  const key = derive(password, salt);
  const old = JSON.parse(seal(data, key, salt));
  assert.deepEqual(
    JSON.parse(native({ action: 'unseal', envelope: old, password }).plaintext),
    data,
  );
  const next = native({
    action: 'seal',
    plaintext: JSON.stringify(data),
    key: key.toString('base64'),
    salt,
  });
  assert.deepEqual(unseal(next.envelope, password).data, data);
});
test('Rust reads Android v2 PBKDF2 envelopes and rejects changed parameters', { skip }, () => {
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, 310000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(data)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const envelope = {
    version: 2,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    body: body.toString('base64'),
    kdf: 'PBKDF2-SHA256',
    iterations: 310000,
  };
  assert.deepEqual(JSON.parse(native({ action: 'unseal', envelope, password }).plaintext), data);
  assert.throws(
    () => native({ action: 'unseal', envelope: { ...envelope, iterations: 1 }, password }),
    /参数/,
  );
});
test('Rust rejects tampering and truncated input without echoing passwords', { skip }, () => {
  const salt = randomBytes(16).toString('base64');
  const envelope = JSON.parse(seal(data, derive(password, salt), salt));
  assert.throws(
    () => native({ action: 'unseal', envelope, password: 'incorrect-password' }),
    /密码错误/,
  );
  assert.throws(
    () => native({ action: 'unseal', envelope: { ...envelope, iv: 'AA==' }, password }),
    /IV/,
  );
  const result = spawnSync(binary, [], { input: '{"password":"secret', windowsHide: true });
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes('secret'));
});
test(
  'server core can use Rust for derive, seal and unseal without plaintext files',
  { skip },
  () => {
    const program = `
    import {derive,seal,unseal} from './lib/core.mjs';
    const salt = Buffer.alloc(16,7).toString('base64');
    const password = 'integration-password';
    const original = {events: [], title: '星野记'};
    const result = unseal(seal(original, derive(password,salt), salt), password);
    if (JSON.stringify(result.data) !== JSON.stringify(original)) process.exit(1);
  `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      env: { ...process.env, XINGYE_VAULT_HELPER: binary },
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr.toString());
  },
);
