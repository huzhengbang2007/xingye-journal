// Windows integration check. Uses isolated data; no user vault or system trust changes.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, basename, sep } from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import { createHash, X509Certificate } from 'node:crypto';
import { chromium } from 'playwright-core';
import { event } from '../public/domain.js';
import { mergeSnapshots, syncBase } from '../public/sync.js';

assert.equal(process.platform, 'win32', 'This check exercises Windows DPAPI identity generation');
const root = resolve(import.meta.dirname, '..');
const applicationRoot = process.env.XINGYE_PACKAGE_ROOT
  ? resolve(process.env.XINGYE_PACKAGE_ROOT)
  : root;
const runtimeNode = process.env.XINGYE_PACKAGE_ROOT
  ? join(applicationRoot, 'runtime/node.exe')
  : process.execPath;
const data = mkdtempSync(join(tmpdir(), 'xingye-device-e2e-'));
const java = process.env.JAVA_HOME || 'C:/Program Files/Eclipse Adoptium/jdk-25.0.4.7-hotspot';
const zxing =
  process.env.ZXING_CORE_JAR ||
  join(
    homedir(),
    '.gradle/caches/modules-2/files-2.1/com.google.zxing/core/3.4.1/1869da97e9b2b60b5ff2fcaf55899174b93ae25d/core-3.4.1.jar',
  );
const classes = join(data, 'classes');
mkdirSync(classes);
const compiled = spawnSync(
  join(java, 'bin/javac.exe'),
  [
    '-encoding',
    'UTF-8',
    '-cp',
    zxing,
    '-d',
    classes,
    resolve(root, 'android-companion/checks/QrDecodeCheck.java'),
    resolve(root, 'android-companion/checks/PinnedIdentityCheck.java'),
    resolve(root, 'android-companion/app/src/main/java/cn/xingyeji/companion/PinnedIdentity.java'),
  ],
  { encoding: 'utf8', windowsHide: true },
);
assert.equal(compiled.status, 0, compiled.stderr);
let child,
  browser,
  origin,
  cookie = '',
  csrf = '';
