// Optional developer check. Set PLAYWRIGHT_MODULE to the installed Playwright index.mjs.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join, basename } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
    : 'playwright-core'
);
const root = fileURLToPath(new URL('../', import.meta.url)),
  dir = mkdtempSync(join(tmpdir(), 'daylight-ui-'));
const port = '3212';
const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    PORT: port,
    HOST: '127.0.0.1',
    TLS_PFX_PATH: '',
    TLS_CERT_PATH: '',
    TLS_KEY_PATH: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let browser;
try {
  await new Promise((r, j) => {
    child.stdout.once('data', r);
    child.once('error', j);
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (
      msg.type() === 'error' &&
      !(msg.text().includes('409 (Conflict)') && msg.location().url.endsWith('/api/diary/save'))
    )
      errors.push(msg.text());
  });
  const shots = join(root, 'artifacts');
  mkdirSync(shots, { recursive: true });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('#auth-submit').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(shots, 'welcome-desktop.png'), fullPage: true });
  await page.locator('#password').fill('ui-test-password-2026');
  await page.locator('#confirm-password').fill('ui-test-password-2026');
  await page.locator('#auth-submit').click();
  await page.locator('.hero').waitFor();
  await page.locator('#quick-add').click();
  await page.locator('#event-form [name=title]').fill('需要恢复的加密草稿');
  await page.locator('#close-modal').click();
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'draft recovery fits a small phone',
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('#lock-button').click();
  await page.locator('#auth').waitFor({ state: 'visible' });
  await page.locator('#password').fill('ui-test-password-2026');
  await page.locator('#auth-submit').click();
  await page.locator('#form-drafts').click();
  await page.locator('#draft-list button').first().click();
  assert.equal(await page.locator('#event-form [name=title]').inputValue(), '需要恢复的加密草稿');
  await page.locator('#close-modal').click();
  await page.locator('#form-drafts').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#draft-list button').nth(1).click();
  await page.locator('#close-modal').click();
  await page.evaluate(() => {
    window.mainRenders = 0;
    window.renderObserver = new MutationObserver((rows) => {
      window.mainRenders += rows.filter(
        (r) => r.target === document.querySelector('#content') && r.type === 'childList',
      ).length;
    });
    window.renderObserver.observe(document.querySelector('#content'), { childList: true });
  });
  await page.locator('#quick-add').click();
  await page.locator('#event-form [name=title]').fill('完成第一份学习计划');
  await page.locator('#event-form [name=location]').fill('图书馆');
  await page.locator('#event-form button[type=submit]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.getByText('完成第一份学习计划', { exact: true }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => window.mainRenders),
    1,
    'one save must render the main workspace once',
  );
  await page.evaluate(() => window.renderObserver.disconnect());
  await page.locator('[data-import=wechat]').first().click();
  await page.locator('#import-file').setInputFiles(join(root, 'examples/微信账单示例.csv'));
  await page.locator('#commit-import').waitFor();
  await page.locator('#commit-import').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: join(shots, 'dashboard-desktop.png'), fullPage: true });
  assert.equal(
    await page
      .locator('.card')
      .first()
      .evaluate((el) => getComputedStyle(el).backdropFilter),
    'none',
  );
  for (const view of ['calendar', 'planner', 'ledger', 'reports', 'settings']) {
    await page.locator(`.sidebar [data-nav=${view}]`).click();
    await page.locator('#content h1').waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `overflow on desktop ${view}`,
    );
  }
  const diagnosticDownload = page.waitForEvent('download');
  await page.locator('#export-diagnostics').click();
  const diagnosticFile = await diagnosticDownload;
  const diagnosticText = readFileSync(await diagnosticFile.path(), 'utf8');
  const diagnostic = JSON.parse(diagnosticText);
  assert.ok(diagnostic.counts.events >= 1);
  assert.ok(!diagnosticText.includes('完成第一份学习计划'));
  assert.ok(!diagnosticText.includes('ui-test-password-2026'));
  await page.locator('.sidebar [data-nav=ledger]').click();
  await page.locator('[data-edit-tx]').first().click();
  await page.locator('#transaction-form [name=merchant]').fill('学校食堂（已核对）');
  await page.locator('#transaction-form button[type=submit]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.getByText('学校食堂（已核对）', { exact: true }).waitFor();
  await page.locator('.sidebar [data-nav=planner]').click();
  await page.locator('#plan-form [name=goal]').fill('每天练习一小时英语');
  await page.locator('#plan-form button[type=submit]').click();
  await page.locator('[data-action=apply-plan]').waitFor();
  await page.locator('[data-action=apply-plan]').click();
  await page.locator('#plan-result .empty').waitFor();
  // Two independently authenticated browsers must coexist and receive changes.
  const secondContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    timezoneId: 'Asia/Shanghai',
  });
  const second = await secondContext.newPage();
  await second.goto(`http://127.0.0.1:${port}`);
  await second.locator('#password').fill('ui-test-password-2026');
  await second.locator('#auth-submit').click();
  await second.locator('.hero').waitFor();
  await page.locator('.sidebar [data-nav=calendar]').click();
  const gestureDate = await page.evaluate(() => {
    const d = new Date();
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    return new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
  });
  await page
    .locator(`[data-calendar-date="${gestureDate}"]`)
    .click({ button: 'right', position: { x: 3, y: 75 } });
  await page.locator('#event-form').waitFor();
  assert.equal(await page.locator('#event-form [name=date]').inputValue(), gestureDate);
  await page.locator('#event-form [name=title]').fill('协同测试的星光');
  await page.locator('#event-form button[type=submit]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await second.locator('.sidebar [data-nav=calendar]').click();
  await second.getByRole('button', { name: /协同测试的星光/ }).waitFor();
  // Second key: setup, save, lock on leaving, wrong password, and cross-device edit conflict.
  await page.locator('.sidebar [data-nav=diary]').click();
  await page.locator('#diary-unlock-form').waitFor();
  await page.locator('#diary-unlock-form [name=password]').fill('private-diary-test-2026');
  await page.locator('#diary-unlock-form [name=confirm]').fill('private-diary-test-2026');
  await page.locator('#diary-unlock-form button').click();
  await page.locator('#diary-new').waitFor();
  await page.locator('#diary-new').click();
  await page.locator('#diary-title').fill('一颗只属于我的星');
  await page.locator('#diary-body').fill('这段秘密不能进入统计和 AI。');
  await page.locator('#diary-save').click();
  await page.getByText('已加密保存 · 已协同到服务器', { exact: true }).waitFor();
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: join(shots, 'diary-desktop.png'), fullPage: true });
  const publicData = await page.evaluate(async () => await (await fetch('/api/state')).json());
  assert.equal(publicData.diary, undefined);
  assert.equal(JSON.stringify(publicData).includes('这段秘密'), false);
  await page.locator('.sidebar [data-nav=dashboard]').click();
  await page.locator('.sidebar [data-nav=diary]').click();
  await page.locator('#diary-unlock-form').waitFor();
  await page.locator('#diary-unlock-form [name=password]').fill('wrong-diary-password');
  await page.locator('#diary-unlock-form button').click();
  await page.getByText('日记密码不正确或密文已损坏', { exact: true }).waitFor();
  await page.locator('#diary-unlock-form [name=password]').fill('private-diary-test-2026');
  await page.locator('#diary-unlock-form button').click();
  await page.locator('#diary-body').waitFor();
  assert.equal(await page.locator('#diary-body').inputValue(), '这段秘密不能进入统计和 AI。');
  await second.locator('.sidebar [data-nav=diary]').click();
  await second.locator('#diary-unlock-form').waitFor();
  await second.locator('#diary-unlock-form [name=password]').fill('private-diary-test-2026');
  await second.locator('#diary-unlock-form button').click();
  await second.locator('#diary-body').fill('另一台设备保存的手记');
  await second.locator('#diary-save').click();
  await second.getByText('已加密保存 · 已协同到服务器', { exact: true }).waitFor();
  await page.locator('#diary-body').fill('当前设备的未保存编辑');
  await page.locator('#diary-save').click();
  await page.getByRole('status').filter({ hasText: '另一台设备已更新日记' }).waitFor();
  assert.equal(await page.locator('#diary-body').inputValue(), '当前设备的未保存编辑');
  page.once('dialog', (d) => d.accept());
  await page.locator('#diary-lock').click();
  await page.locator('#diary-unlock-form').waitFor();
  await page.waitForFunction(() => Boolean(sessionStorage.getItem('xingye.diary.encrypted-draft')));
  const encryptedDraft = await page.evaluate(() =>
    sessionStorage.getItem('xingye.diary.encrypted-draft'),
  );
  assert.equal(encryptedDraft.includes('当前设备的未保存编辑'), false);
  page.once('dialog', (d) => d.accept());
  await page.locator('#diary-unlock-form [name=password]').fill('private-diary-test-2026');
  await page.locator('#diary-unlock-form button').click();
  await page.locator('#diary-body').waitFor();
  page.once('dialog', (d) => d.accept());
  await page.locator('.diary-entry').filter({ hasText: '恢复草稿' }).click();
  assert.equal(await page.locator('#diary-body').inputValue(), '当前设备的未保存编辑');
  await page.locator('#diary-save').click();
  await page.waitForFunction(() => !sessionStorage.getItem('xingye.diary.encrypted-draft'));
  await page.locator('#diary-lock').click();
  await page.locator('#diary-unlock-form').waitFor();
  await second.locator('#lock-button').click();
  await second.locator('#auth').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#app').isVisible(), true);
  await secondContext.close();
  await page.locator('.sidebar [data-nav=settings]').click();
  await page.evaluate(() => {
    const channel = new MessageChannel();
    window.nativeTestMessages = [];
    channel.port1.onmessage = (e) => window.nativeTestMessages.push(JSON.parse(e.data));
    window.postMessage('xingye:bridge', location.origin, [channel.port2]);
  });
  await page.locator('#native-calendar').waitFor();
  await page.locator('#native-calendar').check();
  await page.waitForFunction(() =>
    window.nativeTestMessages.some((m) => m.type === 'calendar.sync'),
  );
  const nativePayload = await page.evaluate(() =>
    window.nativeTestMessages.find((m) => m.type === 'calendar.sync'),
  );
  assert.ok(nativePayload.events.length > 0);
  assert.equal(JSON.stringify(nativePayload).includes('这段秘密'), false);
  assert.equal(JSON.stringify(nativePayload).includes('private-diary'), false);
  assert.ok(nativePayload.events.every((e) => typeof e.reminder === 'number'));
  await page.locator('#native-calendar').uncheck();
  await page.locator('.sidebar [data-nav=dashboard]').click();
  await page.setViewportSize({ width: 393, height: 852 });
  for (const view of ['dashboard', 'calendar', 'planner', 'ledger', 'settings']) {
    await page.locator(`.mobile-nav [data-nav=${view}]`).click();
    await page.locator('#content h1').waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `overflow on phone ${view}`,
    );
    if (view === 'dashboard') await page.locator('#toast').evaluate((el) => (el.hidden = true));
    if (view === 'dashboard')
      await page.screenshot({ path: join(shots, 'dashboard-phone.png'), fullPage: true });
  }
  await page.locator('.mobile-nav [data-nav=calendar]').click();
  const touchCell = page.locator(`[data-calendar-date="${gestureDate}"]`);
  await touchCell.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 40, clientY: 400 });
  await page.locator('#event-form').waitFor();
  assert.equal(await page.locator('#event-form [name=date]').inputValue(), gestureDate);
  await touchCell.dispatchEvent('pointerup', { pointerType: 'touch' });
  await page.locator('#close-modal').click();
  await page.locator('.mobile-nav [data-nav=diary]').click();
  await page.locator('#diary-unlock-form').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(shots, 'diary-phone-locked.png'), fullPage: true });
  await page.locator('.mobile-nav [data-nav=dashboard]').click();
  await page.locator('[data-nav=reports]').filter({ hasText: '打开我的月度复盘' }).click();
  await page.screenshot({ path: join(shots, 'reports-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1137, height: 712 });
  await page.locator('.sidebar [data-nav=calendar]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#toast').evaluate((el) => (el.hidden = true));
  await page.screenshot({ path: join(shots, 'calendar-tablet.png'), fullPage: true });
  await page.locator('#lock-button').click();
  await page.locator('#auth').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#content').textContent(), '');
  await page.locator('#password').fill('ui-test-password-2026');
  await page.locator('#auth-submit').click();
  await page.locator('#app').waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: multi-device sync, right-click/long press, diary encryption/conflicts, original flows and responsive layouts.',
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
  const absolute = resolve(dir);
  if (
    absolute.startsWith(resolve(tmpdir()) + '\\') &&
    basename(absolute).startsWith('daylight-ui-')
  )
    rmSync(absolute, { recursive: true });
}
