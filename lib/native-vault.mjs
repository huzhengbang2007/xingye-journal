import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

// Explicit opt-in during migration. Passwords and keys travel over stdin, never argv or files.
export function nativeVault(request) {
  const executable = process.env.XINGYE_VAULT_HELPER;
  if (!executable) return null;
  if (!isAbsolute(executable)) throw new Error('Rust 加密引擎必须使用绝对路径');
  const input = Buffer.from(JSON.stringify(request));
  let result;
  try {
    result = spawnSync(executable, [], {
      input,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60000,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } finally {
    input.fill(0);
  }
  try {
    if (result.error) throw new Error('Rust 加密引擎无法启动或已超时');
    const response = JSON.parse(result.stdout.toString('utf8'));
    if (result.status !== 0 || !response.ok)
      throw new Error(response.error || 'Rust 加密引擎拒绝了请求');
    return response.data;
  } finally {
    result.stdout?.fill(0);
    result.stderr?.fill(0);
  }
}
