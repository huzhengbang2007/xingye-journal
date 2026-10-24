import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { verifyRelease } from '../lib/release-integrity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
verifyRelease(root, { required: existsSync(resolve(root, 'runtime/node.exe')) });
const port = Number(process.env.PORT || 3210);
const url = `http://127.0.0.1:${port}/`;
// Refuse a busy port instead of opening another application's page.
const probe = net.createServer();
try {
  await new Promise((ok, fail) => {
    probe.once('error', fail);
    probe.listen(port, '127.0.0.1', ok);
  });
  await new Promise((ok) => probe.close(ok));
} catch {
  console.error(`Port ${port} is in use. Close the earlier Xingye Journal window, then try again.`);
  process.exit(1);
}
const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port) };
const helper = resolve(root, 'xingye-vault.exe');
if (existsSync(helper)) env.XINGYE_VAULT_HELPER = helper;
for (const key of [
  'TLS_PFX_PATH',
  'TLS_PFX_PASSWORD',
  'TLS_CERT_PATH',
  'TLS_KEY_PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
])
  delete env[key];
const child = spawn(process.execPath, [resolve(root, 'server.mjs')], {
  cwd: root,
  env,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code || 0;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
console.log('Keep this window open. Press Ctrl+C to stop.');
for (let attempt = 0; attempt < 80 && child.exitCode === null; attempt++) {
  try {
    const result = await fetch(url + 'api/session', { signal: AbortSignal.timeout(500) });
    const session = await result.json();
    if (result.ok && typeof session.initialized === 'boolean' && session.localOnly) {
      if (process.env.XINGYE_NO_BROWSER !== '1') {
        const candidates = [
          process.env['ProgramFiles(x86)'],
          process.env.ProgramFiles,
          process.env.LOCALAPPDATA,
        ]
          .filter(Boolean)
          .map((base) => resolve(base, 'Microsoft/Edge/Application/msedge.exe'));
        const edge = candidates.find(existsSync);
        const browser = edge
          ? spawn(edge, [`--app=${url}`, '--window-size=1280,900'], {
              windowsHide: true,
              stdio: 'ignore',
            })
          : spawn('cmd.exe', ['/d', '/c', 'start', '', url], {
              windowsHide: true,
              stdio: 'ignore',
            });
        browser.on('error', () => console.log(`Open ${url}`));
      }
      break;
    }
  } catch {
    /* Server startup can take a moment on the first launch. */
  }
  await new Promise((ok) => setTimeout(ok, 150));
}
