// Capture the current web UI with isolated demonstration data, never a user vault.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const data = mkdtempSync(join(tmpdir(), 'xingye-store-demo-'));
const output = join(root, 'fastlane/metadata/android/en-US/images/phoneScreenshots');
mkdirSync(output, { recursive: true });
const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  env: {
    ...process.env,
    DATA_DIR: data,
    PORT: '3217',
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
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'error').then(([e]) => {
      throw e;
    }),
  ]);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3217');
  await page.locator('#auth-submit:not(:disabled)').waitFor();
  await page.locator('#password').fill('public-demo-only-2026');
  await page.locator('#confirm-password').fill('public-demo-only-2026');
  await page.locator('#auth-submit').click();
  await page.locator('.hero').waitFor();
  await page.locator('#quick-add').click();
  await page.locator('#event-form [name=title]').fill('示例：整理本周学习计划');
  await page.locator('#event-form [name=location]').fill('图书馆');
  await page.locator('#event-form button[type=submit]').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 432, height: 864 });
  let index = 0;
  for (const view of ['dashboard', 'calendar', 'ledger', 'diary']) {
    await page.locator(`[data-nav="${view}"]:visible`).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(output, `${++index}.png`), fullPage: false });
  }
  console.log(
    'Captured four current web UI previews with demonstration data (not Android device captures).',
  );
} finally {
  await browser?.close();
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  if (!resolve(data).startsWith(resolve(tmpdir()) + '\\') || !data.includes('xingye-store-demo-'))
    throw new Error('Unexpected cleanup path');
  rmSync(data, { recursive: true, force: true });
}
