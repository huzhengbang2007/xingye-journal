import { selectWorksheet } from './workbook.js';
const decode = (v) => new TextDecoder().decode(v);
const u16 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(p, true);
const u32 = (b, p) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(p, true);
async function inflate(data, limit) {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('当前系统不支持 XLSX 解压，请升级 Android System WebView 或使用 CSV 文件');
  const reader = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('XLSX 解压后过大');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
import * as domain from './domain.js';
const { assert } = domain;

import { createImportCore, xmlText } from './import-core.js';
export const { csvRows, billImport, icsImport, courseImport, courseFingerprint } =
  createImportCore(domain);
export async function xlsxRows(buffer, worksheet = '') {
  const files = new Map();
  let expanded = 0,
    entries = 0;
  // Read the central directory, including XLSX archives with data descriptors.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (u32(buffer, i) === 0x06054b50) {
      end = i;
      break;
    }
  assert(end >= 0, '无法读取 XLSX，请解压后选择 .xlsx 文件或导出 CSV');
  let p = u32(buffer, end + 16);
  const count = u16(buffer, end + 10);
  assert(count <= 2000, 'XLSX 文件过于复杂');
  while (p + 46 <= buffer.length && u32(buffer, p) === 0x02014b50) {
    assert(++entries <= 2000, 'XLSX 条目过多');
    const method = u16(buffer, p + 10),
      size = u32(buffer, p + 20),
      unpacked = u32(buffer, p + 24),
      nl = u16(buffer, p + 28),
      el = u16(buffer, p + 30),
      cl = u16(buffer, p + 32),
      offset = u32(buffer, p + 42);
    const name = decode(buffer.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (
      !/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(
        name,
      )
    )
      continue;
    expanded += unpacked;
    assert(expanded <= 24 * 1024 * 1024 && unpacked < 16 * 1024 * 1024, 'XLSX 解压后过大');
    assert(offset + 30 <= buffer.length && u32(buffer, offset) === 0x04034b50, 'XLSX 压缩结构损坏');
    const start = offset + 30 + u16(buffer, offset + 26) + u16(buffer, offset + 28);
    assert(start + size <= buffer.length, 'XLSX 数据损坏');
    const data = buffer.subarray(start, start + size);
    assert(method === 0 || method === 8, '不支持此 XLSX 压缩格式');
    const content =
      method === 0 ? data : await inflate(data, Math.min(16 * 1024 * 1024, unpacked + 1));
    files.set(name, decode(content));
  }
  const strings = [
    ...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
  ].map((m) => xmlText(m[1]));
  const sheet = selectWorksheet(files, worksheet);
  assert(sheet, 'XLSX 中没有工作表');
  const rows = [];
  for (const m of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const row = [],
      index = Number(/\br="(\d+)"/.exec(m[1])?.[1] || rows.length + 1) - 1;
    assert(index >= 0 && index < 100000, '工作表行号过大，请只保留需要导入的明细');
    for (const c of m[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const address = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1];
      if (!address) continue;
      let col = 0;
      for (const a of address) col = col * 26 + a.charCodeAt(0) - 64;
      assert(col <= 16384, 'XLSX 列地址超出范围');
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(c[2] || '')?.[1] || '';
      row[col - 1] = /\bt="s"/.test(c[1])
        ? strings[Number(v)] || ''
        : /\bt="inlineStr"/.test(c[1])
          ? xmlText(c[2] || '')
          : xmlText(v);
    }
    rows[index] = row;
  }
  for (let i = 0; i < rows.length; i++) rows[i] ||= [];
  const address = (text) => {
    const match = /^([A-Z]+)(\d+)$/.exec(text);
    assert(match, 'XLSX 合并单元格地址无效');
    let col = 0;
    for (const c of match[1]) col = col * 26 + c.charCodeAt(0) - 64;
    return [Number(match[2]) - 1, col - 1];
  };
  rows.mergeRanges = [
    ...sheet.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"[^>]*\/?>/g),
  ].map((match) => {
    const [startRow, startCol] = address(match[1]),
      [endRow, endCol] = address(match[2]);
    return { startRow, startCol, endRow, endCol };
  });
  return rows;
}
export async function readRows(buffer, filename, worksheet = '') {
  assert(buffer.length <= 8 * 1024 * 1024, '文件不能超过 8 MB');
  if (/\.xlsx$/i.test(filename)) return xlsxRows(buffer, worksheet);
  assert(
    /\.(csv|tsv|txt)$/i.test(filename),
    '请选择 CSV、TSV 或 XLSX 文件，旧版 XLS 请先另存为 XLSX，也可直接复制表格粘贴',
  );
  let raw;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    raw = new TextDecoder('gb18030').decode(buffer);
  }
  return csvRows(raw.replace(/^\uFEFF/, ''));
}
