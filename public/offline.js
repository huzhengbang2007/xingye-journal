import { dailyLimit } from './ai-policy.js';
import {
  initialState,
  event,
  transaction,
  monthly,
  autoReports,
  localPlan,
  validatePlan,
  id,
  text,
  date,
  time,
  hash,
  chinaDay,
  overlaps,
  addDays,
  minutes,
} from './domain.js';
import { readRows, billImport, courseImport, icsImport, courseFingerprint } from './imports.js';
import {
  syncBase,
  mergeSnapshots,
  cleanTombstones,
  rememberDeletion,
  deletionPlan,
  captureChoices,
  reusableChoices,
} from './sync.js';
const encode = new TextEncoder(),
  decode = new TextDecoder();
const to64 = (b) => {
  let s = '';
  for (const v of b) s += String.fromCharCode(v);
  return btoa(s);
};
const from64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function portableKey(password, salt) {
  text(password, 256);
  if (password.length < 10) throw new Error('密码至少需要 10 个字符');
  const raw = await crypto.subtle.importKey('raw', encode.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function portableSeal(state, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encode.encode(JSON.stringify(state));
  try {
    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return {
      version: 2,
      kdf: 'PBKDF2-SHA256',
      iterations: 310000,
      salt: to64(salt),
      iv: to64(iv),
      body: to64(new Uint8Array(body)),
    };
  } finally {
    bytes.fill(0);
  }
}
export async function portableOpen(envelope, password) {
  if (envelope.version !== 2 || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== 310000)
    throw new Error('手机端支持自己的 v2 加密备份；电脑旧版备份请在电脑恢复后同步');
  const salt = from64(envelope.salt);
  if (salt.length !== 16 || from64(envelope.iv).length !== 12) throw new Error('备份加密参数无效');
  const key = await portableKey(password, salt);
  const bytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: from64(envelope.iv) },
    key,
    from64(envelope.body),
  );
  try {
    return { state: JSON.parse(decode.decode(bytes)), key, salt };
  } finally {
    new Uint8Array(bytes).fill(0);
  }
}
let rpcCounter = 0;
const rpcSession = crypto.randomUUID();
const pending = new Map();
if (typeof window !== 'undefined')
  window.addEventListener('xingye-native', (e) => {
    const r = e.detail;
    if (!r?.requestId || !pending.has(r.requestId)) return;
    const p = pending.get(r.requestId);
    clearTimeout(p.timer);
    pending.delete(r.requestId);
    r.ok
      ? p.resolve(r.data)
      : p.reject(Object.assign(new Error(r.error || '设备操作失败'), { status: r.status }));
  });
