import { hash } from './domain.js';
const eventFields = [
  'id',
  'title',
  'date',
  'start',
  'end',
  'kind',
  'location',
  'done',
  'reminder',
  'alarm',
];
const transactionFields = [
  'id',
  'date',
  'amount',
  'direction',
  'category',
  'merchant',
  'source',
  'fingerprint',
];
export function recordHash(type, record) {
  if (!record) return null;
  if (type === 'diary') return hash(JSON.stringify(record.envelope || record));
  const fields = type === 'events' ? eventFields : transactionFields;
  return hash(
    JSON.stringify(
      fields.map(
        (k) => record[k] ?? (k === 'reminder' ? 10 : k === 'alarm' || k === 'done' ? false : ''),
      ),
    ),
  );
}
export function syncBase(snapshot) {
  return {
    events: Object.fromEntries(snapshot.events.map((r) => [r.id, recordHash('events', r)])),
    transactions: Object.fromEntries(
      snapshot.transactions.map((r) => [r.id, recordHash('transactions', r)]),
    ),
    diary: recordHash('diary', snapshot.diary),
  };
}
export function captureChoices(conflicts, choices) {
  return conflicts
    .filter((conflict) => ['local', 'remote'].includes(choices[conflict.key]))
    .map((conflict) => ({
      key: conflict.key,
      choice: choices[conflict.key],
      local: recordHash(conflict.type, conflict.local),
      remote: recordHash(conflict.type, conflict.remote),
    }));
}
export function reusableChoices(conflicts, previous = []) {
  return Object.fromEntries(
    conflicts.flatMap((conflict) => {
      const saved = previous.find(
        (row) =>
          row.key === conflict.key &&
          row.local === recordHash(conflict.type, conflict.local) &&
          row.remote === recordHash(conflict.type, conflict.remote),
      );
      return saved ? [[conflict.key, saved.choice]] : [];
    }),
  );
}
export function deletionPlan(remote, merged) {
  const deleted = Object.fromEntries(
    ['events', 'transactions'].map((type) => {
      const keep = new Set(merged[type].map((row) => row.id));
      return [type, remote[type].filter((row) => !keep.has(row.id)).map((row) => row.id)];
    }),
  );
  const count = deleted.events.length + deleted.transactions.length;
  const total = remote.events.length + remote.transactions.length;
  const diaryDelete = Boolean(remote.diary && !merged.diary);
  const restored = cleanTombstones(merged.restored);
  const restoreCount = restored.events.length + restored.transactions.length;
  return {
    deleted,
    diaryDelete,
    count,
    restored,
    restoreCount,
    needsConfirmation:
      count > 20 || (count > 0 && count / total >= 0.3) || diaryDelete || restoreCount > 0,
  };
}
export function cleanTombstones(value = {}) {
  return Object.fromEntries(
    ['events', 'transactions'].map((type) => {
      const rows = value[type] || [];
      if (
        !Array.isArray(rows) ||
        rows.length > 100000 ||
        !rows.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 80)
      )
        throw Object.assign(new Error('同步删除标记无效'), { status: 400 });
      return [type, [...new Set(rows)]];
    }),
  );
}
export function combineTombstones(local, remote, records) {
  const a = cleanTombstones(local),
    b = cleanTombstones(remote);
  return Object.fromEntries(
    ['events', 'transactions'].map((type) => {
      const active = new Set(records[type].map((r) => r.id));
      const deleted = [...new Set([...a[type], ...b[type]])].filter((id) => !active.has(id));
      if (deleted.length > 100000) throw new Error('同步删除标记超过容量');
      return [type, deleted];
    }),
  );
}
export function rememberDeletion(state, type, id) {
  state.tombstones = cleanTombstones(state.tombstones);
  if (!state.tombstones[type].includes(id)) {
    if (state.tombstones[type].length >= 100000) throw new Error('同步删除标记超过容量');
    state.tombstones[type].push(id);
  }
}
export function mergeSnapshots(local, remote, base = {}, choices = {}) {
  const merged = {
      events: [],
      transactions: [],
      diary: null,
      tombstones: cleanTombstones(),
      restored: cleanTombstones(),
    },
    conflicts = [];
  let duplicates = 0;
  for (const type of ['events', 'transactions']) {
    const deletedLeft = new Set(cleanTombstones(local.tombstones)[type]),
      deletedRight = new Set(cleanTombstones(remote.tombstones)[type]);
    let localRows = local[type];
    if (type === 'transactions') {
      const byFingerprint = new Map(remote.transactions.map((r) => [r.fingerprint, r]));
      localRows = localRows.map((r) => {
        const same = byFingerprint.get(r.fingerprint);
        if (same && same.id !== r.id) {
          duplicates++;
          return { ...r, id: same.id };
        }
        return r;
      });
    }
    if (type === 'events') {
      const key = (e) => hash([e.title, e.date, e.start, e.end, e.location].join('|'));
      const courses = new Map(
        remote.events.filter((e) => e.kind === 'course').map((e) => [key(e), e]),
      );
      localRows = localRows.map((e) => {
        const same = e.kind === 'course' ? courses.get(key(e)) : null;
        if (same && same.id !== e.id) {
          duplicates++;
          return { ...e, id: same.id };
        }
        return e;
      });
    }
    const left = new Map(localRows.map((r) => [r.id, r])),
      right = new Map(remote[type].map((r) => [r.id, r]));
    for (const id of new Set([
      ...left.keys(),
      ...right.keys(),
      ...Object.keys(base[type] || {}),
      ...deletedLeft,
      ...deletedRight,
    ])) {
      const l = left.get(id) || null,
        r = right.get(id) || null,
        b = base[type]?.[id] || null,
        lh = recordHash(type, l),
        rh = recordHash(type, r);
      let selected;
      if ((!l && r && deletedLeft.has(id)) || (!r && l && deletedRight.has(id))) {
        const key = type + '/' + id;
        if (choices[key] === 'local') selected = l;
        else if (choices[key] === 'remote') selected = r;
        else if (b && (lh === b || rh === b)) selected = null;
        else {
          conflicts.push({ key, type, id, local: l, remote: r });
          continue;
        }
      } else if (lh === rh) selected = r || l;
      else if (lh === b) selected = r;
      else if (rh === b) selected = l;
      else {
        const key = type + '/' + id;
        if (choices[key] === 'local') selected = l;
        else if (choices[key] === 'remote') selected = r;
        else {
          conflicts.push({ key, type, id, local: l, remote: r });
          continue;
        }
      }
      if (selected) {
        merged[type].push(selected);
        if (deletedRight.has(id)) merged.restored[type].push(id);
      } else if (b || deletedLeft.has(id) || deletedRight.has(id)) merged.tombstones[type].push(id);
    }
  }
  const l = recordHash('diary', local.diary),
    r = recordHash('diary', remote.diary),
    b = base.diary || null;
  if (l === r) merged.diary = remote.diary || local.diary || null;
  else if (l === b) merged.diary = remote.diary;
  else if (r === b) merged.diary = local.diary;
  else if (choices.diary === 'local') merged.diary = local.diary;
  else if (choices.diary === 'remote') merged.diary = remote.diary;
  else conflicts.push({ key: 'diary', type: 'diary', local: local.diary, remote: remote.diary });
  return { ...merged, conflicts, duplicates };
}
