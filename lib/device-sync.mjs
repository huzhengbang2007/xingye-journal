import https from 'node:https';
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { durableWrite } from './runtime.mjs';
import { syncBaseline } from './sync-guard.mjs';

const digest = (s) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('hex');
// A parent PowerShell 7 session can otherwise inject incompatible modules into Windows PowerShell.
const windowsEnvironment = () => {
  const env = { ...process.env };
  delete env.PSModulePath;
  return env;
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const reply = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
};
const localIPv4 = (ip) =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.)/.test(
    ip || '',
  );
export function candidateAddresses() {
  return [
    ...new Set(
      Object.values(networkInterfaces())
        .flat()
        .filter((i) => i && !i.internal && i.family === 'IPv4' && localIPv4(i.address))
        .map((i) => i.address),
    ),
  ].slice(0, 8);
}

// Only this listener accepts paired-device credentials. It never exposes browser APIs.
export function createDeviceSync({
  root,
  dataDir,
  getState,
  save,
  snapshot,
  merge,
  tlsIdentity,
  port = 3211,
  discoveryPort = 3212,
}) {
  const config = resolve(dataDir, 'device-sync-enabled.json');
  let server,
    udp,
    fingerprint,
    identity,
    invitation,
    startup,
    lastError = '';
  const pending = new Map();
  const rates = new Map();
  const baselines = new Map();
  function prune() {
    for (const [key, p] of pending) if (p.expires < Date.now()) pending.delete(key);
    for (const [key, r] of rates) if (r.until < Date.now()) rates.delete(key);
  }
  function stateRequired() {
    const state = getState();
    if (!state) throw fail('电脑尚未解锁，请在电脑打开并解锁星野记', 423);
    return state;
  }
  function devices() {
    return (stateRequired()._pairedDevices ||= []);
  }
  function device(req) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    if (!token) throw fail('配对已失效，请重新扫描电脑二维码', 401);
    const found = devices().find((d) => d.tokenHash === digest(token));
    if (!found) throw fail('设备已解除配对，请重新扫描电脑二维码', 401);
    return found;
  }
  async function json(req, limit = 16 * 1024 * 1024) {
    if (!String(req.headers['content-type']).startsWith('application/json'))
      throw fail('请求格式错误', 415);
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit)
        throw fail(`请求超过 ${limit / 1024 / 1024} MiB 上限，请分批减少记录后重试`, 413);
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks));
    } catch {
      throw fail('请求格式错误');
    }
  }
  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      prune();
      // Local IPv4 only, even when Windows assigns a public-network interface.
      if (!localIPv4(req.socket.remoteAddress?.replace(/^::ffff:/, '')))
        throw fail('请连接同一网络或自己的手机热点', 403);
      if (req.headers.origin) throw fail('同步接口只允许已配对 App 访问', 403);
      const path = req.url;
      if (req.method === 'POST' && path === '/pair/request') {
        stateRequired();
        const ip = req.socket.remoteAddress;
        const rate = rates.get(ip) || { count: 0, until: Date.now() + 60000 };
        rates.set(ip, rate);
        if (++rate.count > 20 || pending.size >= 10) throw fail('配对请求过多，请稍后重试', 429);
        const b = await json(req, 4096);
        stateRequired();
        if (!invitation || invitation.expires < Date.now() || b.code !== invitation.code)
          throw fail('二维码已过期，请在电脑刷新二维码', 410);
        const requestId = secret(),
          poll = secret();
        const name = String(b.name || 'Android 设备')
          .trim()
          .slice(0, 60);
        pending.set(requestId, {
          id: requestId,
          pollHash: digest(poll),
          tokenHash: digest(digest(`xingye-paired-v1:${poll}`)),
          name,
          ip,
          verificationCode: String(parseInt(digest(poll).slice(0, 8), 16) % 1000000).padStart(
            6,
            '0',
          ),
          invitationCode: invitation.code,
          expires: Date.now() + 120000,
          approved: false,
        });
        return reply(res, 200, {
          requestId,
          poll,
          verificationCode: pending.get(requestId).verificationCode,
        });
      }
      if (req.method === 'POST' && path === '/pair/poll') {
        const key = `poll:${req.socket.remoteAddress}`;
        if (!rates.has(key) && rates.size >= 1024) throw fail('配对请求过多，请稍后重试', 429);
        const rate = rates.get(key) || { count: 0, until: Date.now() + 60000 };
        rates.set(key, rate);
        if (++rate.count > 120) throw fail('配对查询过于频繁，请稍后重试', 429);
        const b = await json(req, 4096),
          p = pending.get(b.requestId);
        if (!p || typeof b.poll !== 'string' || digest(b.poll) !== p.pollHash)
          throw fail('配对申请已过期，请重新扫码', 410);
        stateRequired();
        if (p.denied) {
          pending.delete(p.id);
          throw fail('电脑已拒绝配对', 403);
        }
        if (!p.approved) return reply(res, 200, { waiting: true });
        // Credential is deterministic from a client-held high-entropy poll secret.
        // Repeated delivery tolerates a lost response without retaining plaintext tokens.
        return reply(res, 200, {
          token: digest(`xingye-paired-v1:${b.poll}`),
          deviceId: p.deviceId,
          computerId: identity,
        });
      }
      const paired = device(req);
      if (req.method === 'GET' && path === '/sync/metadata') {
        const value = snapshot();
        return reply(res, 200, { vaultId: value.vaultId, revision: value.revision });
      }
      if (req.method === 'GET' && path === '/sync/snapshot') {
        const value = snapshot();
        if (Buffer.byteLength(JSON.stringify(value)) > 16 * 1024 * 1024)
          throw fail('同步快照超过 16 MiB 上限，请先在电脑导出备份并分批减少记录', 413);
        baselines.set(paired.id, syncBaseline(value));
        return reply(res, 200, value);
      }
      if (req.method === 'POST' && path === '/sync/merge') {
        const b = await json(req);
        device(req); // Re-check unlock and revocation after awaiting the request body.
        const result = merge(b, baselines.get(paired.id));
        baselines.set(paired.id, syncBaseline(result));
        return reply(res, 200, result);
      }
      throw fail('接口不存在', 404);
    } catch (e) {
      if (!res.headersSent) reply(res, e.status || 400, { error: e.message });
      else res.destroy();
    }
  }
  async function start() {
    if (server?.listening) return;
    if (startup) return startup;
    startup = (async () => {
      let tls = tlsIdentity;
      let windowsFingerprint;
      if (!tls) {
        if (process.platform !== 'win32') throw fail('当前自动配对服务需要 Windows 电脑');
        const directory = resolve(dataDir, 'device-identity');
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            resolve(root, 'scripts/device-identity.ps1'),
            '-Directory',
            directory,
          ],
          { encoding: 'utf8', windowsHide: true, timeout: 60000, env: windowsEnvironment() },
        );
        if (result.status !== 0) throw fail('电脑身份准备失败，请检查当前用户的数据目录权限');
        const prepared = JSON.parse(result.stdout.trim());
        const bundle = JSON.parse(
          readFileSync(resolve(directory, 'identity.json'), 'utf8').replace(/^\uFEFF/, ''),
        );
        tls = { pfx: Buffer.from(bundle.pfx, 'base64'), passphrase: prepared.passphrase };
        windowsFingerprint = prepared.fingerprint;
      }
      fingerprint = tls.cert
        ? new X509Certificate(tls.cert).fingerprint256.replaceAll(':', '').toLowerCase()
        : windowsFingerprint;
      if (!/^[a-f0-9]{64}$/.test(fingerprint || '')) throw fail('电脑身份校验失败，请检查身份文件');
      identity = fingerprint;
      server = https.createServer({ ...tls, minVersion: 'TLSv1.2' }, handle);
      server.requestTimeout = 30000;
      server.headersTimeout = 10000;
      await new Promise((ok, bad) => {
        server.once('error', bad);
        server.listen(port, '0.0.0.0', ok);
      });
      server.on('error', () => {
        lastError = '连接服务发生错误，请重新打开星野记';
      });
      durableWrite(config, JSON.stringify({ enabled: true }));
      lastError = '';
      udp = dgram.createSocket('udp4');
      udp.on('error', () => {
        /* Discovery is optional: re-scanning remains available. */
      });
      udp.on('message', (bytes, peer) => {
        if (bytes.length > 256 || !localIPv4(peer.address)) return;
        let request;
        try {
          request = JSON.parse(bytes);
        } catch {
          return;
        }
        if (request.type !== 'xingye-discover-v1' || request.computerId !== identity) return;
        prune();
        const rateKey = `udp:${peer.address}`;
        if (!rates.has(rateKey) && rates.size >= 1024) return;
        const rate = rates.get(rateKey) || { count: 0, until: Date.now() + 10000 };
        rates.set(rateKey, rate);
        if (++rate.count > 10) return;
        const response = Buffer.from(
          JSON.stringify({
            computerId: identity,
            port: server.address()?.port,
            nonce: String(request.nonce).slice(0, 64),
          }),
        );
        udp.send(response, peer.port, peer.address, () => {});
      });
      udp.bind(discoveryPort, '0.0.0.0');
    })()
      .catch((e) => {
        lastError = e.message;
        server?.close();
        server = null;
        throw e;
      })
      .finally(() => {
        startup = null;
      });
    return startup;
  }
  return {
    start,
    async restore() {
      if (existsSync(config))
        try {
          if (JSON.parse(readFileSync(config)).enabled) await start();
        } catch (e) {
          lastError = e.message;
        }
    },
    async invite() {
      stateRequired();
      await start();
      const addresses = candidateAddresses().map((ip) => `https://${ip}:${server.address().port}`);
      if (!addresses.length) throw fail('尚未连接可互通的网络，请让电脑连接自己的手机热点');
      invitation = { code: secret(), expires: Date.now() + 120000 };
      return {
        version: 1,
        type: 'xingye-pair',
        computerId: identity,
        fingerprint,
        addresses,
        discoveryPort,
        ...invitation,
      };
    },
    status() {
      prune();
      return {
        enabled: Boolean(server?.listening),
        error: lastError,
        devices: devices().map(({ tokenHash, ...d }) => d),
        pending: [...pending.values()]
          .filter((p) => !p.approved && !p.denied)
          .map(({ id, name, ip, verificationCode }) => ({ id, name, ip, verificationCode })),
      };
    },
    approve(b) {
      prune();
      const p = pending.get(b.id);
      if (!p || p.approved || p.denied) throw fail('配对申请已过期');
      if (!invitation || p.invitationCode !== invitation.code || invitation.expires < Date.now())
        throw fail('二维码已过期，请刷新后重新扫码', 410);
      if (b.allow !== true) {
        p.denied = true;
        return { ok: true };
      }
      const list = devices();
      if (list.length >= 10) throw fail('最多配对 10 台设备，请先解除不用的设备');
      // The browser approves the request, but never receives the device credential.
      const entry = {
        id: secret().slice(0, 24),
        name: p.name,
        tokenHash: p.tokenHash,
        pairedAt: new Date().toISOString(),
      };
      list.push(entry);
      try {
        save();
      } catch (e) {
        list.pop();
        throw e;
      }
      p.deviceId = entry.id;
      p.approved = true;
      invitation = null;
      for (const other of pending.values()) if (other !== p && !other.approved) other.denied = true;
      return { ok: true };
    },
    revoke(id) {
      const state = stateRequired(),
        before = state._pairedDevices;
      state._pairedDevices = devices().filter((d) => d.id !== id);
      try {
        save();
      } catch (e) {
        state._pairedDevices = before;
        throw e;
      }
      baselines.delete(id);
      for (const p of pending.values()) if (p.deviceId === id) pending.delete(p.id);
      return { ok: true };
    },
    rename(id, name) {
      const entry = devices().find((d) => d.id === id);
      if (!entry) throw fail('设备不存在');
      const old = entry.name;
      entry.name = String(name).trim().slice(0, 60);
      if (!entry.name) {
        entry.name = old;
        throw fail('请输入设备名称');
      }
      try {
        save();
      } catch (e) {
        entry.name = old;
        throw e;
      }
      return { ok: true };
    },
    close() {
      invitation = null;
      pending.clear();
      baselines.clear();
      try {
        udp?.close();
      } catch {}
      udp = null;
      server?.close();
      server?.closeAllConnections();
    },
  };
}
