// Optional focused browser check, using a fresh temporary vault and synthetic courses.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import net from 'node:net';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
    : 'playwright-core'
);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'xingye-import-check-'));
const port = await new Promise((resolve) => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1', () => {
    const port = socket.address().port;
    socket.close(() => resolve(port));
  });
});
const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  env: {
    ...process.env,
    DATA_DIR: directory,
    PORT: String(port),
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
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Temporary test server failed to start')),
      10000,
    );
    child.stdout.once('data', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Temporary test server exited ${code}`));
    });
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.locator('#password').fill('synthetic-import-password-2026');
  await page.locator('#confirm-password').fill('synthetic-import-password-2026');
  await page.locator('#auth-submit').click();
  await page.locator('.hero').waitFor();
  await page.locator('[data-import=courses]').first().click();
  await page.locator('#import-semester').fill('2026-09-07');
  await page
    .locator('#import-paste')
    .fill('课程\t星期\t时间\t周次\t教室\n合成示例课程\t周一\t08:00-09:35\t1-2\t示例教室');
  await page.locator('#preview-paste').click();
  await page.locator('#commit-import').waitFor();
  assert.match(await page.locator('#commit-import').textContent(), /2 条/);
  assert.equal(
    await page.evaluate(async () => (await (await fetch('/api/state')).json()).events.length),
    0,
    'preview must not save courses',
  );
  await page
    .locator('#import-paste')
    .fill('课程\t星期\t时间\t周次\t教室\n合成示例课程\t周一\t08:00-09:35\t1\t示例教室');
  assert.equal(
    await page.locator('#commit-import').count(),
    0,
    'editing source invalidates the old preview',
  );
  await page.locator('#preview-paste').click();
  await page.locator('#commit-import').waitFor();
  assert.match(await page.locator('#commit-import').textContent(), /1 条/);
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: join(root, 'artifacts/import-desktop.png'), fullPage: true });
  await page.locator('#commit-import').click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(async () => (await (await fetch('/api/state')).json()).events.length),
    1,
  );
  await page.locator('[data-import=courses]').first().click();
  await page.locator('#import-semester').fill('2026-09-07');
  await page
    .locator('#import-paste')
    .fill('课程\t星期\t时间\t周次\t教室\n合成示例课程\t周一\t08:00-09:35\t1\t示例教室');
  await page.locator('#preview-paste').click();
  await page.locator('#commit-import').waitFor();
  assert.equal(await page.locator('#commit-import').isDisabled(), true);
  assert.match(await page.locator('.preview-metrics').textContent(), /1 条重复/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('#import-paste')
    .fill('节次\t周一\t周二\n1-2\t"合成矩阵课程\n1-2周\n教室：示例A101"\t');
  await page.locator('#preview-paste').click();
  await page.getByText(/缺少第 1 节的实际时间/).waitFor();
  await page.locator('summary').filter({ hasText: '按节次导入' }).click();
  await page.locator('#import-sections').fill('1=08:00-08:45\n2=08:55-09:40');
  await page.locator('#preview-paste').click();
  await page.locator('#commit-import').waitFor();
  assert.match(await page.locator('#commit-import').textContent(), /2 条/);
  assert.match(await page.locator('#import-preview').textContent(), /08:00—09:40/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(root, 'artifacts/import-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Course import browser check passed: paste, preview, invalidation, commit, dedup, matrix times and mobile layout.',
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  const childPath = relative(resolve(tmpdir()), resolve(directory));
  assert(
    childPath &&
      !isAbsolute(childPath) &&
      !childPath.startsWith('..') &&
      childPath.startsWith('xingye-import-check-'),
  );
  rmSync(directory, { recursive: true, force: true });
}
