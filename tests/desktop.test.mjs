import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

test('native service announces its bound port, rejects duplicate writers and exits with its owner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xingye-native-'));
  const children = [];
  function start() {
    const child = spawn(process.execPath, [resolve('server.mjs')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        HOST: '127.0.0.1',
        PORT: '0',
        XINGYE_DESKTOP: '1',
        TLS_PFX_PATH: '',
        TLS_CERT_PATH: '',
        TLS_KEY_PATH: '',
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    return child;
  }
  async function ready(child) {
    let output = '';
    return new Promise((ok, fail) => {
      const timeout = setTimeout(() => fail(new Error('native startup timeout')), 10000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const line = /XINGYE_DESKTOP_READY (\{[^\n]+\})/.exec(output)?.[1];
        if (line) {
          clearTimeout(timeout);
          ok(JSON.parse(line).port);
        }
      });
      child.once('exit', () => {
        clearTimeout(timeout);
        fail(new Error('native startup failed'));
      });
      child.once('error', fail);
    });
  }
  try {
    const first = start(),
      port = await ready(first);
    const origin = `http://127.0.0.1:${port}`;
    const response = await fetch(origin + '/api/session');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).localOnly, true);
    assert.ok(
      response.headers.get('content-security-policy').includes('ipc: http://ipc.localhost'),
    );
    assert.equal(existsSync(join(dir, 'daylight.vault')), false, 'startup never creates a vault');
    const duplicate = start();
    let stderr = '';
    duplicate.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const [code] = await once(duplicate, 'exit');
    assert.equal(code, 1);
    assert.match(stderr, /数据目录已被另一窗口使用/);
    assert.equal((await fetch(origin + '/api/session')).status, 200);
    const stopped = once(first, 'exit');
    first.stdin.end();
    await stopped;
    const restarted = start();
    assert.equal(
      await ready(restarted),
      port,
      'lease is released and native origin remains stable',
    );
  } finally {
    await Promise.all(
      children
        .filter((child) => child.exitCode === null)
        .map(async (child) => {
          const done = once(child, 'exit');
          child.kill();
          await done;
        }),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});
