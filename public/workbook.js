// Shared by Node and WebView so worksheet choice has the same meaning on both.
function attribute(tag, name) {
  const escaped = name.replace(':', '\\:');
  const raw = new RegExp(`\\b${escaped}=["']([^"']*)["']`).exec(tag)?.[1] || '';
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
export function selectWorksheet(files, name = '') {
  if (typeof name !== 'string' || name.length > 160) throw new Error('工作表名称无效');
  const relationships = new Map();
  for (const tag of (files.get('xl/_rels/workbook.xml.rels') || '').matchAll(
    /<Relationship\b[^>]*\/?\s*>/g,
  )) {
    if (attribute(tag[0], 'TargetMode') === 'External') continue;
    const target = attribute(tag[0], 'Target');
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(path)) relationships.set(attribute(tag[0], 'Id'), path);
  }
  const sheets = [...(files.get('xl/workbook.xml') || '').matchAll(/<sheet\b[^>]*\/?\s*>/g)]
    .map(([tag]) => ({
      name: attribute(tag, 'name'),
      path: relationships.get(attribute(tag, 'r:id')),
    }))
    .filter((sheet) => files.has(sheet.path));
  if (sheets.length) {
    const selected = name ? sheets.find((sheet) => sheet.name === name) : sheets[0];
    if (!selected)
      throw new Error(`找不到工作表「${name}」，可选：${sheets.map((s) => s.name).join('、')}`);
    return files.get(selected.path);
  }
  if (name) throw new Error('无法读取工作表名称，请清空名称使用默认表，或将所需表另存为 CSV');
  return [...files]
    .filter(([path]) => path.startsWith('xl/worksheets/'))
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))[0]?.[1];
}
