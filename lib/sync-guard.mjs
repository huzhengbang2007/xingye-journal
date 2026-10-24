import { cleanTombstones, recordHash } from '../public/sync.js';

const ensureSync = (ok, message, status = 409) => {
  if (!ok) throw Object.assign(new Error(message), { status });
};

// Kept by the authenticated transport, never accepted from the request body.
export function syncBaseline(snapshot) {
  return {
    vaultId: snapshot.vaultId,
    revision: snapshot.revision,
    events: new Set(snapshot.events.map((row) => row.id)),
    transactions: new Set(snapshot.transactions.map((row) => row.id)),
    tombstones: Object.fromEntries(
      Object.entries(cleanTombstones(snapshot.tombstones)).map(([type, ids]) => [
        type,
        new Set(ids),
      ]),
    ),
    diary: recordHash('diary', snapshot.diary),
  };
}

export function guardSync(state, body, baseline, incoming) {
  ensureSync(body.vaultId === state.vaultId, '保险库不匹配，请重新连接并预览同步');
  ensureSync(
    body.expectedRevision === (state._revision || 0),
    '电脑上的记录已变化，请重新连接并预览同步',
  );
  const deleted = cleanTombstones(body.deleted);
  const tombstones = cleanTombstones(state.tombstones);
  const restored = cleanTombstones(body.restored);
  let restoreCount = 0;
  const records = {};
  let count = 0;
  for (const type of ['events', 'transactions']) {
    const active = new Set(incoming[type].map((row) => row.id));
    const removed = new Set(deleted[type]);
    const previouslyDeleted = new Set(tombstones[type]);
    const restoring = new Set(restored[type]);
    if (restoring.size) {
      ensureSync(
        baseline?.vaultId === state.vaultId &&
          baseline.revision === body.expectedRevision &&
          [...restoring].every(
            (id) =>
              baseline.tombstones?.[type]?.has(id) && previouslyDeleted.has(id) && active.has(id),
          ),
        '恢复记录前请重新预览删除与编辑冲突',
      );
    }
    restoreCount += restoring.size;
    ensureSync(
      incoming[type].every((row) => !previouslyDeleted.has(row.id) || restoring.has(row.id)),
      '记录已删除；请重新预览并明确确认恢复后再同步',
    );
    if (removed.size) {
      ensureSync(
        baseline?.vaultId === state.vaultId && baseline.revision === body.expectedRevision,
        '删除前请重新获取电脑记录',
      );
      const existing = new Set(state[type].map((row) => row.id));
      ensureSync(
        [...removed].every((id) => baseline[type].has(id) && existing.has(id) && !active.has(id)),
        '删除列表与已预览记录不匹配',
      );
    }
    count += removed.size;
    // Omission is not deletion. Older or incomplete clients cannot erase unseen rows.
    records[type] = [
      ...incoming[type],
      ...state[type].filter((row) => !active.has(row.id) && !removed.has(row.id)),
    ];
    ensureSync(
      records[type].length <= (type === 'events' ? 50000 : 100000),
      '同步后记录数量超过上限',
      400,
    );
  }
  const total = state.events.length + state.transactions.length;
  const needsConfirmation =
    count > 20 ||
    (count > 0 && count / total >= 0.3) ||
    body.diaryDelete === true ||
    restoreCount > 0;
  ensureSync(
    !needsConfirmation || body.confirmDeletions === true,
    '本次包含批量删除、日记删除或恢复已删除记录，请在手机确认后再同步',
    428,
  );
  if (body.diaryDelete === true) {
    ensureSync(!body.diary, '日记写入与删除不能同时提交', 400);
    ensureSync(
      baseline?.vaultId === state.vaultId &&
        baseline.revision === body.expectedRevision &&
        baseline.diary === recordHash('diary', state.diary),
      '删除日记前请重新预览电脑记录',
    );
  }
  return { ...records, deleted };
}
