import test from 'node:test';
import a from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  derive,
  seal,
  unseal,
  initialState,
  event,
  transaction,
  monthly,
  localPlan,
  overlaps,
  autoReports,
  chinaDay,
  addDays,
  previousMonth,
  date,
} from '../lib/core.mjs';
import {
  csvRows,
  readRows,
  billImport,
  courseImport,
  icsImport,
  xlsxRows,
} from '../lib/imports.mjs';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

test('vault encrypts all sensitive fields and detects password errors / tampering', () => {
  const salt = randomBytes(16).toString('base64'),
    password = 'a-secure-test-password',
    key = derive(password, salt),
    state = initialState();
  state.settings.apiKey = 'sk-secret-no-plaintext';
  const encoded = seal(state, key, salt);
  a.equal(encoded.includes('sk-secret'), false);
  a.deepEqual(unseal(encoded, password).data, state);
  a.throws(() => unseal(encoded, 'wrong-password-value'));
  const broken = JSON.parse(encoded);
  broken.body = Buffer.from('bad ciphertext').toString('base64');
  a.throws(() => unseal(broken, password));
});
test('strict event and money validation', () => {
  a.throws(() => event({ title: 'x', date: '2026-02-30', start: '10:00', end: '09:00' }));
  a.throws(() => date('2026-02-30'));
  a.throws(() => transaction({ date: '2026-01-01', amount: -1, direction: 'expense' }));
  a.equal(transaction({ date: '2026-01-01', amount: '18.55', direction: 'expense' }).amount, 1855);
});
test('CSV handles BOM, commas, escaped quotes, newlines and rejects unclosed quotes', () => {
  a.deepEqual(csvRows('a,b\r\n"hello, world","two\nlines"\r\n"a""b",x'), [
    ['a', 'b'],
    ['hello, world', 'two\nlines'],
    ['a"b', 'x'],
  ]);
  a.throws(() => csvRows('"broken'));
  const rows = readRows(Buffer.from('\ufeff交易时间,收/支,金额\n2026-10-01,支出,1'), 'bill.csv');
  a.equal(rows[0][0], '交易时间');
});
test('WeChat: money, transfer, refunds, status, repeated imports', () => {
  const rows = readRows(
    readFileSync(new URL('../examples/微信账单示例.csv', import.meta.url)),
    'wx.csv',
  );
  const p = billImport(rows, 'wechat');
  a.equal(p.items.length, 4);
  a.equal(p.items[0].category, '餐饮');
  a.equal(p.items[1].direction, 'transfer');
  a.equal(p.items[3].direction, 'refund');
  const s = initialState();
  s.transactions = p.items;
  const r = monthly(s, '2026-10');
  a.equal(r.netExpense, 1850);
  a.equal(r.refund, 5000);
  a.equal(r.income, 0);
  a.equal(billImport(rows, 'wechat', p.items).duplicates, 4);
  a.equal(billImport(rows, 'wechat', p.items).items.length, 0);
  const bad = [
    ...rows,
    ['2026-10-22', '消费', '商户', '订单', '支出', '40', '', '交易关闭', 'closed'],
    ['2026-10-22', '消费', '商户', '订单', '支出', 'invalid', '', '支付成功', 'invalid'],
  ];
  const pp = billImport(bad, 'wechat');
  a.equal(pp.ignored, 1);
  a.equal(pp.invalid, 1);
});
test('Alipay transaction-order header preserves identity when amounts coincide', () => {
  const rows = readRows(
    readFileSync(new URL('../examples/支付宝账单示例.csv', import.meta.url)),
    'ali.csv',
  );
  const p = billImport(rows, 'alipay');
  a.equal(p.items.length, 2);
  a.equal(p.items[0].amount, 300);
  a.equal(p.items[1].direction, 'income');
  const copy = [...rows.at(-1)];
  copy[9] = 'DEMO-ALI-003';
  const more = billImport([...rows, copy], 'alipay');
  a.equal(more.items.length, 3);
});
test('weekly course CSV handles odd/even weeks and validates Monday', () => {
  const rows = csvRows(
    '课程名称,日期,星期,开始时间,结束时间,周次,地点\n数学,,1,08:00,09:35,1-4单周,A\n英语,,3,10:00,11:30,1-4双周,B',
  );
  const p = courseImport(rows, '2026-09-07');
  a.equal(p.length, 4);
  a.deepEqual(
    p.map((e) => e.date),
    ['2026-09-07', '2026-09-21', '2026-09-16', '2026-09-30'],
  );
  a.throws(() => courseImport(rows, '2026-09-08'));
});
test('ICS unfolding, UTC conversion, weekly repeat, EXDATE and timezone guard', () => {
  const ics =
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20260907T000000Z\r\nDTEND:20260907T013500Z\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE:20260914T000000Z\r\nSUMMARY:Math\\, A\r\nLOCATION:Building\r\n A\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const p = icsImport(ics);
  a.equal(p.length, 3);
  a.equal(p[0].start, '08:00');
  a.equal(p[0].title, 'Math, A');
  a.equal(p[0].location, 'BuildingA');
  a.equal(p[1].date, '2026-09-21');
  a.throws(() => icsImport(ics.replace('DTSTART:', 'DTSTART;TZID=Europe/London:')));
  a.throws(() => icsImport(ics.replace('FREQ=WEEKLY', 'FREQ=DAILY')));
});
test('weekly ICS with multiple weekdays respects Monday-based interval', () => {
  const p = icsImport(
    'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260909T080000\nDTEND:20260909T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4\nSUMMARY:Class\nEND:VEVENT\nEND:VCALENDAR',
  );
  a.deepEqual(
    p.map((e) => e.date),
    ['2026-09-09', '2026-09-21', '2026-09-23', '2026-10-05'],
  );
});
test('local planner avoids busy periods, returns future dates and respects time bounds', () => {
  const s = initialState();
  const day = addDays(chinaDay(), 1);
  const busy = [event({ title: 'Busy', date: day, start: '08:00', end: '11:00' })];
  const p = localPlan('Study', busy, s.settings, 3, 60);
  a.ok(p.length >= 2);
  a.equal(
    p.some((e) => busy.some((b) => overlaps(e, b))),
    false,
  );
  a.ok(p.every((e) => e.start >= '08:00' && e.end <= '22:00' && e.date >= chinaDay()));
});
test('monthly automation backfills missed months but never invents AI output', () => {
  const s = initialState();
  s.transactions.push(transaction({ date: '2025-12-05', amount: 10, direction: 'expense' }));
  a.equal(autoReports(s), true);
  a.equal(s.reports['2025-12'].expense, 1000);
  a.equal(s.reports['2025-12'].ai, undefined);
  a.ok(s.reports[previousMonth()]);
  a.equal(autoReports(s), false);
});

function tinyZip(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const n = Buffer.from(name),
      raw = Buffer.from(content),
      data = deflateRawSync(raw);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(8, 8);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += h.length + n.length + data.length;
  }
  const cs = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cs.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cs, end]);
}
test('bounded XLSX parser resolves shared strings, inline strings and sparse columns', () => {
  const zip = tinyZip([
    ['xl/sharedStrings.xml', '<sst><si><t>交易时间</t></si><si><t>收/支</t></si></sst>'],
    [
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>金额</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-01</t></is></c><c r="C2" t="inlineStr"><is><t>支出</t></is></c><c r="D2"><v>12.3</v></c></row></sheetData></worksheet>',
    ],
  ]);
  const rows = xlsxRows(zip);
  a.equal(rows[0][0], '交易时间');
  a.equal(rows[0][2], '收/支');
  a.equal(rows[1][3], '12.3');
  a.equal(billImport(rows, 'wechat').items[0].amount, 1230);
  a.throws(() => xlsxRows(Buffer.from('invalid')));
});
