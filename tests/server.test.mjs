import test from 'node:test';
import a from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chinaDay, addDays } from '../lib/core.mjs';
import { diaryKey, encryptDiary } from '../public/diary.js';
import { event as makeEvent } from '../public/domain.js';

test('complete local API: auth, origin checks, persistence, dedup, plans, reports, restore', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'daylight-test-'));
  const port = await new Promise((r) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const password = 'test-vault-password-2026';
  let child,
    cookie = '',
    csrf = '';
  async function start() {
    child = spawn(
      process.execPath,
      [
        '--import',
        new URL('./mock-ai.mjs', import.meta.url).href,
        fileURLToPath(new URL('../server.mjs', import.meta.url)),
      ],
      {
        env: {
          ...process.env,
          DATA_DIR: dir,
          PORT: String(port),
          HOST: '127.0.0.1',
          TLS_PFX_PATH: '',
          TLS_CERT_PATH: '',
          TLS_KEY_PATH: '',
          AI_TEST_LOG: join(dir, 'ai-test.log'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let startupError = '';
    child.stderr.on('data', (chunk) => {
      startupError += chunk.toString();
    });
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('Server start timed out')), 8000);
      child.stdout.once('data', () => {
        clearTimeout(timer);
        res();
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        rej(e);
      });
      child.once('exit', (code) => {
        if (code) {
          clearTimeout(timer);
          rej(new Error(`Server exited ${code}: ${startupError}`));
        }
      });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await exited;
    }
  }
  async function call(path, data, extra = {}) {
    return fetch(origin + '/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Cookie: cookie,
        ...(data === undefined
          ? {}
          : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
        ...extra,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  try {
    await start();
    await t.test('all shipped browser modules are served as JavaScript', async () => {
      const directory = fileURLToPath(new URL('../public/', import.meta.url));
      for (const file of readdirSync(directory).filter((name) => name.endsWith('.js'))) {
        const response = await fetch(`${origin}/${file}`);
        a.equal(response.status, 200, file);
        a.match(response.headers.get('content-type'), /^text\/javascript/, file);
        a.equal(await response.text(), readFileSync(join(directory, file), 'utf8'), file);
      }
    });
    await t.test('reject unauthorized state and cross-origin setup', async () => {
      a.equal((await call('state')).status, 401);
      a.equal((await call('setup', { password }, { Origin: 'https://evil.test' })).status, 403);
      a.equal((await call('session')).status, 200);
      a.equal((await fetch(origin + '/server.mjs')).status, 404);
    });
    await t.test('create encrypted vault, hide key, enforce CSRF', async () => {
      const r = await call('setup', { password });
      a.equal(r.status, 200);
      cookie = r.headers.get('set-cookie').split(';')[0];
      a.ok(r.headers.get('set-cookie').includes('HttpOnly'));
      csrf = (await r.json()).csrf;
      a.equal((await call('events', {}, { 'X-CSRF-Token': 'bad' })).status, 403);
      const r2 = await call('settings', {
        name: '测试同学',
        budget: 2000,
        model: 'deepseek-flash',
        apiKey: 'sk-testing-secret-not-real',
        dayStart: '08:00',
        dayEnd: '22:00',
        semesterStart: '2026-09-07',
      });
      a.equal(r2.status, 200);
      const state = await (await call('state')).json();
      a.equal(state.settings.hasApiKey, true);
      a.equal(state.settings.apiKey, undefined);
      a.equal(readFileSync(join(dir, 'daylight.vault'), 'utf8').includes('sk-testing'), false);
      a.equal(readFileSync(join(dir, 'daylight.vault'), 'utf8').includes('测试同学'), false);
    });
    await t.test(
      'an existing session can verify its password after reload without creating another device',
      async () => {
        const before = await (await call('devices')).json();
        a.equal((await call('unlock', { password: 'wrong-password-long-enough' })).status, 401);
        const verified = await call('unlock', { password });
        a.equal(verified.status, 200);
        a.equal((await verified.json()).csrf, csrf);
        const after = await (await call('devices')).json();
        a.equal(after.devices.length, before.devices.length);
        a.deepEqual(
          after.devices.map((d) => d.id),
          before.devices.map((d) => d.id),
        );
      },
    );
    await t.test(
      'automation consent, same conversation, pause, delete and invalid schedule',
      async () => {
        const task = {
          title: '定时复盘',
          prompt: '重复的原始请求',
          interval: 5,
          nextRun: new Date(Date.now() + 60000).toISOString(),
          consent: true,
        };
        a.equal((await call('automations/create', { ...task, consent: false })).status, 400);
        a.equal((await call('automations/create', { ...task, interval: 0 })).status, 400);
        const created = await call('automations/create', task);
        a.equal(created.status, 200);
        const { id } = await created.json();
        for (let i = 0; i < 2; i++)
          a.equal((await call('automations/action', { id, action: 'run' })).status, 200);
        let saved = (await (await call('state')).json()).automations[0];
        a.equal(saved.status, 'success');
        a.equal(saved.rounds, 2);
        const history = (await (await call('automations/history?id=' + id)).json()).messages;
        a.equal(saved.lastReply, '任务回复 4');
        a.equal(history[0].content, history[2].content);
        await call('automations/action', { id, action: 'toggle' });
        saved = (await (await call('state')).json()).automations[0];
        a.equal(saved.enabled, false);
        a.equal((await call('automations/action', { id, action: 'delete' })).status, 200);
        a.equal((await (await call('state')).json()).automations.length, 0);
      },
    );
    let eventId;
    await t.test('event edit preserves completed state', async () => {
      const e = {
        title: '数学学习',
        date: addDays(chinaDay(), 1),
        start: '08:00',
        end: '10:00',
        kind: 'study',
      };
      const res = await call('events', e);
      a.equal(res.status, 200);
      eventId = (await res.json()).id;
      await call('events/update', { id: eventId, done: true });
      a.equal((await call('events/update', { ...e, id: eventId, title: '数学复习' })).status, 200);
      const s = await (await call('state')).json();
      a.equal(s.events[0].done, true);
      a.equal(s.events[0].title, '数学复习');
    });
    await t.test(
      'two devices coexist, receive change events, reject stale updates and revoke independently',
      async () => {
        const login = await call('unlock', { password, device: '小米 17P 测试' }, { Cookie: '' });
        a.equal(login.status, 200);
        const secondCookie = login.headers.get('set-cookie').split(';')[0],
          secondCsrf = (await login.json()).csrf;
        a.equal((await call('state')).status, 200);
        const old = (await (await call('state')).json()).events[0];
        const abort = new AbortController();
        const stream = await fetch(origin + '/api/stream', {
          headers: { Cookie: secondCookie },
          signal: abort.signal,
        });
        a.equal(stream.status, 200);
        const reader = stream.body.getReader();
        const first = await reader.read();
        a.ok(new TextDecoder().decode(first.value).includes('event: ready'));
        try {
          const changed = await call('events/update', {
            ...old,
            location: '协同自习室',
            expectedVersion: old.version,
            done: undefined,
          });
          a.equal(changed.status, 200);
          const pushed = await reader.read();
          a.ok(new TextDecoder().decode(pushed.value).includes('event: change'));
          a.equal(
            (
              await call(
                'events/update',
                { ...old, title: '过期编辑', expectedVersion: old.version, done: undefined },
                { Cookie: secondCookie, 'X-CSRF-Token': secondCsrf },
              )
            ).status,
            409,
          );
          const devices = (await (await call('devices')).json()).devices;
          a.equal(devices.length, 2);
          a.equal(devices.filter((d) => d.current).length, 1);
          const second = devices.find((d) => !d.current);
          a.ok(!JSON.stringify(devices).includes(secondCookie));
          await call('devices/revoke', { id: second.id });
          a.equal((await call('state', undefined, { Cookie: secondCookie })).status, 401);
          a.equal((await call('state')).status, 200);
        } finally {
          abort.abort();
          await reader.cancel().catch(() => {});
        }
      },
    );
    await t.test(
      'independent app sync requires a current revision and saves a rollback before merging',
      async () => {
        const snapshot = await (await call('sync/snapshot')).json();
        a.ok(snapshot.events.length);
        a.equal(snapshot.settings, undefined);
        const extra = makeEvent({
          title: '来自独立手机',
          date: addDays(chinaDay(), 1),
          start: '12:00',
          end: '13:00',
        });
        const body = {
          vaultId: snapshot.vaultId,
          expectedRevision: snapshot.revision,
          events: [...snapshot.events, extra],
          transactions: snapshot.transactions,
          diary: snapshot.diary,
        };
        const result = await call('sync/merge', body);
        a.equal(result.status, 200);
        const merged = await result.json();
        a.ok(merged.events.some((e) => e.id === extra.id));
        a.equal((await call('sync/merge', body)).status, 409);
        a.ok(readFileSync(join(dir, 'before-device-sync.vault')).length > 0);
      },
    );
    await t.test(
      'diary API stores only client ciphertext, hides it from general state and rejects stale writes',
      async () => {
        const salt = crypto.getRandomValues(new Uint8Array(16)),
          key = await diaryKey('separate-diary-test-password', salt);
        const envelope = await encryptDiary(
          [
            {
              id: 'secret-1',
              date: chinaDay(),
              title: '我的秘密',
              body: '这段文字不可进入统计',
              mood: '平静',
            },
          ],
          key,
          salt,
        );
        const initial = await (await call('diary')).json();
        a.equal(initial.revision, null);
        const r = await call('diary/save', { revision: null, envelope });
        a.equal(r.status, 200);
        a.ok((await r.json()).revision);
        const general = await (await call('state')).json();
        a.equal(general.diary, undefined);
        a.equal(general.diaryInitialized, true);
        a.equal(JSON.stringify(general).includes('我的秘密'), false);
        const stored = await (await call('diary')).json();
        a.deepEqual(stored.envelope, envelope);
        a.equal((await call('diary/save', { revision: null, envelope })).status, 409);
        const exported = await call('calendar.ics');
        a.equal(exported.headers.get('content-type').includes('text/calendar'), true);
        a.equal((await exported.text()).includes('我的秘密'), false);
      },
    );
    await t.test('bill import is preview-only, commits once and deduplicates', async () => {
      const file = readFileSync(new URL('../examples/微信账单示例.csv', import.meta.url)).toString(
        'base64',
      );
      let r = await call('import/preview', { type: 'wechat', filename: 'wx.csv', content: file });
      a.equal(r.status, 200);
      const p = await r.json();
      a.equal(p.items.length, 4);
      a.equal((await (await call('state')).json()).transactions.length, 0);
      a.equal((await call('import/commit', { token: p.token })).status, 200);
      a.equal((await call('import/commit', { token: p.token })).status, 400);
      const pp = await (
        await call('import/preview', { type: 'wechat', filename: 'wx.csv', content: file })
      ).json();
      a.equal(pp.duplicates, 4);
      a.equal(pp.items.length, 0);
    });
    await t.test(
      'local planner avoids the existing class; application revalidates conflicts',
      async () => {
        const r = await call('plan', { goal: '英语学习', days: 3, duration: 60, useAI: false });
        a.equal(r.status, 200);
        const p = await r.json();
        a.ok(p.items.length > 0);
        a.equal((await call('plan/apply', { items: p.items })).status, 200);
        a.equal((await call('plan/apply', { items: p.items })).status, 400);
        a.equal(
          (await call('plan', { goal: 'x', days: 3, duration: 60, useAI: true, consent: false }))
            .status,
          400,
        );
      },
    );
    await t.test(
      'mock AI: minimized payload, validated preview and no automatic write',
      async () => {
        const before = (await (await call('state')).json()).events.length;
        const r = await call('plan', {
          goal: '准备考试',
          days: 3,
          duration: 60,
          useAI: true,
          consent: true,
        });
        a.equal(r.status, 200);
        const p = await r.json();
        a.equal(p.items.length, 1);
        a.equal(p.items[0].done, false);
        a.equal((await (await call('state')).json()).events.length, before);
        const logs = readFileSync(join(dir, 'ai-test.log'), 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse);
        const log = logs.at(-1),
          input = JSON.parse(log.request.messages[1].content);
        a.equal(log.bearerPresent, true);
        a.equal(log.redirect, 'error');
        a.deepEqual(Object.keys(input.busy[0]).sort(), ['date', 'end', 'start']);
        a.equal(JSON.stringify(input).includes('数学复习'), false);
        a.equal(JSON.stringify(input).includes('sk-testing'), false);
        a.equal(
          (
            await call('plan', {
              goal: 'simulate-conflict',
              days: 3,
              duration: 60,
              useAI: true,
              consent: true,
            })
          ).status,
          400,
        );
        a.equal(
          (
            await call('plan', {
              goal: 'simulate-invalid-json',
              days: 3,
              duration: 60,
              useAI: true,
              consent: true,
            })
          ).status,
          502,
        );
        a.equal(
          (
            await call('plan', {
              goal: 'simulate-service-error',
              days: 3,
              duration: 60,
              useAI: true,
              consent: true,
            })
          ).status,
          502,
        );
      },
    );
    await t.test('mock AI report sends aggregates without merchant or event names', async () => {
      const r = await call('report', { month: '2026-10', useAI: true, consent: true });
      a.equal(r.status, 200);
      a.ok((await r.json()).ai.summary);
      const logs = readFileSync(join(dir, 'ai-test.log'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      const payload = JSON.parse(logs.at(-1).request.messages[1].content);
      a.equal(payload.netExpense, 1850);
      a.equal(JSON.stringify(payload).includes('学校食堂'), false);
      a.equal(JSON.stringify(payload).includes('数学复习'), false);
    });
    await t.test(
      'a zero daily limit blocks AI without issuing a request or changing events',
      async () => {
        const before = await (await call('state')).json();
        const logBefore = readFileSync(join(dir, 'ai-test.log'), 'utf8');
        a.equal(
          (
            await call('settings', {
              ...before.settings,
              aiDailyLimit: 0,
              expectedSettingsVersion: before.settingsVersion,
            })
          ).status,
          200,
        );
        a.equal(
          (
            await call('plan', {
              goal: '暂停期间不发送',
              days: 3,
              duration: 60,
              useAI: true,
              consent: true,
            })
          ).status,
          429,
        );
        const after = await (await call('state')).json();
        a.equal(after.settings.aiDailyLimit, 0);
        a.deepEqual(after.events, before.events);
        a.deepEqual(after.aiUsage, before.aiUsage);
        a.equal(readFileSync(join(dir, 'ai-test.log'), 'utf8'), logBefore);
        a.equal(
          (
            await call('settings', {
              ...after.settings,
              aiDailyLimit: 100,
              expectedSettingsVersion: after.settingsVersion,
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'report, encrypted backup, tamper rejection and restore rollback copy',
      async () => {
        const r = await call('report', { month: '2026-10', useAI: false });
        a.equal(r.status, 200);
        a.equal((await r.json()).netExpense, 1850);
        const backup = await (await call('backup')).text();
        a.equal(backup.includes('数学'), false);
        const tampered = JSON.parse(backup);
        tampered.body = 'AAAA';
        a.equal(
          (
            await call('restore', {
              content: Buffer.from(JSON.stringify(tampered)).toString('base64'),
              password,
            })
          ).status,
          400,
        );
        a.equal(
          (
            await call('transactions', {
              date: chinaDay(),
              amount: 1,
              direction: 'expense',
              merchant: '临时记录',
              category: '其他',
            })
          ).status,
          200,
        );
        a.equal(
          (await call('restore', { content: Buffer.from(backup).toString('base64'), password }))
            .status,
          200,
        );
        a.equal((await (await call('state')).json()).transactions.length, 4);
        a.ok(readFileSync(join(dir, 'before-restore.vault')).length > 0);
      },
    );
    await t.test(
      'lock hides state; wrong password denied; process restart unlocks persisted vault',
      async () => {
        await call('lock', {});
        a.equal((await call('state')).status, 401);
        a.equal((await call('unlock', { password: 'incorrect-long-password' })).status, 401);
        await stop();
        await start();
        a.equal((await (await call('session')).json()).initialized, true);
        const r = await call('unlock', { password });
        a.equal(r.status, 200);
        cookie = r.headers.get('set-cookie').split(';')[0];
        csrf = (await r.json()).csrf;
        const s = await (await call('state')).json();
        a.equal(s.events.find((e) => e.id === eventId).title, '数学复习');
        a.equal(s.settings.hasApiKey, true);
      },
    );
  } finally {
    await stop();
    const full = resolve(dir),
      base = resolve(tmpdir());
    if (full.startsWith(base + '\\') && basename(full).startsWith('daylight-test-'))
      rmSync(full, { recursive: true });
  }
});
