import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { verifyRelease } from '../lib/release-integrity.mjs';
import { mergeSnapshots, captureChoices, reusableChoices, deletionPlan } from '../public/sync.js';
import { syncBaseline, guardSync } from '../lib/sync-guard.mjs';
import { event } from '../public/domain.js';

test('signed release rejects file tampering and a rewritten hash manifest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xingye-release-check-'));
  try {
    assert.equal(verifyRelease(directory), null);
    assert.throws(() => verifyRelease(directory, { required: true }), /发布清单/);
    mkdirSync(join(directory, 'scripts/packaging'), { recursive: true });
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    writeFileSync(
      join(directory, 'scripts/packaging/publisher.json'),
      JSON.stringify({
        modulus: Buffer.from(jwk.n, 'base64url').toString('base64'),
        exponent: Buffer.from(jwk.e, 'base64url').toString('base64'),
      }),
    );
    const body = 'release source';
    writeFileSync(join(directory, 'app.js'), body);
    const manifest = JSON.stringify({
      publisher: 'HOSHINO TEAM',
      version: '3.0.0-rc',
      hashes: { 'app.js': createHash('sha256').update(body).digest('hex') },
    });
    writeFileSync(join(directory, 'BUILD-INFO.json'), manifest);
    writeFileSync(
      join(directory, 'BUILD-INFO.json.sig'),
      sign('sha256', Buffer.from(manifest), privateKey).toString('base64'),
    );
    assert.equal(verifyRelease(directory).version, '3.0.0-rc');
    writeFileSync(join(directory, 'app.js'), 'modified');
    assert.throws(() => verifyRelease(directory), /文件校验/);
    const edited = JSON.parse(manifest);
    edited.hashes['app.js'] = createHash('sha256').update('modified').digest('hex');
    writeFileSync(join(directory, 'BUILD-INFO.json'), JSON.stringify(edited));
    assert.throws(() => verifyRelease(directory), /签名无效/);
  } finally {
    const target = resolve(directory);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) &&
        basename(target).startsWith('xingye-release-check-'),
    );
    rmSync(target, { recursive: true, force: true });
  }
});

test('explicit restore after deletion requires a real tombstone baseline and confirmation', () => {
  const row = event({ title: 'edited offline', date: '2026-10-25', start: '09:00', end: '10:00' });
  const remote = {
    vaultId: 'test-vault',
    revision: 3,
    events: [],
    transactions: [],
    tombstones: { events: [row.id], transactions: [] },
  };
  const local = { events: [row], transactions: [] };
  const conflict = mergeSnapshots(local, remote);
  assert.equal(conflict.conflicts.length, 1);
  const selected = mergeSnapshots(local, remote, {}, { ['events/' + row.id]: 'local' });
  const plan = deletionPlan(remote, selected);
  assert.equal(plan.restoreCount, 1);
  assert.equal(plan.needsConfirmation, true);
  const state = { ...remote, _revision: 3 };
  const request = { vaultId: 'test-vault', expectedRevision: 3, restored: plan.restored };
  assert.throws(
    () => guardSync(state, request, syncBaseline(remote), selected),
    (e) => e.status === 428,
  );
  assert.throws(
    () => guardSync(state, { ...request, confirmDeletions: true }, undefined, selected),
    (e) => e.status === 409,
  );
  assert.equal(
    guardSync(state, { ...request, confirmDeletions: true }, syncBaseline(remote), selected)
      .events[0].id,
    row.id,
  );
});

test('retry retains conflict choices only when both versions are unchanged', () => {
  const left = event({ title: 'left', date: '2026-10-25', start: '09:00', end: '10:00' }),
    right = { ...left, title: 'right' };
  const conflict = { key: 'events/' + left.id, type: 'events', local: left, remote: right };
  const previous = captureChoices([conflict], { [conflict.key]: 'local' });
  assert.deepEqual(reusableChoices([conflict], previous), { [conflict.key]: 'local' });
  assert.deepEqual(
    reusableChoices([{ ...conflict, remote: { ...right, title: 'newer' } }], previous),
    {},
  );
});

test('release metadata agrees across Node, Android, Rust and visible UI', () => {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(metadata.version, '3.0.0-rc');
  assert.equal(metadata.androidVersionCode, 10);
  assert.equal(metadata.author, 'HOSHINO TEAM');
  const tauri = JSON.parse(
    readFileSync(new URL('../native/desktop/tauri.conf.json', import.meta.url), 'utf8'),
  );
  assert.equal(tauri.version, metadata.version);
  for (const name of ['desktop', 'vault'])
    assert.match(
      readFileSync(new URL(`../native/${name}/Cargo.toml`, import.meta.url), 'utf8'),
      /version = "3\.0\.0-rc"/,
    );
  assert.match(
    readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'),
    /3\.0\.0-rc · HOSHINO TEAM/,
  );
});
