import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';

export function verifyRelease(root, { required = false } = {}) {
  const manifest = resolve(root, 'BUILD-INFO.json');
  if (!existsSync(manifest)) {
    if (required) throw new Error('缺少发布清单，请重新安装完整程序');
    return null;
  }
  const publisher = JSON.parse(
    readFileSync(resolve(root, 'scripts/packaging/publisher.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  const key = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'RSA',
      n: Buffer.from(publisher.modulus, 'base64').toString('base64url'),
      e: Buffer.from(publisher.exponent, 'base64').toString('base64url'),
    },
  });
  const bytes = readFileSync(manifest);
  const signature = Buffer.from(readFileSync(manifest + '.sig', 'ascii').trim(), 'base64');
  if (!verify('sha256', bytes, key, signature)) throw new Error('发布清单签名无效，请重新安装程序');
  const info = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (info.publisher !== 'HOSHINO TEAM') throw new Error('发布者信息无效');
  const prefix = resolve(root) + sep;
  for (const [name, expected] of Object.entries(info.hashes || {})) {
    const file = resolve(root, name);
    if (
      !file.startsWith(prefix) ||
      !/^[a-f0-9]{64}$/.test(expected) ||
      createHash('sha256').update(readFileSync(file)).digest('hex') !== expected
    )
      throw new Error('程序文件校验失败，请重新安装；个人数据不会被自动删除');
  }
  return info;
}
