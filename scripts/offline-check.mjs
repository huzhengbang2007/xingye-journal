import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join, basename, extname } from 'node:path';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
    : 'playwright-core'
);
const root = fileURLToPath(new URL('../', import.meta.url)),
  dir = mkdtempSync(join(tmpdir(), 'xingye-offline-')),
  port = 3214,
  origin = `http://127.0.0.1:${port}`,
  app = 'https://appassets.androidplatform.net';
const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    PORT: String(port),
    HOST: '127.0.0.1',
    TLS_PFX_PATH: '',
    TLS_CERT_PATH: '',
    TLS_KEY_PATH: '',
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser,
  cookie = '',
  csrf = '';
const computerPassword = 'computer-test-password',
  phonePassword = 'phone-local-password';
async function remote(path, data) {
  const res = await fetch(origin + '/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: cookie,
      ...(data === undefined
        ? {}
        : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw Object.assign(new Error(result.error), { status: res.status });
  if (['setup', 'unlock'].includes(path)) {
    cookie = res.headers.get('set-cookie').split(';')[0];
    csrf = result.csrf;
  }
  return result;
}
try {
  await new Promise((r, j) => {
    child.stdout.once('data', r);
    child.once('error', j);
  });
  await remote('setup', { password: computerPassword });
  await remote('events', {
    title: '电脑上的安排',
    date: '2026-10-25',
    start: '09:00',
    end: '10:00',
  });
  await remote('lock', {});
  cookie = '';
  csrf = '';
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  });
  let rpcCount = 0;
  let unlockCount = 0,
    mergeCount = 0;
  let paired = false,
    pauseMerge = false,
    mergeReached,
    releaseMerge;
  const errors = [];
  await context.route(app + '/**', async (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path === '/') path = '/index.html';
    const allowed = ['.html', '.js', '.css', '.svg', '.png', '.webmanifest'];
    if (path.includes('..') || !allowed.includes(extname(path)))
      return route.fulfill({ status: 404, body: '' });
    try {
      const contentType = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json',
      }[extname(path)];
      await route.fulfill({
        status: 200,
        contentType,
        body: readFileSync(join(root, 'public', path.slice(1))),
      });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await context.exposeBinding('nativeTestRequest', async (_, message) => {
    try {
      if (message.type === 'sync.disconnect') return {};
      if (message.type === 'appearance.set') return {};
      if (message.type === 'pairing.resume') return {};
      if (message.type === 'pairing.status') return { paired, origin: 'https://192.168.1.23:3211' };
      if (message.type === 'pairing.forget') {
        paired = false;
        return {};
      }
      if (message.type === 'pairing.scan') {
        paired = true;
        return { paired };
      }
      rpcCount++;
      if (message.type === 'file.save') return { saved: true };
      if (message.type !== 'pairing.sync')
        throw new Error('Unexpected native action ' + message.type);
      if (!cookie)
        throw Object.assign(new Error('电脑尚未解锁，请在电脑打开并解锁星野记'), { status: 423 });
      if (message.action === 'metadata') return remote('sync/metadata');
      if (message.action === 'snapshot') return remote('sync/snapshot');
      if (message.action === 'merge') {
        mergeCount++;
        if (pauseMerge) {
          mergeReached?.();
          await new Promise((resolve) => {
            releaseMerge = resolve;
          });
        }
        return remote('sync/merge', message.body);
      }
      throw new Error('Unknown request');
    } catch (error) {
      return { __nativeError: { message: error.message, status: error.status } };
    }
  });
  await context.addInitScript(() => {
    window.addEventListener('load', () => {
      const channel = new MessageChannel();
      channel.port1.onmessage = async (e) => {
        const m = JSON.parse(e.data);
        try {
          const data = await window.nativeTestRequest(m);
          if (data.__nativeError)
            throw Object.assign(new Error(data.__nativeError.message), {
              status: data.__nativeError.status,
            });
          channel.port1.postMessage(JSON.stringify({ requestId: m.requestId, ok: true, data }));
        } catch (error) {
          channel.port1.postMessage(
            JSON.stringify({
              requestId: m.requestId,
              ok: false,
              error: error.message,
              status: error.status,
            }),
          );
        }
      };
      window.postMessage('xingye:bridge', location.origin, [channel.port2]);
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await context.setOffline(true);
  await page.goto(app);
  await page.locator('#auth-submit').waitFor();
  await page.locator('#password').fill(phonePassword);
  await page.locator('#confirm-password').fill(phonePassword);
  await page.locator('#auth-submit').click();
  await page.locator('.hero').waitFor();
  assert.equal(rpcCount, 0);
  await page.locator('.mobile-nav [data-nav=calendar]').click();
  await page.locator('[data-new=event]').first().click();
  await page.locator('#event-form [name=title]').fill('手机离线创建的安排');
  await page.locator('#event-form [name=date]').fill('2026-10-25');
  await page.locator('#event-form button[type=submit]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('.mobile-nav [data-nav=ledger]').click();
  await page.locator('[data-import=wechat]').first().click();
  await page.locator('#import-file').setInputFiles(join(root, 'examples/微信账单示例.csv'));
  await page.locator('#commit-import').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('.mobile-nav [data-nav=diary]').click();
  await page.locator('#diary-unlock-form [name=password]').fill('phone-diary-password');
  await page.locator('#diary-unlock-form [name=confirm]').fill('phone-diary-password');
  await page.locator('#diary-unlock-form button').click();
  await page.locator('#diary-new').click();
  await page.locator('#diary-title').fill('离线的秘密');
  await page.locator('#diary-body').fill('独立保存在手机，仍然二次加密。');
  await page.locator('#diary-save').click();
  await page.getByText('已加密保存 · 仅在此设备', { exact: true }).waitFor();
  await page.locator('#diary-lock').click();
  await page.reload();
  await page.locator('#password').fill(phonePassword);
  await page.locator('#auth-submit').click();
  await page.locator('.hero').waitFor();
  assert.equal(rpcCount, 0);
  await page.locator('.mobile-nav [data-nav=calendar]').click();
  await page.getByRole('button', { name: /手机离线创建的安排/ }).waitFor();
  await remote('unlock', { password: computerPassword });
  await page.locator('#sync-status').click();
  await page.getByRole('button', { name: /电脑上的安排/ }).waitFor();
  assert.equal((await remote('state')).events.length, 2);
  assert.equal((await remote('state')).transactions.length, 4);
  assert.ok((await remote('diary')).envelope);
  assert.ok(rpcCount >= 2);
  assert.equal(unlockCount, 0);
  // Repeat sync uses the paired credential, with no password or confirmation dialog.
  await remote('events', { title: '一键新增', date: '2026-10-25', start: '13:00', end: '14:00' });
  await page.locator('#sync-status').click();
  await page.getByRole('button', { name: /一键新增/ }).waitFor();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  assert.equal(unlockCount, 0);
  assert.equal(mergeCount, 2);
  // If the rollback copy cannot be saved, the computer must remain untouched.
  await remote('events', {
    title: '等待合并的电脑记录',
    date: '2026-10-25',
    start: '14:00',
    end: '14:30',
  });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (window.failSyncWrite === key)
        throw new DOMException('Test storage full', 'QuotaExceededError');
      return put.call(this, value, key);
    };
    window.failSyncWrite = 'before-sync';
  });
  await page.locator('#sync-status').click();
  await page
    .locator('#toast')
    .filter({ hasText: /storage full/ })
    .waitFor();
  assert.equal(mergeCount, 2);
  // Failure saving the local result retains the previous local vault and its backup.
  await remote('events', {
    title: '电脑保存未丢失',
    date: '2026-10-25',
    start: '15:00',
    end: '16:00',
  });
  await page.evaluate(() => {
    window.failSyncWrite = 'current';
  });
  await page.locator('#sync-status').click();
  await page
    .locator('#toast')
    .filter({ hasText: /本机保存失败/ })
    .waitFor();
  assert.equal(mergeCount, 3);
  const oldSnapshots = await page.evaluate(async (password) => {
    const { portableOpen } = await import('/offline.js');
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('xingye-private-local');
      request.onsuccess = () => resolve(request.result);
    });
    const read = (key) =>
      new Promise((resolve) => {
        const request = db.transaction('vault').objectStore('vault').get(key);
        request.onsuccess = () => resolve(request.result);
      });
    const current = (await portableOpen(await read('current'), password)).state;
    const previous = (await portableOpen(await read('before-sync'), password)).state;
    return {
      current: current.events.map((e) => e.title),
      previous: previous.events.map((e) => e.title),
    };
  }, phonePassword);
  assert.ok(!oldSnapshots.current.includes('电脑保存未丢失'));
  assert.deepEqual(oldSnapshots.current, oldSnapshots.previous);
  assert.ok((await remote('state')).events.some((e) => e.title === '电脑保存未丢失'));
  await page.evaluate(() => {
    window.failSyncWrite = '';
  });
  await page.locator('#sync-status').click();
  await page.locator('#sync-status').filter({ hasText: '已同步' }).waitFor();
  const recovered = await page.evaluate(async (password) => {
    const { portableOpen } = await import('/offline.js');
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('xingye-private-local');
      request.onsuccess = () => resolve(request.result);
    });
    const envelope = await new Promise((resolve) => {
      const request = db.transaction('vault').objectStore('vault').get('current');
      request.onsuccess = () => resolve(request.result);
    });
    return (await portableOpen(envelope, password)).state.events.map((e) => e.title);
  }, phonePassword);
  assert.ok(recovered.includes('电脑保存未丢失'));
  // Locking the computer stops data sync without erasing the pairing.
  await remote('lock', {});
  cookie = '';
  csrf = '';
  await page.locator('#sync-status').click();
  await page.locator('#sync-status').filter({ hasText: '等待电脑解锁' }).waitFor();
  assert.equal(await page.locator('input[name=origin], #offline-connect-form').count(), 0);
  await remote('unlock', { password: computerPassword });
  await page.locator('#sync-status').click();
  await page.locator('#sync-status').filter({ hasText: '已同步' }).waitFor();
  assert.equal(unlockCount, 0);
  // Divergent edits require an explicit choice; an outdated preview cannot overwrite new remote work.
  await page.getByRole('button', { name: /手机离线创建的安排/ }).click();
  await page.locator('#event-form [name=title]').fill('手机选择保留的安排');
  await page.locator('#event-form button[type=submit]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  const original = (await remote('state')).events.find((e) => e.title === '手机离线创建的安排');
  const { done, ...editable } = original;
  await remote('events/update', {
    ...editable,
    title: '电脑另外修改',
    expectedVersion: original.version,
  });
  await page.locator('#sync-status').click();
  await page.locator('[data-conflict]').waitFor();
  assert.equal(await page.locator('#pair-conflict-save').isDisabled(), true);
  await page.locator('[data-conflict]').selectOption('local');
  await remote('events', {
    title: '预览期间电脑新增',
    date: '2026-10-26',
    start: '10:00',
    end: '11:00',
  });
  await page.locator('#pair-conflict-save').click();
  await page
    .locator('#pair-conflict-error')
    .filter({ hasText: /电脑上的记录已变化/ })
    .waitFor();
  assert.ok((await remote('state')).events.some((e) => e.title === '预览期间电脑新增'));
  await page.locator('#close-modal').click();
  await page.locator('#sync-status').click();
  // The compared versions are unchanged: retain the explicit previous choice on retry.
  await page.locator('#sync-status').filter({ hasText: '已同步' }).waitFor();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-conflict]').count(), 0);
  assert.equal(unlockCount, 0);
  assert.ok((await remote('state')).events.some((e) => e.title === '手机选择保留的安排'));
  assert.ok((await remote('state')).events.some((e) => e.title === '预览期间电脑新增'));
  // Foreground polling brings in remote changes without pressing sync.
  await remote('events', {
    title: '电脑自动抵达',
    date: '2026-10-27',
    start: '17:00',
    end: '18:00',
  });
  await page.getByRole('button', { name: /电脑自动抵达/ }).waitFor({ timeout: 35000 });
  await page.locator('[data-new=event]').first().click();
  await page.locator('#event-form [name=title]').fill('手机保存后自动同步');
  await page.locator('#event-form [name=date]').fill('2026-10-25');
  await page.locator('#event-form button[type=submit]').click();
  await page.waitForFunction(
    () => document.querySelector('#sync-status')?.textContent === '已同步',
  );
  for (
    let i = 0;
    i < 20 && !(await remote('state')).events.some((e) => e.title === '手机保存后自动同步');
    i++
  )
    await new Promise((r) => setTimeout(r, 300));
  assert.ok((await remote('state')).events.some((e) => e.title === '手机保存后自动同步'));
  // Starting a form edit during an in-flight merge must defer the page refresh.
  pauseMerge = true;
  const reachedMerge = new Promise((resolve) => {
    mergeReached = resolve;
  });
  await remote('events', {
    title: '编辑期间抵达',
    date: '2026-10-28',
    start: '10:00',
    end: '11:00',
  });
  await page.locator('#sync-status').click();
  await Promise.race([
    reachedMerge,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Merge gate timed out')), 10000)),
  ]);
  await page.locator('.mobile-nav [data-nav=settings]').click();
  await page.locator('#settings-form [name=name]').fill('编辑中的新名字');
  pauseMerge = false;
  releaseMerge();
  await page.locator('#sync-status').filter({ hasText: '保存编辑后更新' }).waitFor();
  assert.equal(await page.locator('#settings-form [name=name]').inputValue(), '编辑中的新名字');
  await page.locator('#settings-form button[type=submit]').click();
  await page.waitForFunction(() =>
    document.querySelector('#profile-name')?.textContent.includes('编辑中的新名字'),
  );
  await page.locator('.mobile-nav [data-nav=diary]').click();
  await page.locator('#diary-unlock-form [name=password]').fill('phone-diary-password');
  await page.locator('#diary-unlock-form button').click();
  await page.locator('#diary-body').waitFor();
  assert.equal(await page.locator('#diary-body').inputValue(), '独立保存在手机，仍然二次加密。');
  await page.locator('#diary-lock').click();
  await page.locator('.mobile-nav [data-nav=dashboard]').click();
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({
    path: join(root, 'artifacts/mobile-independent-app.png'),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    'Offline app passed: offline persistence, scan pairing without a computer password, automatic foreground sync, preserved in-flight edits, storage failure recovery, computer lock/unlock and diary ciphertext conflicts.',
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
  const full = resolve(dir);
  if (full.startsWith(resolve(tmpdir()) + '\\') && basename(full).startsWith('xingye-offline-'))
    rmSync(full, { recursive: true });
}
