import test from 'node:test';
import a from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { csvRows, courseImport, readRows } from '../lib/imports.mjs';
import {
  csvRows as browserRows,
  courseImport as browserCourses,
  readRows as browserRead,
} from '../public/imports.js';

const stripIds = (items) => items.map(({ id, ...item }) => item);
const semester = '2026-09-07';
function parity(raw, options = {}, start = semester) {
  const desktop = stripIds(courseImport(csvRows(raw), start, options));
  a.deepEqual(stripIds(browserCourses(browserRows(raw), start, options)), desktop);
  return desktop;
}
function worksheetZip(xml) {
  const name = Buffer.from('xl/worksheets/sheet1.xml'),
    raw = Buffer.from(xml),
    compressed = deflateRawSync(raw);
  const local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}
const cell = (address, text) => `<c r="${address}" t="inlineStr"><is><t>${text}</t></is></c>`;

test('paste accepts TSV, Chinese aliases/full-width times and weekday names, with browser/server parity', () => {
  const items = parity(
    '教务导出课表\n科目\t周几\t开始\t结束\t教学周\t教室\n数学\t星期一\t８：００\t9:35\t第1～4周（单）\tA101\n英语\t礼拜三\t10:5\t11:40:00\t1、3周\tB201',
  );
  a.deepEqual(
    items.map((item) => [item.title, item.date, item.start, item.end]),
    [
      ['数学', '2026-09-07', '08:00', '09:35'],
      ['数学', '2026-09-21', '08:00', '09:35'],
      ['英语', '2026-09-09', '10:05', '11:40'],
      ['英语', '2026-09-23', '10:05', '11:40'],
    ],
  );
});
test('semicolon exports, ISO-like dates and quoted CSV text retain their content', () => {
  const items = parity('course;date;start;end;room\n"Math; A";2026/9/7;8:00;9:00;A', {}, '');
  a.equal(items[0].title, 'Math; A');
  a.equal(items[0].date, semester);
  a.equal(
    parity('课程,日期,时间\n"实验, A",2026年9月7日,08:00至09:35', {}, '')[0].title,
    '实验, A',
  );
  a.throws(() => csvRows('课程\t日期\n"未闭合'), /引号未闭合/);
});
test('Excel numeric date and time cells normalize without requiring a semester date', () => {
  const serial = (Date.parse(semester) - Date.UTC(1899, 11, 30)) / 86400000;
  const items = parity(
    `课程名称,上课日期,开始时间,结束时间\n实验,${serial},${8 / 24},${9.5 / 24}`,
    {},
    '',
  );
  a.equal(items[0].date, semester);
  a.equal(items[0].start, '08:00');
  a.equal(items[0].end, '09:30');
});
test('list imports can use a combined time range or an explicit section mapping with default weeks', () => {
  const range = parity('课程,星期,时间\n数学,Monday,8:00—9:35', { defaultWeeks: '1-2双周' });
  a.equal(range.length, 1);
  a.equal(range[0].date, '2026-09-14');
  const raw = '课程,星期,节次,周次\n英语,周五,第1-2节,1-2';
  const items = parity(raw, { sectionTimes: '1=08:00-08:45\n2=08:55-09:40' });
  a.equal(items[0].start, '08:00');
  a.equal(items[0].end, '09:40');
  a.throws(() => parity(raw), /第 2 行「英语」.*缺少第 1 节的实际时间/);
  a.throws(() => parity(raw, { sectionTimes: '1=08:00-08:45' }), /缺少第 2 节的实际时间/);
});
test('matrix paste uses explicit time ranges, per-cell weeks and labelled classroom', () => {
  const items = parity(
    '时间\t星期一\t星期二\n08:00-09:35\t"高等数学\n1-2周\n教室：A101"\t"大学英语\n1-4周(双)\n地点：B201"',
  );
  a.equal(items.length, 4);
  a.equal(items[0].title, '高等数学');
  a.equal(items[0].location, 'A101');
  a.deepEqual(
    items.filter((item) => item.title === '大学英语').map((item) => item.date),
    ['2026-09-15', '2026-09-29'],
  );
  a.throws(
    () => parity('节次\t周一\t周二\n1-2\t数学\t', { defaultWeeks: '1-2' }),
    /第 2 行，周一.*缺少第 1 节/,
  );
});
test('XLSX vertical merge spans every explicit lesson time and keeps sparse worksheet row addresses', async () => {
  const xml = `<worksheet><sheetData><row r="2">${cell('A2', '节次')}${cell('B2', '周一')}${cell('C2', '周二')}</row><row r="3">${cell('A3', '第1节')}${cell('B3', '数学\n1-2周\n教室：A101')}</row><row r="4">${cell('A4', '第2节')}</row></sheetData><mergeCells count="1"><mergeCell ref="B3:B4"/></mergeCells></worksheet>`;
  const zip = worksheetZip(xml),
    rows = readRows(zip, '课程.xlsx'),
    mobile = await browserRead(new Uint8Array(zip), '课程.xlsx');
  a.equal(rows[0].length, 0);
  a.equal(rows[1][0], '节次');
  const options = { sectionTimes: '1=08:00-08:45\n2=08:55-09:40' };
  const imported = stripIds(courseImport(rows, semester, options));
  a.deepEqual(stripIds(browserCourses(mobile, semester, options)), imported);
  a.equal(imported.length, 2);
  a.equal(imported[0].end, '09:40');
});
test('ambiguous matrix rules, missing weeks, invalid weekdays and dates fail with useful context', () => {
  a.throws(() => parity('课程,星期,时间\n数学,周一,08:00-09:00'), /第 2 行「数学」.*请填写周次/);
  a.throws(() => parity('课程,星期,时间,周次\n数学,周八,08:00-09:00,1-2'), /无法识别星期/);
  a.throws(
    () => parity('课程,日期,开始,结束\n数学,2026-02-30,08:00,09:00', {}, ''),
    /第 2 行「数学」.*日期无效/,
  );
  a.throws(
    () => parity('课程,星期,时间,周次\n数学,周一,08:00-09:00,1-2', {}, '2026-09-08'),
    /必须为周一/,
  );
  a.throws(() => parity('时间\t周一\t周二\n08:00-09:00\t"数学\n1-2周\n英语\n3-4周"\t'), /多组周次/);
  a.throws(() => parity('课程,星期,时间,周次\n数学,周一,08:00-09:00,1-31'), /周次需为 1–30/);
});
test('TSV files follow the same path as paste and XLSX horizontal merges fail instead of losing days', async () => {
  const raw = '课程\t日期\t开始\t结束\n数学\t2026-09-07\t08:00\t09:00';
  a.deepEqual(
    readRows(Buffer.from(raw), '课表.tsv'),
    await browserRead(new TextEncoder().encode(raw), '课表.tsv'),
  );
  const rows = [
    ['时间', '周一', '周二'],
    ['08:00-09:00', '数学\n1-2周'],
  ];
  rows.mergeRanges = [{ startRow: 1, endRow: 1, startCol: 1, endCol: 2 }];
  a.throws(() => courseImport(rows, semester), /横跨多个星期/);
});
