import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import dgram from 'node:dgram';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename, sep } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
import { createDeviceSync } from '../lib/device-sync.mjs';

test('paired TLS: QR consumed on approval, candidate verification, authenticated scope, revocation, lock, persistence and discovery', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'xingye-pairing-test-'));
  const tls = {
    key: readFileSync(new URL('./fixtures/device-test-only.key', import.meta.url)),
    cert: readFileSync(new URL('./fixtures/device-test-only.crt', import.meta.url)),
  };
  const fingerprint = new X509Certificate(tls.cert).fingerprint256
    .replaceAll(':', '')
    .toLowerCase();
  let state = { _pairedDevices: [] },
    writes = 0,
    rejectSave = false;
  const discovery = dgram.createSocket('udp4');
  await new Promise((ok) => discovery.bind(0, '127.0.0.1', ok));
  const discoveryPort = discovery.address().port;
  discovery.close();
  const options = {
    root: resolve('.'),
    dataDir: dir,
    port: 0,
    discoveryPort,
    tlsIdentity: tls,
    getState: () => state,
    save: () => {
      if (rejectSave) throw new Error('disk full');
      writes++;
    },
    snapshot: () => ({ events: [], transactions: [], vaultId: 'test-vault', revision: writes }),
    merge: (b) => ({ events: [], transactions: [], vaultId: 'test-vault', ...b, committed: true }),
  };
  let manager = createDeviceSync(options);
  const originalNow = Date.now;
  try {
    const invitation = await manager.invite();
    assert.equal(invitation.fingerprint, fingerprint);
    const port = new URL(invitation.addresses[0]).port;
    const request = (path, body, token, extra = {}) =>
      new Promise((ok, bad) => {
        const req = https.request(
          {
            host: '127.0.0.1',
            port,
            path,
            method: body === undefined ? 'GET' : 'POST',
            ca: tls.cert,
            checkServerIdentity: (_, cert) =>
              createHash('sha256').update(cert.raw).digest('hex') === fingerprint
                ? undefined
                : new Error('identity mismatch'),
            headers: {
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...extra,
            },
          },
          (res) => {
            let bytes = '';
            res.on('data', (b) => (bytes += b));
            res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(bytes) }));
          },
        );
        req.on('error', bad);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    assert.equal((await request('/sync/snapshot')).status, 401);
    assert.equal((await request('/pair/request', { code: 'wrong' })).status, 410);
    const pending = (await request('/pair/request', { code: invitation.code, name: '<phone>' }))
      .body;
    assert.equal(
      (await request('/pair/request', { code: invitation.code })).status,
      200,
      'another candidate may apply until the computer approves one',
    );
    assert.equal((await request('/pair/poll', { ...pending, poll: 'wrong' })).status, 410);
    assert.equal((await request('/pair/poll', pending)).body.waiting, true);
    assert.equal(manager.status().pending[0].name, '<phone>');
    assert.equal(manager.status().pending[0].verificationCode, pending.verificationCode);
    assert.ok(manager.status().pending[0].ip.includes('127.0.0.1'));
    assert.equal('pollHash' in manager.status().pending[0], false);
    rejectSave = true;
    assert.throws(() => manager.approve({ id: pending.requestId, allow: true }), /disk full/);
    assert.equal(manager.status().devices.length, 0, 'failed authorization is rolled back');
    rejectSave = false;
    manager.approve({ id: pending.requestId, allow: true });
    assert.equal((await request('/pair/request', { code: invitation.code })).status, 410);
    const grant = (await request('/pair/poll', pending)).body;
    assert.match(grant.token, /^[a-f0-9]{64}$/);
    assert.equal(
      (await request('/pair/poll', pending)).body.token,
      grant.token,
      'lost poll response is retryable',
    );
    assert.equal((await request('/sync/snapshot', undefined, grant.token)).status, 200);
    assert.equal(
      (await request('/api/state', undefined, grant.token)).status,
      404,
      'no browser or settings API on LAN listener',
    );
    assert.equal((await request('/sync/merge', { events: [] }, grant.token)).body.committed, true);
    assert.equal(
      (await request('/sync/merge', {}, grant.token, { Origin: 'https://untrusted.test' })).status,
      403,
    );
    manager.rename(grant.deviceId, 'My phone');
    assert.equal(manager.status().devices[0].name, 'My phone');
    assert.equal('tokenHash' in manager.status().devices[0], false);
    assert.ok(
      !JSON.stringify(state).includes(grant.token),
      'server persists only a credential hash',
    );
    const unlocked = state;
    state = null;
    assert.equal((await request('/sync/snapshot', undefined, grant.token)).status, 423);
    state = unlocked;
    assert.equal(
      (await request('/sync/snapshot', undefined, grant.token)).status,
      200,
      'unlock keeps pairing',
    );
    const udp = dgram.createSocket('udp4');
    const response = new Promise((ok, bad) => {
      const timeout = setTimeout(() => bad(new Error('Discovery timed out')), 3000);
      udp.once('message', (bytes) => {
        clearTimeout(timeout);
        ok(JSON.parse(bytes));
      });
    });
    const query = Buffer.from(
      JSON.stringify({
        type: 'xingye-discover-v1',
        computerId: invitation.computerId,
        nonce: 'test-nonce',
      }),
    );
    udp.send(query, discoveryPort, '127.0.0.1');
    const found = await response;
    udp.close();
    assert.equal(found.nonce, 'test-nonce');
    assert.equal(found.port, Number(port));
    manager.revoke(grant.deviceId);
    assert.equal((await request('/sync/snapshot', undefined, grant.token)).status, 401);
    const another = await manager.invite();
    Date.now = () => originalNow() + 121000;
    assert.equal((await request('/pair/request', { code: another.code })).status, 410);
    Date.now = originalNow;
    manager.close();
    await new Promise((ok) => setTimeout(ok, 50));
    manager = createDeviceSync(options);
    await manager.restore();
    assert.equal(manager.status().enabled, true, 'enabled listener is restored after restart');
    assert.equal(
      (await manager.invite()).computerId,
      invitation.computerId,
      'identity survives restart',
    );
    assert.ok(writes >= 3);
  } finally {
    Date.now = originalNow;
    manager.close();
    const cleanupPath = resolve(dir);
    assert.ok(
      cleanupPath.startsWith(resolve(tmpdir()) + sep) &&
        basename(cleanupPath).startsWith('xingye-pairing-test-'),
      'Refuse cleanup outside the isolated test directory',
    );
    rmSync(cleanupPath, { recursive: true, force: true });
  }
});
