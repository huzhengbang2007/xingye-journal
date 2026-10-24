import test from 'node:test';
import a from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { sha256 } from '../public/sha256.js';
import { mergeSnapshots, syncBase } from '../public/sync.js';
import { portableKey, portableSeal, portableOpen, cleanOfflineState } from '../public/offline.js';
import { initialState, event } from '../public/domain.js';
import { unseal } from '../lib/core.mjs';
import { readRows as readBrowser, billImport as browserBill } from '../public/imports.js';
import { readRows, billImport } from '../lib/imports.mjs';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
test('browser fingerprints match Node SHA-256 including Unicode and block boundaries', () => {
  for (const value of [
    '',
    '星野记💙',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    randomBytes(4096).toString('hex'),
  ])
    a.equal(sha256(value), createHash('sha256').update(value).digest('hex'));
});
test('first sync unions independent records and detects divergent edits / deletions', () => {
  const e = event({ title: '计划', date: '2026-10-25', start: '10:00', end: '11:00' }),
    f = { ...e, id: 'another', title: '另一个' };
  const baseState = { events: [e], transactions: [], diary: null },
    base = syncBase(baseState);
  a.equal(
    mergeSnapshots({ events: [e], transactions: [] }, { events: [f], transactions: [] }).events
      .length,
    2,
  );
  a.equal(mergeSnapshots({ ...baseState, events: [] }, baseState, base).events.length, 0);
  const conflict = mergeSnapshots(
    { ...baseState, events: [{ ...e, title: '手机修改' }] },
    { ...baseState, events: [{ ...e, title: '电脑修改' }] },
    base,
  );
  a.equal(conflict.conflicts.length, 1);
  const resolved = mergeSnapshots(
    { ...baseState, events: [] },
    { ...baseState, events: [{ ...e, title: '电脑修改' }] },
    base,
    { ['events/' + e.id]: 'remote' },
  );
  a.equal(resolved.events[0].title, '电脑修改');
});
test('duplicate financial fingerprints are merged; separate diary ciphertext requires explicit choice', () => {
  const t = {
    id: 'a',
    date: '2026-10-25',
    amount: 100,
    direction: 'expense',
    merchant: '食堂',
    category: '餐饮',
    source: 'wechat',
    fingerprint: 'same',
  };
  const local = { events: [], transactions: [t], diary: { envelope: { body: 'local' } } },
    remote = {
      events: [],
      transactions: [{ ...t, id: 'b' }],
      diary: { envelope: { body: 'remote' } },
    };
  const preview = mergeSnapshots(local, remote);
  a.equal(preview.transactions.length, 1);
  a.equal(preview.duplicates, 1);
  a.equal(preview.conflicts[0].type, 'diary');
  a.equal(mergeSnapshots(local, remote, {}, { diary: 'local' }).diary.envelope.body, 'local');
});
test('mobile backup is encrypted, wrong password rejected, and desktop can restore its v2 envelope', async () => {
  const password = 'independent-mobile-password',
    salt = crypto.getRandomValues(new Uint8Array(16)),
    key = await portableKey(password, salt),
    state = initialState();
  state.events.push(
    event({ title: '本机秘密计划', date: '2026-10-25', start: '10:00', end: '11:00' }),
  );
  const envelope = await portableSeal(state, key, salt);
  a.equal(JSON.stringify(envelope).includes('秘密'), false);
  a.deepEqual((await portableOpen(envelope, password)).state, state);
  a.deepEqual(unseal(envelope, password).data, state);
  await a.rejects(() => portableOpen(envelope, 'wrong-long-password'));
  a.throws(() =>
    cleanOfflineState({ ...state, events: [{ ...state.events[0], start: '<script>' }] }),
  );
});
test('offline bill parsing matches desktop import and transaction fingerprints', async () => {
  for (const [filename, source] of [
    ['微信账单示例.csv', 'wechat'],
    ['支付宝账单示例.csv', 'alipay'],
  ]) {
    const buffer = readFileSync(new URL('../examples/' + filename, import.meta.url));
    const desktop = billImport(readRows(buffer, 'sample.csv'), source),
      mobile = browserBill(await readBrowser(new Uint8Array(buffer), 'sample.csv'), source);
    a.deepEqual(
      mobile.items.map(({ id, ...t }) => t),
      desktop.items.map(({ id, ...t }) => t),
    );
  }
});
test('offline XLSX decoder bounds and inflates the real worksheet ZIP stream', async () => {
  const name = Buffer.from('xl/worksheets/sheet1.xml'),
    raw = Buffer.from(
      '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>交易时间</t></is></c><c r="B1" t="inlineStr"><is><t>收/支</t></is></c><c r="C1" t="inlineStr"><is><t>金额</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>2026-10-22</t></is></c><c r="B2" t="inlineStr"><is><t>支出</t></is></c><c r="C2"><v>7.50</v></c></row></sheetData></worksheet>',
    ),
    compressed = deflateRawSync(raw),
    header = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(header.length + name.length + compressed.length, 16);
  const buffer = Buffer.concat([header, name, compressed, central, name, end]);
  const rows = await readBrowser(new Uint8Array(buffer), 'bill.xlsx');
  a.equal(browserBill(rows, 'alipay').items[0].amount, 750);
});

test('deletion markers prevent silent resurrection when the sync base is missing', () => {
  const row = {
    id: 'deleted',
    title: '已删除',
    date: '2026-10-24',
    start: '10:00',
    end: '11:00',
    kind: 'study',
  };
  const local = { events: [row], transactions: [] },
    remote = {
      events: [],
      transactions: [],
      tombstones: { events: ['deleted'], transactions: [] },
    };
  const preview = mergeSnapshots(local, remote);
  a.equal(preview.conflicts.length, 1);
  const result = mergeSnapshots(local, remote, {}, { 'events/deleted': 'remote' });
  a.equal(result.events.length, 0);
  a.deepEqual(result.tombstones.events, ['deleted']);
  const again = mergeSnapshots({ ...local, tombstones: result.tombstones, events: [] }, remote);
  a.equal(again.conflicts.length, 0);
  a.equal(again.events.length, 0);
});
