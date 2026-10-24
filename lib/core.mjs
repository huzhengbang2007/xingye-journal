import {
  scryptSync,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  pbkdf2Sync,
} from 'node:crypto';
import { assert } from '../public/domain.js';
import { nativeVault } from './native-vault.mjs';
export * from '../public/domain.js';
export const hash = (s) => createHash('sha256').update(s).digest('hex');
export function derive(password, salt) {
  assert(
    typeof password === 'string' && password.length >= 10 && password.length <= 256,
    '主密码需要 10–256 个字符',
  );
  const native = nativeVault({ action: 'derive', password, salt });
  if (native) return Buffer.from(native.key, 'base64');
  return scryptSync(password, Buffer.from(salt, 'base64'), 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}
export function seal(data, key, salt) {
  if (process.env.XINGYE_VAULT_HELPER) {
    const native = nativeVault({
      action: 'seal',
      plaintext: JSON.stringify(data),
      key: key.toString('base64'),
      salt,
    });
    return JSON.stringify(native.envelope);
  }
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return JSON.stringify({
    version: 1,
    salt,
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    body: body.toString('base64'),
  });
}
export function unseal(envelope, password) {
  const e = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
  assert(e && [1, 2].includes(e.version) && typeof e.salt === 'string', '备份格式无效');
  const native = nativeVault({ action: 'unseal', envelope: e, password });
  if (native)
    return {
      data: JSON.parse(native.plaintext),
      key: Buffer.from(native.key, 'base64'),
      salt: native.salt,
      version: native.version,
    };
  let key, body, tag;
  if (e.version === 2) {
    assert(e.kdf === 'PBKDF2-SHA256' && e.iterations === 310000, '备份派生参数无效');
    assert(
      typeof password === 'string' && password.length >= 10 && password.length <= 256,
      '密码格式无效',
    );
    key = pbkdf2Sync(password, Buffer.from(e.salt, 'base64'), 310000, 32, 'sha256');
    const bytes = Buffer.from(e.body, 'base64');
    body = bytes.subarray(0, -16);
    tag = bytes.subarray(-16);
  } else {
    key = derive(password, e.salt);
    body = Buffer.from(e.body, 'base64');
    tag = Buffer.from(e.tag, 'base64');
  }
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  d.setAuthTag(tag);
  const data = JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
  return { data, key, salt: e.salt, version: e.version };
}
