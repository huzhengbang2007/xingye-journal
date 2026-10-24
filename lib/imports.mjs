import { selectWorksheet } from '../public/workbook.js';
import { inflateRawSync } from 'node:zlib';
import * as domain from './core.mjs';
const { assert } = domain;

import { createImportCore, xmlText } from '../public/import-core.js';
export const { csvRows, billImport, icsImport, courseImport, courseFingerprint } =
  createImportCore(domain);
export function xlsxRows(buffer, worksheet = '') {
  const files = new Map();
  let expanded = 0,
    entries = 0;
  // Read the central directory, including XLSX archives with data descriptors.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  assert(end >= 0, '无法读取 XLSX，请解压后选择 .xlsx 文件或导出 CSV');
  let p = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  assert(count <= 2000, 'XLSX 文件过于复杂');
  while (p + 46 <= buffer.length && buffer.readUInt32LE(p) === 0x02014b50) {
    assert(++entries <= 2000, 'XLSX 条目过多');
    const method = buffer.readUInt16LE(p + 10),
      size = buffer.readUInt32LE(p + 20),
      unpacked = buffer.readUInt32LE(p + 24),
      nl = buffer.readUInt16LE(p + 28),
      el = buffer.readUInt16LE(p + 30),
      cl = buffer.readUInt16LE(p + 32),
      offset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nl).toString();
    p += 46 + nl + el + cl;
    if (
      !/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(
        name,
      )
    )
      continue;
    expanded += unpacked;
    assert(expanded <= 24 * 1024 * 1024 && unpacked < 16 * 1024 * 1024, 'XLSX 解压后过大');
    assert(
      offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50,
      'XLSX 压缩结构损坏',
    );
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    assert(start + size <= buffer.length, 'XLSX 数据损坏');
    const data = buffer.subarray(start, start + size);
    assert(method === 0 || method === 8, '不支持此 XLSX 压缩格式');
    const content =
      method === 0
        ? data
        : inflateRawSync(data, { maxOutputLength: Math.min(16 * 1024 * 1024, unpacked + 1) });
    files.set(name, content.toString('utf8'));
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
export function readRows(buffer, filename, worksheet = '') {
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