const password = 'isolated-device-sync-check';
async function start() {
  child = spawn(runtimeNode, [resolve(applicationRoot, 'server.mjs')], {
    env: {
      ...process.env,
      DATA_DIR: data,
      HOST: '127.0.0.1',
      PORT: '0',
      XINGYE_DESKTOP: '1',
      TLS_PFX_PATH: '',
      TLS_CERT_PATH: '',
      TLS_KEY_PATH: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '',
    stderr = '';
  child.stderr.on('data', (b) => (stderr += b));
  const port = await new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error('startup timed out: ' + stderr)), 90000);
    child.stdout.on('data', (b) => {
      stdout += b;
      const match = /XINGYE_DESKTOP_READY (\{[^\n]+\})/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        ok(JSON.parse(match[1]).port);
      }
    });
    child.once('error', bad);
    child.once('exit', () => {
      clearTimeout(timer);
      bad(new Error('startup failed: ' + stderr));
    });
  });
  origin = `http://127.0.0.1:${port}`;
}
async function stop() {
  if (child && child.exitCode === null) {
    const exited = new Promise((ok) => child.once('exit', ok));
    child.stdin.end();
    await exited;
  }
}
async function local(path, body) {
  const res = await fetch(origin + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: cookie,
      ...(body === undefined
        ? {}
        : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(75000),
  });
  const result = await res.json();
  if (['setup', 'unlock'].includes(path)) {
    cookie = res.headers.get('set-cookie')?.split(';')[0] || cookie;
    csrf = result.csrf;
  }
  if (!res.ok) throw Object.assign(new Error(result.error), { status: res.status });
  return result;
}
function publicCertificate(port) {
  return new Promise((ok, bad) => {
    const connection = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
      const raw = connection.getPeerCertificate().raw;
      connection.end();
      ok(raw);
    });
    connection.on('error', bad);
  });
}
try {
  await start();
  await local('setup', { password });
  await local('events', { title: '电脑记录', date: '2026-10-25', start: '08:00', end: '09:00' });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await page.locator('#password').fill(password);
  await page.locator('#auth-submit').click();
  await page.locator('.hero').waitFor();
  const response = page.waitForResponse((r) => r.url().endsWith('/api/pairing/invite'));
  await page.locator('#sync-status').click();
  const invitation = await (await response).json();
  assert.equal(invitation.type, 'xingye-pair', JSON.stringify(invitation));
  await page.locator('.pairing-code').waitFor();
  const image = resolve(root, 'artifacts/device-pairing-qr.png');
  await page.locator('.pairing-code').screenshot({ path: image });
  const decoded = spawnSync(
    join(java, 'bin/java.exe'),
    ['-cp', classes + ';' + zxing, 'QrDecodeCheck', image],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(decoded.status, 0, decoded.stderr);
  assert.deepEqual(
    JSON.parse(decoded.stdout),
    invitation,
    "the displayed QR is decoded by Android's ZXing core",
  );
  const port = Number(new URL(invitation.addresses[0]).port);
  const raw = await publicCertificate(port);
  assert.equal(createHash('sha256').update(raw).digest('hex'), invitation.fingerprint);
  const ca = new X509Certificate(raw).toString();
  const remote = (path, body, token) =>
    new Promise((ok, bad) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: body === undefined ? 'GET' : 'POST',
          ca,
          checkServerIdentity: (_, c) =>
            createHash('sha256').update(c.raw).digest('hex') === invitation.fingerprint
              ? undefined
              : new Error('wrong computer'),
          headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          let bytes = '';
          res.on('data', (b) => (bytes += b));
          res.on('end', () => {
            const result = JSON.parse(bytes);
            if (res.statusCode >= 400)
              bad(Object.assign(new Error(result.error), { status: res.statusCode }));
            else ok(result);
          });
        },
      );
      req.on('error', bad);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  for (const [pin, expected] of [
    [invitation.fingerprint, '401'],
    ['0'.repeat(64), 'reject'],
  ]) {
    // Async child allows this process to keep serving the TLS handshake.
    const check = spawn(
      join(java, 'bin/java.exe'),
      [
        '-cp',
        classes,
        'PinnedIdentityCheck',
        `https://127.0.0.1:${port}/sync/snapshot`,
        pin,
        expected,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    check.stderr.on('data', (b) => (stderr += b));
    check.stdout.resume();
    assert.equal(await new Promise((ok) => check.once('exit', ok)), 0, stderr);
  }
  const pending = await remote('/pair/request', { code: invitation.code, name: '模拟手机' });
  await page.locator('[data-pair-approve]').click();
  const phone = await remote('/pair/poll', pending);
  const base = await remote('/sync/snapshot', undefined, phone.token);
  const phoneLocal = {
    events: [event({ title: '手机离线记录', date: '2026-10-25', start: '10:00', end: '11:00' })],
    transactions: [],
    diary: null,
  };
  const merged = mergeSnapshots(phoneLocal, base, {});
  assert.equal(merged.conflicts.length, 0);
  const first = await remote(
    '/sync/merge',
    { ...merged, vaultId: base.vaultId, expectedRevision: base.revision },
    phone.token,
  );
  assert.equal(first.events.length, 2);
  await assert.rejects(
    remote(
      '/sync/merge',
      { ...merged, vaultId: base.vaultId, expectedRevision: base.revision },
      phone.token,
    ),
    (e) => e.status === 409,
  );
  const unchanged = await remote(
    '/sync/merge',
    { ...first, expectedRevision: first.revision },
    phone.token,
  );
  assert.equal(unchanged.revision, first.revision, 'no-op does not create sync loops');
  const beforeTabletBackup = await local('backup');
  const tabletInvite = await local('pairing/invite', {});
  const tabletPending = await remote('/pair/request', {
    code: tabletInvite.code,
    name: '模拟平板',
  });
  await local('pairing/approve', { id: tabletPending.requestId, allow: true });
  const tablet = await remote('/pair/poll', tabletPending);
  const tabletRemote = await remote('/sync/snapshot', undefined, tablet.token);
  const tabletLocal = {
    events: [event({ title: '平板离线记录', date: '2026-10-25', start: '13:00', end: '14:00' })],
    transactions: [],
    diary: null,
  };
  const combined = mergeSnapshots(tabletLocal, tabletRemote, {});
  await remote(
    '/sync/merge',
    { ...combined, vaultId: tabletRemote.vaultId, expectedRevision: tabletRemote.revision },
    tablet.token,
  );
  const phoneRemote = await remote('/sync/snapshot', undefined, phone.token);
  assert.equal(mergeSnapshots(first, phoneRemote, syncBase(first)).events.length, 3);
  assert.equal((await local('state')).events.length, 3);
  await local('lock-all', {});
  await assert.rejects(remote('/sync/snapshot', undefined, phone.token), (e) => e.status === 423);
  await local('unlock', { password });
  assert.equal((await remote('/sync/snapshot', undefined, phone.token)).events.length, 3);
  await stop();
  cookie = '';
  csrf = '';
  await start();
  await local('unlock', { password });
  const restoredStatus = await local('pairing/status');
  assert.equal(restoredStatus.enabled, true, JSON.stringify(restoredStatus));
  await local('lock-all', {});
  await assert.rejects(remote('/sync/snapshot', undefined, phone.token), (e) => e.status === 423);
  await local('unlock', { password });
  assert.equal(
    (await remote('/sync/snapshot', undefined, phone.token)).events.length,
    3,
    'stored device survives Windows service restart',
  );
  const nextInvitation = await local('pairing/invite', {});
  assert.equal(
    nextInvitation.computerId,
    invitation.computerId,
    'Windows DPAPI identity is stable across restart',
  );
  await local('pairing/revoke', { id: phone.deviceId });
  await assert.rejects(remote('/sync/snapshot', undefined, phone.token), (e) => e.status === 401);
  assert.equal((await remote('/sync/snapshot', undefined, tablet.token)).events.length, 3);
  await local('restore', {
    content: Buffer.from(JSON.stringify(beforeTabletBackup)).toString('base64'),
    password,
  });
  await assert.rejects(remote('/sync/snapshot', undefined, phone.token), (e) => e.status === 401);
  assert.equal(
    (await remote('/sync/snapshot', undefined, tablet.token)).events.length,
    2,
    'restoring pre-tablet backup keeps the currently paired tablet authorized',
  );
  assert.ok(!JSON.stringify(await local('state')).includes(phone.token));
  assert.deepEqual(errors, []);
  console.log(
    `Windows pairing passed: actual QR decoded by ZXing, Java pinned TLS, wrong identity rejection, approval, three-device merge, stale revision/no-op, lock/unlock, DPAPI restart, device revocation and restore preserving current authorization. Root: ${applicationRoot}; runtime: ${runtimeNode}; version: ${JSON.parse(readFileSync(join(applicationRoot, 'package.json'))).version}. Physical Android camera/network tests remain separate.`,
  );
} finally {
  await browser?.close();
  await stop();
  const cleanupPath = resolve(data);
  assert.ok(
    cleanupPath.startsWith(resolve(tmpdir()) + sep) &&
      basename(cleanupPath).startsWith('xingye-device-e2e-'),
    'Refuse cleanup outside the isolated test directory',
  );
  rmSync(cleanupPath, { recursive: true, force: true });
}
