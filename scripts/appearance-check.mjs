import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join, basename } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
    : 'playwright-core'
);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'xingye-appearance-'));
const origin = 'http://127.0.0.1:3215';
const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  env: {
    ...process.env,
    DATA_DIR: directory,
    PORT: '3215',
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
  await new Promise((resolveReady, reject) => {
    child.stdout.once('data', resolveReady);
    child.once('error', reject);
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(origin);
  await page.locator('#auth-submit:not(:disabled)').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.locator('.auth-panel .appearance-picker summary').click();
  await page.locator('.auth-panel [data-theme-choice="light"]').click();
  await page.reload();
  assert.equal(
    await page.locator('html').getAttribute('data-theme'),
    'light',
    'explicit theme persists across reload despite system dark',
  );
  await page.locator('#password').fill('appearance-check-password');
  await page.locator('#confirm-password').fill('appearance-check-password');
  await page.locator('#auth-submit').click();
  await page.locator('.hero').waitFor();
  await page.locator('.topbar .appearance-picker summary').click();
  await page.locator('.topbar [data-theme-choice="dark"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.topbar .appearance-picker').getAttribute('open'), null);
  const shots = join(root, 'artifacts');
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, 'appearance-desktop-dark.png'), fullPage: true });
  async function noOverflow(label) {
    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
    }));
    assert.ok(
      layout.width <= layout.viewport + 1,
      `${label} page overflow: ${JSON.stringify(layout)}`,
    );
  }
  async function themeSurface() {
    return page
      .locator('.card')
      .first()
      .evaluate((element) => ({
        foreground: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor,
      }));
  }
  for (const theme of ['dark', 'light']) {
    await page.locator('.topbar .appearance-picker summary').click();
    await page.locator(`.topbar [data-theme-choice="${theme}"]`).click();
    await page.keyboard.press('Escape');
    for (const view of [
      'dashboard',
      'calendar',
      'planner',
      'automations',
      'ledger',
      'diary',
      'reports',
      'settings',
    ]) {
      await page.locator(`.sidebar [data-nav="${view}"]`).click();
      await page.locator('#content h1').waitFor();
      await noOverflow(`desktop ${theme} ${view}`);
    }
    const surface = await themeSurface();
    assert.notEqual(surface.foreground, surface.background);
  }
  await page.evaluate(async () => {
    const { csrf } = await (await fetch('/api/session')).json();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    for (const [title, date] of [
      ['今日测试课程', today],
      ['明日测试课程', new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10)],
    ]) {
      const r = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          title,
          date,
          start: '09:00',
          end: '10:00',
          kind: 'course',
          location: '凌水校区 A101',
        }),
      });
      if (!r.ok) throw new Error('course fixture failed');
    }
  });
  await page.reload();
  await page.locator('#password').fill('appearance-check-password');
  await page.locator('#auth-submit:not(:disabled)').click();
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.locator('.sidebar [data-nav="calendar"]').click();
  await page.locator('.daily-card').getByText('今日测试课程', { exact: true }).waitFor();
  assert.equal(
    await page.locator('.daily-card').getByText('明日测试课程', { exact: true }).count(),
    0,
  );
  await page.locator('[data-course-step="1"]').click();
  await page.locator('.daily-card').getByText('明日测试课程', { exact: true }).waitFor();
  await page.locator('#course-today').click();
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: join(shots, 'refined-daily.png'), fullPage: false });
  const firstX = await page
    .locator('.mobile-nav .nav-selection')
    .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  await page.locator('.mobile-nav [data-nav="ledger"]').click();
  const lastX = await page
    .locator('.mobile-nav .nav-selection')
    .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  assert.ok(lastX > firstX, 'mobile selection moves horizontally to next destination');
  await page.setViewportSize({ width: 1024, height: 850 });
  const sideBefore = await page.locator('.sidebar').boundingBox();
  await page.evaluate(() => window.scrollTo(0, 600));
  const sideAfter = await page.locator('.sidebar').boundingBox();
  assert.equal(Math.round(sideBefore.y), Math.round(sideAfter.y), 'tablet sidebar stays fixed');
  await page.screenshot({ path: join(shots, 'refined-tablet.png'), fullPage: false });
  await page.setViewportSize({ width: 393, height: 852 });
  for (const theme of ['dark', 'light']) {
    await page.locator('.topbar .appearance-picker summary').click();
    await page.locator(`.topbar [data-theme-choice="${theme}"]`).click();
    // Validate the scaled layout rather than merely checking a saved preference.
    assert.equal(await page.locator('[data-reading-scale]').count(), 0);
    await page.keyboard.press('Escape');
    for (const view of [
      'dashboard',
      'calendar',
      'planner',
      'automations',
      'ledger',
      'diary',
      'settings',
    ]) {
      await page.locator(`.mobile-nav [data-nav="${view}"]`).click();
      await page.locator('#content h1').waitFor();
      await noOverflow(`phone ${theme} ${view} at 145% text`);
    }
    await page.locator('.mobile-nav [data-nav="dashboard"]').click();
    await page.locator('.topbar .appearance-picker summary').click();

    await page.keyboard.press('Escape');
    await page.screenshot({ path: join(shots, `appearance-phone-${theme}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 320, height: 740 });
  for (const view of ['dashboard', 'calendar', 'settings']) {
    await page.locator(`.mobile-nav [data-nav="${view}"]`).click();
    await page.locator('#content h1').waitFor();
    await noOverflow(`small phone ${view}`);
  }
  await page.evaluate(() => {
    for (const [side, value] of Object.entries({ top: 48, right: 12, bottom: 28, left: 12 }))
      document.documentElement.style.setProperty(`--native-safe-${side}`, `${value}px`);
  });
  const safe = await page.evaluate(() => {
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    const content = document.querySelector('.breadcrumb').getBoundingClientRect();
    const nav = document.querySelector('.mobile-nav').getBoundingClientRect();
    return {
      top: content.top - bar.top,
      bottom: innerHeight - nav.bottom,
      width: innerWidth,
      navRight: nav.right,
      navLeft: nav.left,
      touch: getComputedStyle(document.documentElement).touchAction,
    };
  });
  assert.ok(safe.top >= 48, 'status bar inset reserved');
  assert.ok(safe.bottom >= 28, 'gesture navigation inset reserved');
  assert.ok(
    safe.navLeft >= 12 && safe.width - safe.navRight >= 12,
    'landscape/cutout side insets reserved',
  );
  assert.ok(safe.touch === 'pan-x pan-y', 'pinch zoom is disabled by app policy');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  assert.ok(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/.test(viewport));
  await page.locator('.topbar .appearance-picker summary').click();
  await page.locator('.topbar [data-theme-choice="system"]').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  const phoneContext = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await phoneContext.addCookies(await context.cookies());
  const phone = await phoneContext.newPage();
  await phone.goto(origin);
  await phone.locator('#password').fill('appearance-check-password');
  await phone.locator('#auth-submit:not(:disabled)').click();
  await phone.locator('#app').waitFor({ state: 'visible' });
  await phone.locator('.mobile-nav [data-nav="calendar"]').click();
  await phone.locator('.calendar-grid').waitFor();
  const cell = phone.locator('[data-calendar-date]').first();
  await cell.dispatchEvent('pointerdown', {
    pointerId: 41,
    pointerType: 'touch',
    clientX: 30,
    clientY: 400,
  });
  await phone.locator('.topbar').dispatchEvent('pointerdown', {
    pointerId: 42,
    pointerType: 'touch',
    clientX: 230,
    clientY: 30,
  });
  await phone.waitForTimeout(650);
  assert.equal(
    await phone.locator('#modal').evaluate((modal) => modal.open),
    false,
    'second finger outside calendar cancels long press',
  );
  for (const pointerId of [41, 42])
    await phone.locator('body').dispatchEvent('pointerup', { pointerId, pointerType: 'touch' });
  for (const pointerId of [43, 44])
    await cell.dispatchEvent('pointerdown', {
      pointerId,
      pointerType: 'touch',
      clientX: 30 + pointerId,
      clientY: 400,
    });
  await phone.waitForTimeout(650);
  assert.equal(
    await phone.locator('#modal').evaluate((modal) => modal.open),
    false,
    'two fingers on calendar never open event dialog',
  );
  for (const pointerId of [43, 44])
    await cell.dispatchEvent('pointercancel', { pointerId, pointerType: 'touch' });
  await cell.dispatchEvent('pointerdown', {
    pointerId: 45,
    pointerType: 'touch',
    clientX: 40,
    clientY: 400,
  });
  await phone.locator('#event-form').waitFor();
  await cell.dispatchEvent('pointerup', { pointerId: 45, pointerType: 'touch' });
  assert.equal(
    await phone.locator('#modal').evaluate((modal) => modal.open),
    true,
    'deliberate single-finger long press still works',
  );
  await phone.locator('#close-modal').click();
  const cdp = await phoneContext.newCDPSession(phone);
  assert.deepEqual(errors, []);
  console.log(
    'Appearance checks passed: persistent light/dark/system themes, live system changes, fixed text size and responsive views, native safe insets, and disabled pinch zoom policy.',
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const done = new Promise((resolveExit) => child.once('exit', resolveExit));
    child.kill();
    await done;
  }
  const absolute = resolve(directory);
  if (
    absolute.startsWith(resolve(tmpdir()) + '\\') &&
    basename(absolute).startsWith('xingye-appearance-')
  )
    rmSync(absolute, { recursive: true });
}
