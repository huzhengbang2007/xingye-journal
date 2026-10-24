import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename, sep } from 'node:path';
import { once } from 'node:events';
import { diaryKey, encryptDiary } from '../public/diary.js';
import { unseal, seal } from '../lib/core.mjs';
import { saveRecovery, recoveryFiles } from '../lib/recovery.mjs';

function cleanup(directory) {
  const target = resolve(directory);
  assert.ok(
    target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('xingye-'),
    'cleanup must stay within the isolated test directory',
  );
  rmSync(target, { recursive: true, force: true });
}

test('HTTP sync rejects unsafe deletes, preserves omissions and diary, and cannot import old authorization', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xingye-sync-safety-'));
  const child = spawn(process.execPath, ['server.mjs'], {
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
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '',
    errors = '',
    cookie = '',
    csrf = '';
  child.stderr.on('data', (chunk) => (errors += chunk));
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`startup timeout: ${errors}`)), 15000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`startup exit ${code}: ${errors}`));
      });
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const ready = output.match(/XINGYE_DESKTOP_READY (\{[^\n]+\})/);
        if (ready) {
          clearTimeout(timeout);
          resolve(JSON.parse(ready[1]).port);
        }
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const call = (path, body) =>
      fetch(`${origin}/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Cookie: cookie,
          ...(body === undefined
            ? {}
            : { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const password = 'safety-regression-password';
    const setup = await call('setup', { password });
    assert.equal(setup.status, 200);
    cookie = setup.headers.get('set-cookie').split(';')[0];
    csrf = (await setup.json()).csrf;
    for (let index = 0; index < 3; index++)
      assert.equal(
        (
          await call('events', {
            title: `protected ${index}`,
            date: '2026-10-25',
            start: '09:00',
            end: '10:00',
          })
        ).status,
        200,
      );
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const envelope = await encryptDiary([], await diaryKey('separate-diary-password', salt), salt);
    assert.equal((await call('diary/save', { revision: null, envelope })).status, 200);
    const snapshot = await (await call('sync/snapshot')).json();
    const body = {
      vaultId: snapshot.vaultId,
      expectedRevision: snapshot.revision,
      events: [],
      transactions: [],
      diary: null,
    };
    assert.equal((await call('sync/merge', { ...body, vaultId: 'another-vault' })).status, 409);
    const unchanged = await call('sync/merge', body);
    assert.equal(unchanged.status, 200);
    const safe = await unchanged.json();
    assert.equal(safe.events.length, 3, 'empty inventory does not delete');
    assert.deepEqual(safe.diary, snapshot.diary, 'null diary is not a delete');
    assert.equal(safe.revision, snapshot.revision, 'no-op does not increment revision');
    assert.equal((await call('sync/merge', { ...body, events: null })).status, 400);
    assert.equal(
      (await call('sync/merge', { ...body, deleted: { events: 'invalid' } })).status,
      400,
    );
    assert.equal(
      (
        await call('sync/merge', {
          ...body,
          deleted: { events: ['unseen-id'] },
          confirmDeletions: true,
        })
      ).status,
      409,
    );
    const deleting = { ...body, deleted: { events: [snapshot.events[0].id] } };
    assert.equal(
      (await call('sync/merge', deleting)).status,
      428,
      'one of three rows needs confirmation',
    );
    const removed = await call('sync/merge', { ...deleting, confirmDeletions: true });
    assert.equal(removed.status, 200);
    const after = await removed.json();
    assert.equal(after.events.length, 2);
    assert.ok(after.tombstones.events.includes(snapshot.events[0].id));
    assert.equal(
      (
        await call('sync/merge', {
          ...body,
          expectedRevision: after.revision,
          events: snapshot.events,
        })
      ).status,
      409,
      'tombstone forbids resurrection',
    );
    assert.equal((await call('sync/merge', deleting)).status, 409, 'stale replay rejected');
    const refreshed = await (await call('sync/snapshot')).json();
    const diaryDelete = { ...body, expectedRevision: refreshed.revision, diaryDelete: true };
    assert.equal((await call('sync/merge', diaryDelete)).status, 428);
    assert.equal(
      (await call('sync/merge', { ...diaryDelete, confirmDeletions: true })).status,
      200,
    );
    assert.equal((await (await call('diary')).json()).envelope, null);
    const history = (await (await call('backups')).json()).files;
    assert.equal(history.length, 2);
    assert.equal((await call('backup/history?name=../../package.json')).status, 404);
    assert.equal((await call(`backup/history?name=${history[0]}`)).status, 200);
    const beforeFailure = await (await call('sync/snapshot')).json();
    mkdirSync(join(dir, 'daylight.vault.tmp'));
    try {
      assert.equal(
        (
          await call('sync/merge', {
            ...body,
            expectedRevision: beforeFailure.revision,
            events: [
              { ...beforeFailure.events[0], id: crypto.randomUUID(), title: 'must roll back' },
            ],
          })
        ).status,
        500,
        'disk write failure rejects merge',
      );
      assert.deepEqual(
        await (await call('sync/snapshot')).json(),
        beforeFailure,
        'memory and revision roll back on failed save',
      );
    } finally {
      rmdirSync(join(dir, 'daylight.vault.tmp'));
    }
    const exported = unseal(await (await call('backup')).text(), password);
    exported.data._pairedDevices = [
      { id: 'revoked-phone', name: 'stale backup', tokenHash: 'f'.repeat(64) },
    ];
    const forgedOldBackup = seal(exported.data, exported.key, exported.salt);
    exported.key.fill(0);
    assert.equal(
      (
        await call('restore', {
          content: Buffer.from(forgedOldBackup).toString('base64'),
          password,
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (await (await call('pairing/status')).json()).devices,
      [],
      'backup cannot revive old devices',
    );
    const persisted = unseal(readFileSync(join(dir, 'daylight.vault'), 'utf8'), password);
    assert.deepEqual(persisted.data._pairedDevices, []);
    persisted.key.fill(0);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    cleanup(dir);
  }
});

test('recovery keeps five distinct encrypted generations per operation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xingye-recovery-test-'));
  try {
    const vault = join(dir, 'daylight.vault');
    for (let index = 0; index < 8; index++) {
      writeFileSync(vault, `ciphertext-${index}`);
      saveRecovery(dir, vault, 'device-sync');
    }
    const files = recoveryFiles(dir);
    assert.equal(files.length, 5);
    assert.deepEqual(
      files.map((name) => readFileSync(join(dir, name), 'utf8')),
      ['ciphertext-7', 'ciphertext-6', 'ciphertext-5', 'ciphertext-4', 'ciphertext-3'],
    );
  } finally {
    cleanup(dir);
  }
});
