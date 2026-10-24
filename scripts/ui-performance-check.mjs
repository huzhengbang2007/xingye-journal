// Stress check, not a claim about real-device GPU FPS. Uses synthetic encrypted data only.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join, basename } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { initialState, event, transaction, derive, seal, chinaDay, addDays } from '../lib/core.mjs';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
    : 'playwright-core'
);
const root = fileURLToPath(new URL('../', import.meta.url)),
  dir = mkdtempSync(join(tmpdir(), 'xingye-perf-')),
  password = 'synthetic-performance-password',
  salt = randomBytes(16).toString('base64'),
  state = initialState();
for (let n = 0; n < 10000; n++)
  state.events.push(
    event({
      title: `压力样例 ${n}`,
      date: addDays(chinaDay().slice(0, 7) + '-01', n % 365),
      start: '09:00',
      end: '10:00',
      kind: n % 2 ? 'course' : 'study',
    }),
  );
for (let n = 0; n < 5000; n++)
  state.transactions.push(
    transaction({
      date: addDays(chinaDay().slice(0, 7) + '-01', n % 31),
      amount: 12.5,
      direction: 'expense',
      merchant: '测试食堂',
      category: '餐饮',
    }),
  );
writeFileSync(join(dir, 'daylight.vault'), seal(state, derive(password, salt), salt));
const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    PORT: '3216',
    HOST: '127.0.0.1',
    TLS_PFX_PATH: '',
    TLS_CERT_PATH: '',
    TLS_KEY_PATH: '',
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
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
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  await page.goto('http://127.0.0.1:3216');
  await page.locator('#password').fill(password);
  await page.locator('#auth-submit').click();
  await page.locator('.hero').waitFor();
  const result = await page.evaluate(async () => {
    const samples = [];
    for (let n = 0; n < 20; n++) {
      const before = performance.now();
      document.querySelector(`[data-nav="${n % 2 ? 'dashboard' : 'calendar'}"]`).click();
      document.querySelector('#content').getBoundingClientRect();
      samples.push(performance.now() - before);
      await new Promise(requestAnimationFrame);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      fixture: { events: 10000, transactions: 5000 },
      renderSamplesMs: samples,
      medianRenderMs: sorted[10],
      p95RenderMs: sorted[18],
      liveBlurSurfaces: [...document.querySelectorAll('#content .card,#content .stat')].filter(
        (e) => getComputedStyle(e).backdropFilter !== 'none',
      ).length,
      mode: document.documentElement.dataset.visual,
    };
  });
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(join(root, 'artifacts/ui-performance.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      events: 10000,
      transactions: 5000,
      medianRenderMs: result.medianRenderMs,
      p95RenderMs: result.p95RenderMs,
      liveBlurSurfaces: result.liveBlurSurfaces,
      mode: result.mode,
    }),
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
  const full = resolve(dir);
  if (full.startsWith(resolve(tmpdir()) + '\\') && basename(full).startsWith('xingye-perf-'))
    rmSync(full, { recursive: true });
}