export function nativeRequest(type, fields = {}) {
  return new Promise((resolve, reject) => {
    if (!window.XingyeHost?.postMessage) return reject(new Error('原生服务尚未就绪，请稍后重试'));
    const requestId = `${rpcSession}:${++rpcCounter}`;
    const timer = setTimeout(
      () => {
        pending.delete(requestId);
        reject(new Error('设备连接超时，请检查电脑服务与网络'));
      },
      type === 'pairing.scan' ? 180000 : 65000,
    );
    pending.set(requestId, { resolve, reject, timer });
    window.XingyeHost.postMessage(JSON.stringify({ type, requestId, ...fields }));
  });
}
export function cleanOfflineState(source) {
  if (
    !source ||
    !Array.isArray(source.events) ||
    source.events.length > 50000 ||
    !Array.isArray(source.transactions) ||
    source.transactions.length > 100000 ||
    !source.settings
  )
    throw new Error('保险库数据格式无效');
  const base = initialState();
  const settings = {
    ...base.settings,
    ...source.settings,
    name: text(source.settings.name, 30),
    model: text(source.settings.model, 80),
    dayStart: time(source.settings.dayStart),
    dayEnd: time(source.settings.dayEnd),
  };
  if (
    !/^[A-Za-z0-9._-]+$/.test(settings.model) ||
    typeof settings.apiKey !== 'string' ||
    settings.apiKey.length > 256 ||
    !Number.isFinite(settings.budget) ||
    settings.budget < 0 ||
    settings.budget > 1000000 ||
    settings.dayStart >= settings.dayEnd
  )
    throw new Error('保险库设置无效');
  if (settings.semesterStart) date(settings.semesterStart);
  return {
    ...source,
    settings,
    reports: source.reports || {},
    events: source.events.map((e) => ({
      ...event(e),
      id: text(e.id, 80),
      version: Number.isSafeInteger(e.version) ? e.version : 0,
    })),
    transactions: source.transactions.map((t) => {
      if (!['manual', 'wechat', 'alipay'].includes(t.source)) throw new Error('账单来源无效');
      return {
        ...transaction({ ...t, amount: t.amount / 100 }),
        id: text(t.id, 80),
        source: t.source,
        fingerprint: text(t.fingerprint, 128),
        version: Number.isSafeInteger(t.version) ? t.version : 0,
      };
    }),
  };
}
export function createOfflineRuntime() {
  let data = null,
    key = null,
    salt = null,
    lastUse = 0,
    preview = null,
    queue = Promise.resolve(),
    syncSession = null,
    retryChoices = null,
    failures = 0,
    retryAt = 0;
  const db = new Promise((resolve, reject) => {
    const request = indexedDB.open('xingye-private-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开手机本地存储'));
  });
  async function stored(name = 'current', value) {
    const database = await db;
    return new Promise((resolve, reject) => {
      const tx = database.transaction('vault', value === undefined ? 'readonly' : 'readwrite');
      const request =
        value === undefined
          ? tx.objectStore('vault').get(name)
          : tx.objectStore('vault').put(value, name);
      let result;
      request.onsuccess = () => (result = request.result);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(new Error('手机存储事务已中止'));
      tx.onerror = () => reject(new Error('手机存储写入失败，请保留加密备份'));
    });
  }
  async function saveLocalRecovery(reason) {
    const previous = await stored();
    const history = (await stored('recovery-history')) || [];
    history.unshift({ name: `${reason}-${Date.now()}.vault`, envelope: previous });
    await stored('recovery-history', history.slice(0, 5));
    await stored(reason, previous);
  }
  function lock() {
    retryChoices = null;
    nativeRequest('sync.disconnect').catch(() => {});
    data = null;
    key = null;
    salt = null;
    preview = null;
    syncSession = null;
  }
  function requireOpen() {
    if (!data || Date.now() - lastUse > 1800000) {
      lock();
      throw Object.assign(new Error('本机保险库已锁定'), { status: 401 });
    }
    lastUse = Date.now();
  }
  function publicData() {
    const { apiKey, ...settings } = data.settings;
    const { diary, _sync, ...safe } = data;
    return structuredClone({
      ...safe,
      diaryInitialized: Boolean(diary),
      settings: { ...settings, hasApiKey: Boolean(apiKey) },
    });
  }
  async function persist() {
    data._revision = (data._revision || 0) + 1;
    await stored('current', await portableSeal(data, key, salt));
  }
  async function ai(system, payload) {
    if (!data.settings.apiKey) throw new Error('请先在本机设置中填写 DeepSeek 密钥');
    const limit = dailyLimit(data.settings.aiDailyLimit);
    const usage = data.aiUsage?.day === chinaDay() ? data.aiUsage : { day: chinaDay(), calls: 0 };
    if (usage.calls >= limit) throw new Error(`已达到每日 ${limit} 次 AI 调用上限`);
    data.aiUsage = { ...usage, calls: usage.calls + 1 };
    await persist();
    const result = await nativeRequest('ai.complete', {
      apiKey: data.settings.apiKey,
      model: data.settings.model,
      system,
      payload,
    });
    try {
      return JSON.parse(result.choices[0].message.content);
    } catch {
      throw new Error('AI 返回格式无效，请重试');
    }
  }
  function checkVersion(row, b) {
    if (b.expectedVersion !== undefined && b.expectedVersion !== (row.version || 0))
      throw Object.assign(new Error('记录已有变化，请重新打开后编辑'), { status: 409 });
  }
  async function request(path, b) {
    path = path.split('?')[0];
    if (path === 'artwork') {
      const names = ['hero', 'mascot', 'cover'];
      const found = await Promise.all(
        names.map(async (name) => {
          try {
            return (await fetch('/assets/' + name + '.png', { method: 'HEAD' })).ok;
          } catch {
            return false;
          }
        }),
      );
      return Object.fromEntries(names.map((name, i) => [name, found[i]]));
    }
    if (path === 'session') {
      if (data && Date.now() - lastUse > 1800000) lock();
      return {
        initialized: Boolean(await stored()),
        unlocked: Boolean(data),
        csrf: 'local-only',
        secure: true,
        localOnly: true,
        offline: true,
      };
    }
    if (path === 'setup') {
      if (await stored()) throw new Error('本机保险库已存在');
      salt = crypto.getRandomValues(new Uint8Array(16));
      key = await portableKey(b.password, salt);
      data = initialState();
      autoReports(data);
      lastUse = Date.now();
      await persist();
      return { csrf: 'local-only' };
    }
    if (path === 'unlock') {
      if (Date.now() < retryAt)
        throw Object.assign(new Error('尝试过于频繁，请一分钟后重试'), { status: 429 });
      try {
        const opened = await portableOpen(await stored(), b.password);
        data = cleanOfflineState(opened.state);
        failures = 0;
        key = opened.key;
        salt = opened.salt;
        lastUse = Date.now();
        if (autoReports(data)) await persist();
        return { csrf: 'local-only' };
      } catch {
        if (++failures >= 5) {
          retryAt = Date.now() + 60000;
          failures = 0;
        }
        throw Object.assign(new Error('本机密码不正确或保险库损坏'), { status: 401 });
      }
    }
    requireOpen();
    if (path === 'state') {
      if (autoReports(data)) await persist();
      return publicData();
    }
    if (path === 'sync') return { revision: data._revision || 0 };
    if (path === 'lock' || path === 'lock-all') {
      lock();
      return { ok: true };
    }
    if (path === 'devices')
      return {
        devices: [
          {
            id: 'local',
            device: '此设备 · 独立离线 App',
            connectedAt: new Date(lastUse).toISOString(),
            lastActive: new Date(lastUse).toISOString(),
            current: true,
          },
        ],
      };
    if (path === 'devices/name') return { ok: true };
    if (path === 'diary') return structuredClone(data.diary || { revision: null, envelope: null });
    const before = structuredClone(data);
    let result = { ok: true };
    try {
      if (path === 'events') {
        const e = { ...event(b), version: 1 };
        data.events.push(e);
        result = e;
      } else if (path === 'events/update') {
        const e = data.events.find((x) => x.id === b.id);
        if (!e) throw new Error('日程已不存在');
        checkVersion(e, b);
        const version = (e.version || 0) + 1;
        if (b.delete) {
          rememberDeletion(data, 'events', b.id);
          data.events = data.events.filter((x) => x !== e);
        } else if (typeof b.done === 'boolean') e.done = b.done;
        else Object.assign(e, { ...event(b), id: e.id, done: e.done });
        e.version = version;
      } else if (path === 'transactions') {
        const t = transaction(b);
        data.transactions.push(t);
        result = t;
      } else if (path === 'transactions/update' || path === 'transactions/delete') {
        const t = data.transactions.find((x) => x.id === b.id);
        if (!t) throw new Error('账单已不存在');
        checkVersion(t, b);
        if (path.endsWith('delete')) {
          rememberDeletion(data, 'transactions', b.id);
          data.transactions = data.transactions.filter((x) => x !== t);
        } else
          Object.assign(t, {
            ...transaction(b),
            id: t.id,
            fingerprint: t.fingerprint,
            source: t.source,
            version: (t.version || 0) + 1,
          });
      } else if (path === 'settings') {
        if (
          b.expectedSettingsVersion !== undefined &&
          b.expectedSettingsVersion !== (data.settingsVersion || 0)
        )
          throw Object.assign(new Error('设置已变化，请重新打开后编辑'), { status: 409 });
        const next = {
          ...data.settings,
          name: text(b.name, 30),
          budget: Number(b.budget),
          aiDailyLimit: dailyLimit(b.aiDailyLimit ?? data.settings.aiDailyLimit),
          model: text(b.model, 80),
          dayStart: time(b.dayStart),
          dayEnd: time(b.dayEnd),
          semesterStart: b.semesterStart ? date(b.semesterStart) : '',
        };
        if (
          !/^[\w.-]+$/.test(next.model) ||
          !Number.isFinite(next.budget) ||
          next.budget < 0 ||
          next.budget > 1000000 ||
          next.dayStart >= next.dayEnd
        )
          throw new Error('设置格式无效');
        if (b.apiKey) next.apiKey = text(b.apiKey, 256);
        if (b.clearApiKey) next.apiKey = '';
        data.settings = next;
        data.settingsVersion = (data.settingsVersion || 0) + 1;
      } else if (path === 'diary/save') {
        if ((data.diary?.revision || null) !== b.revision)
          throw Object.assign(new Error('日记已变化，请重新解锁后合并'), { status: 409 });
        data.diary = { revision: id(), envelope: b.envelope };
        result = { revision: data.diary.revision };
      } else if (path === 'import/preview') {
        const bytes = from64(b.content);
        let parsed;
        if (b.type === 'courses') {
          const candidates = /\.ics$/i.test(b.filename)
            ? icsImport(decode.decode(bytes))
            : courseImport(
                await readRows(bytes, b.filename, b.worksheet),
                b.semesterStart || data.settings.semesterStart,
                { defaultWeeks: b.defaultWeeks, sectionTimes: b.sectionTimes },
              );
          const known = new Set(data.events.map(courseFingerprint));
          const items = candidates.filter((e) => {
            const h = courseFingerprint(e);
            if (known.has(h)) return false;
            known.add(h);
            return true;
          });
          parsed = {
            items,
            duplicates: candidates.length - items.length,
            conflicts: items.filter((e) => data.events.some((x) => overlaps(e, x))).length,
          };
        } else
          parsed = billImport(
            await readRows(bytes, b.filename, b.worksheet),
            b.type,
            data.transactions,
          );
        preview = {
          ...parsed,
          token: id(),
          type: b.type === 'courses' ? 'events' : 'transactions',
          at: Date.now(),
        };
        return structuredClone(preview);
      } else if (path === 'import/commit') {
        if (!preview || preview.token !== b.token || Date.now() - preview.at > 900000)
          throw new Error('预览已过期');
        data[preview.type].push(...preview.items);
        result = { count: preview.items.length };
        preview = null;
      } else if (path === 'plan') {
        if (
          !Number.isInteger(Number(b.days)) ||
          Number(b.days) < 1 ||
          Number(b.days) > 30 ||
          ![25, 45, 60, 90, 120].includes(Number(b.duration))
        )
          throw new Error('规划参数无效');
        let items;
        if (!b.useAI)
          items = localPlan(b.goal, data.events, data.settings, Number(b.days), Number(b.duration));
        else {
          if (!b.consent) throw new Error('请先确认 AI 数据范围');
          const response = await ai(
            '输出 json {"items":[{"title":"学习","date":"YYYY-MM-DD","start":"HH:mm","end":"HH:mm","kind":"study"}]}。按北京时间安排目标，避开 busy，每天一个时段，未来 days 天内，单次 duration 分钟，只在作息内，不早于 now。',
            {
              goal: text(b.goal, 2000),
              today: chinaDay(),
              now: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }),
              days: Number(b.days),
              duration: Number(b.duration),
              dayStart: data.settings.dayStart,
              dayEnd: data.settings.dayEnd,
              busy: data.events
                .filter((e) => e.date >= chinaDay() && e.date < addDays(chinaDay(), Number(b.days)))
                .map(({ date, start, end }) => ({ date, start, end })),
            },
          );
          items = validatePlan(response.items, data.events);
          if (
            items.length > Number(b.days) ||
            new Set(items.map((e) => e.date)).size !== items.length ||
            items.some(
              (e) =>
                e.date >= addDays(chinaDay(), Number(b.days)) ||
                e.start < data.settings.dayStart ||
                e.end > data.settings.dayEnd ||
                minutes(e.end) - minutes(e.start) !== Number(b.duration) ||
                Date.parse(e.date + 'T' + e.start + ':00+08:00') <= Date.now(),
            )
          )
            throw new Error('AI 时间建议未通过校验');
        }
        return { items, source: b.useAI ? 'DeepSeek · 手机直接调用' : '本机空闲时段规划' };
      } else if (path === 'plan/apply') {
        const items = validatePlan(b.items, data.events);
        if (items.some((e) => Date.parse(e.date + 'T' + e.start + ':00+08:00') <= Date.now()))
          throw new Error('建议时间已过');
        data.events.push(...items);
        result = { count: items.length };
      } else if (path === 'report') {
        const report = monthly(data, b.month);
        if (b.useAI) {
          if (!b.consent) throw new Error('请确认发送汇总');
          const response = await ai(
            '只根据统计输出中文 json {"summary":"总结","suggestions":["建议"]}，金额单位分，不猜测用户隐私。',
            report,
          );
          if (
            typeof response.summary !== 'string' ||
            response.summary.length > 6000 ||
            !Array.isArray(response.suggestions) ||
            response.suggestions.length > 10 ||
            response.suggestions.some((x) => typeof x !== 'string' || x.length > 1000)
          )
            throw new Error('AI 总结格式无效');
          report.ai = response;
        }
        data.reports[b.month] = report;
        result = report;
      } else if (path === 'restore') {
        const restored = await portableOpen(
          JSON.parse(decode.decode(from64(b.content))),
          b.password,
        );
        if (
          !Array.isArray(restored.state.events) ||
          !Array.isArray(restored.state.transactions) ||
          !restored.state.settings
        )
          throw new Error('备份内容无效');
        await saveLocalRecovery('before-restore');
        data = cleanOfflineState(restored.state);
        data._sync = null;
      } else throw new Error('离线版本不支持此操作');
      for (const month of Object.keys(data.reports))
        if (path !== 'report') {
          const old = data.reports[month];
          data.reports[month] = {
            ...monthly(data, month),
            ...(old.ai ? { ai: old.ai, aiStale: true } : {}),
          };
        }
      autoReports(data);
      await persist();
      return structuredClone(result);
    } catch (error) {
      before.aiUsage = data.aiUsage;
      data = before;
      throw error;
    }
  }
  async function connectPaired() {
    requireOpen();
    syncSession = null;
    await nativeRequest('pairing.resume');
    const connection = await nativeRequest('pairing.status');
    if (!connection.paired)
      throw Object.assign(new Error('请扫描电脑二维码完成配对'), { status: 401 });
    const metadata = await nativeRequest('pairing.sync', { action: 'metadata' });
    requireOpen();
    if (
      data._sync?.vaultId === metadata.vaultId &&
      data._sync?.remoteRevision === metadata.revision &&
      data._sync?.localRevision === (data._revision || 0)
    )
      return { unchanged: true, conflicts: [] };
    const remote = await nativeRequest('pairing.sync', { action: 'snapshot' });
    requireOpen();
    const latest = await nativeRequest('pairing.status');
    const origin = latest.origin;
    const unchanged =
      data._sync?.vaultId === remote.vaultId &&
      data._sync?.remoteRevision === remote.revision &&
      data._sync?.localRevision === (data._revision || 0);
    syncSession = {
      transport: 'paired',
      origin,
      remote,
      localRevision: data._revision || 0,
      base: data._sync?.vaultId === remote.vaultId ? data._sync.base : {},
      choices: {},
    };
    if (retryChoices?.vaultId === remote.vaultId)
      syncSession.choices = reusableChoices(
        mergeSnapshots(data, remote, syncSession.base).conflicts,
        retryChoices.entries,
      );
    if (unchanged) {
      syncSession = null;
      return { unchanged: true, conflicts: [] };
    }
    return previewSync();
  }
  function previewSync(choices = {}) {
    if (!syncSession) throw new Error('请先连接自己的电脑');
    Object.assign(syncSession.choices, choices);
    retryChoices = {
      vaultId: syncSession.remote.vaultId,
      entries: captureChoices(
        mergeSnapshots(data, syncSession.remote, syncSession.base).conflicts,
        syncSession.choices,
      ),
    };
    const merged = mergeSnapshots(data, syncSession.remote, syncSession.base, syncSession.choices);
    return { ...merged, deletion: deletionPlan(syncSession.remote, merged) };
  }
  async function commitSync({ confirmDeletions = false } = {}) {
    requireOpen();
    if (!syncSession) throw new Error('请重新连接电脑并同步');
    if (syncSession.localRevision !== (data._revision || 0))
      throw Object.assign(new Error('本机记录已变化，请重新同步后再选择冲突'), { status: 409 });
    const merge = previewSync();
    if (merge.conflicts.length) throw new Error('请先处理全部同步冲突');
    if (merge.deletion.needsConfirmation && !confirmDeletions)
      throw Object.assign(new Error('请先确认删除或恢复记录'), { status: 428 });
    // Confirm a durable local rollback copy before allowing either side to change.
    await saveLocalRecovery('before-sync');
    let final;
    try {
      final = await nativeRequest('pairing.sync', {
        origin: syncSession.origin,
        action: 'merge',
        body: {
          vaultId: syncSession.remote.vaultId,
          deleted: merge.deletion.deleted,
          restored: merge.deletion.restored,
          diaryDelete: merge.deletion.diaryDelete,
          confirmDeletions,
          expectedRevision: syncSession.remote.revision,
          tombstones: merge.tombstones,
          events: merge.events,
          transactions: merge.transactions,
          diary: merge.diary,
        },
      });
      const next = cleanOfflineState({
        ...structuredClone(data),
        events: final.events,
        transactions: final.transactions,
        diary: final.diary,
        tombstones: cleanTombstones(final.tombstones),
        _revision: (data._revision || 0) + 1,
        _sync: {
          origin: syncSession.origin,
          vaultId: syncSession.remote.vaultId,
          base: syncBase(final),
          remoteRevision: final.revision,
          localRevision: (data._revision || 0) + 1,
          lastAt: new Date().toISOString(),
        },
      });
      for (const month of Object.keys(next.reports)) {
        const old = next.reports[month];
        next.reports[month] = {
          ...monthly(next, month),
          ...(old.ai ? { ai: old.ai, aiStale: true } : {}),
        };
      }
      autoReports(next);
      // Keep the live state unchanged if storage rejects the merged snapshot.
      await stored('current', await portableSeal(next, key, salt));
      data = next;
      retryChoices = null;
      return { events: data.events.length, transactions: data.transactions.length };
    } catch (error) {
      if (final)
        throw new Error(
          '电脑已合并，但本机保存失败；本机原记录和同步前副本仍保留。请释放存储空间后重新同步',
        );
      if (error.status === 409)
        error.message = '电脑记录或同步状态已更新，请重新检查两端记录后再同步';
      throw error;
    } finally {
      // Never retry an old merge after an uncertain response or an expired preview.
      syncSession = null;
    }
  }
  function enqueue(job) {
    const work = queue.then(job);
    queue = work.catch(() => {});
    return work;
  }
  return {
    touch: () => {
      if (data) lastUse = Date.now();
    },
    api: (p, b) => enqueue(() => request(p, b)),
    backup: async () =>
      new Blob([JSON.stringify(await stored())], { type: 'application/octet-stream' }),
    recoveryFiles: async () => {
      requireOpen();
      return ((await stored('recovery-history')) || []).map((row) => row.name);
    },
    backupPrevious: async (name) => {
      requireOpen();
      const history = (await stored('recovery-history')) || [];
      const previous = name
        ? history.find((row) => row.name === name)?.envelope
        : await stored('before-sync');
      if (!previous) throw new Error('还没有同步前副本');
      return new Blob([JSON.stringify(previous)], { type: 'application/octet-stream' });
    },
    connectPaired: () => enqueue(connectPaired),
    previewSync: (choices) => enqueue(() => previewSync(choices)),
    commitSync: (options) => enqueue(() => commitSync(options)),
    exportFile: async (name, blob) => {
      if (blob.size > 16000000) throw new Error('手机导出上限为 16 MB');
      return nativeRequest('file.save', {
        filename: name,
        content: to64(new Uint8Array(await blob.arrayBuffer())),
      });
    },
  };
}
