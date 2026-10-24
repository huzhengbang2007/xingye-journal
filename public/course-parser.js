// Shared by the browser and server so an offline import has the same result.
const clean = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/\u200B/g, '')
    .trim();
const header = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/[\s()（）:：]/g, '');
const aliases = {
  title: ['课程名称', '课程名', '课程', '科目', 'course', 'title', 'name'],
  date: ['日期', '上课日期', '授课日期', 'date'],
  weekday: ['星期', '星期几', '周几', '上课星期', 'weekday', 'day'],
  start: ['开始时间', '上课时间', '起始时间', '开始', 'start', 'starttime'],
  end: ['结束时间', '下课时间', '结束', 'end', 'endtime'],
  range: ['时间', '时间段', '上课时段', '上课时间段', 'timerange'],
  weeks: ['周次', '教学周', '上课周次', '周数', 'weeks'],
  location: ['地点', '教室', '上课地点', '上课教室', 'location', 'room'],
  sections: ['节次', '节数', '上课节次', '课程节次', 'period', 'periods'],
};
const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
const englishDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function weekday(value) {
  const s = clean(value).toLowerCase().replace(/\s/g, '');
  if (/^[1-7]$/.test(s)) return Number(s);
  const chinese = /^(?:星期|周|礼拜)([一二三四五六日天1-7])$/.exec(s);
  if (chinese)
    return chinese[1] === '天' ? 7 : Number(chinese[1]) || weekdayNames.indexOf(chinese[1]) + 1;
  const english = englishDays.findIndex(
    (day, index) =>
      s === day ||
      s === ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][index],
  );
  return english >= 0 ? english + 1 : 0;
}
function normalizeTime(value, deps) {
  const s = clean(value).replace(/点/g, ':').replace(/分$/, '');
  // Excel time cells are fractions of a day. Integers are not guessed as hours.
  if (/^(?:0?\.\d+)$/.test(s)) {
    const minute = Math.round(Number(s) * 1440);
    deps.assert(minute >= 0 && minute < 1440, '时间无效');
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  }
  const match = /^(\d{1,2}):(\d{1,2})(?::00)?$/.exec(s);
  deps.assert(match, `无法识别时间「${s || '空白'}」，请填写 08:00 这样的实际时间`);
  return deps.time(`${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`);
}
function normalizeDate(value, deps) {
  let s = clean(value)
    .replace(/[年/.]/g, '-')
    .replace(/月/g, '-')
    .replace(/日$/, '');
  if (/^\d{5}(?:\.\d+)?$/.test(s))
    s = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000)
      .toISOString()
      .slice(0, 10);
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  return deps.date(
    match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : s,
  );
}
const rangePattern =
  /(?:\d{1,2}[:：]\d{1,2}(?::00)?)[ \t]*[-~～—–至到][ \t]*(?:\d{1,2}[:：]\d{1,2}(?::00)?)/g;
function timeRange(value, deps) {
  const matches = clean(value).match(rangePattern) || [];
  deps.assert(matches.length <= 1, '包含多组上课时间，请将不同课程拆成单独的行');
  if (!matches.length) return null;
  return matches[0].split(/\s*[-~～—–至到]\s*/).map((part) => normalizeTime(part, deps));
}
function weeks(value, deps) {
  const original = clean(value);
  const s = original
    .replace(/[，、;；]/g, ',')
    .replace(/[~～—–至到]/g, '-')
    .replace(/第|周|次|[\s()（）]/g, '');
  deps.assert(
    s && /^[\d,\-单双]+$/.test(s),
    '请填写周次，例如 1-16、1,3,5 或 1-16单周；也可在导入选项补充默认周次',
  );
  deps.assert(!(/单/.test(s) && /双/.test(s)), '同一周次不能同时标记单双周，请分成两行');
  const odd = /单/.test(s),
    even = /双/.test(s),
    selected = new Set();
  for (const part of s.replace(/[单双]/g, '').split(',')) {
    deps.assert(/^\d+(?:-\d+)?$/.test(part), `无法识别周次「${original}」`);
    const [a, last] = part.split('-').map(Number),
      b = last ?? a;
    deps.assert(a >= 1 && b <= 30 && a <= b, '周次需为 1–30');
    for (let w = a; w <= b; w++)
      if ((!odd || w % 2 === 1) && (!even || w % 2 === 0)) selected.add(w);
  }
  deps.assert(selected.size > 0, '周次筛选后没有课程，请核对单双周');
  return [...selected].sort((a, b) => a - b);
}
function sections(value, deps) {
  const s = clean(value)
    .replace(/[~～—–至到]/g, '-')
    .replace(/第|节|次|[\s()（）]/g, '');
  deps.assert(/^\d+(?:-\d+)?$/.test(s), '节次需为 1 或 1-2；请在导入选项填写各节的实际时间');
  const [a, last] = s.split('-').map(Number),
    b = last ?? a;
  deps.assert(a >= 1 && b <= 30 && a <= b, '节次需为 1–30');
  return [a, b];
}
function sectionMap(value, deps) {
  deps.assert(value === undefined || typeof value === 'string', '节次时间设置无效');
  const map = new Map();
  deps.assert((value || '').length <= 4000, '节次时间设置过长');
  for (const line of clean(value).split(/\n|;/).filter(Boolean)) {
    const match = /^(?:第)?(\d{1,2})(?:节)?\s*[=:：,，\s]\s*(.+)$/.exec(line.trim());
    deps.assert(match, `节次时间「${line}」无法识别，请按 1=08:00-08:45 填写，每节一行`);
    const n = Number(match[1]),
      range = timeRange(match[2], deps);
    deps.assert(n >= 1 && n <= 30 && range && range[1] > range[0], `第 ${n} 节的起止时间无效`);
    deps.assert(!map.has(n), `第 ${n} 节重复填写`);
    map.set(n, range);
  }
  return map;
}
function sectionRange(value, map, deps) {
  const [first, last] = sections(value, deps);
  for (let n = first; n <= last; n++) {
    deps.assert(
      map.has(n),
      `缺少第 ${n} 节的实际时间，请展开「按节次导入」补充，系统不会猜测上课时间`,
    );
    if (n > first)
      deps.assert(map.get(n)[0] >= map.get(n - 1)[1], `第 ${n} 节早于上一节结束，请核对实际作息`);
  }
  const range = [map.get(first)[0], map.get(last)[1]];
  deps.assert(range[1] > range[0], '节次时间顺序有误');
  return range;
}
const sectionLabel = (value) =>
  /(?:第)?(\d+(?:\s*[-~～—–至到]\s*\d+)?)\s*节/.exec(value)?.[1] ||
  /(?:^|\s)(\d+(?:\s*[-~～—–至到]\s*\d+)?)(?=$|\s)/.exec(value)?.[1] ||
  value;
function recurring(base, day, weekText, semesterStart, deps) {
  deps.assert(semesterStart, '请在本窗口填写学期第一周周一；按具体日期导入时可留空');
  deps.date(semesterStart);
  deps.assert(new Date(semesterStart).getUTCDay() === 1, '学期第一周起始日必须为周一');
  const wd = weekday(day);
  deps.assert(wd, `无法识别星期「${day}」，支持 1–7、周一、星期一或 Mon`);
  return weeks(weekText, deps).map((w) =>
    deps.event({ ...base, date: deps.addDays(semesterStart, (w - 1) * 7 + wd - 1) }),
  );
}
function context(message, action) {
  try {
    return action();
  } catch (error) {
    throw Object.assign(new Error(`${message}：${error.message}`), { status: 400 });
  }
}
function matrixCourse(value, deps) {
  const text = clean(value),
    lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const weekPattern =
    /(?:第\s*)?\d+(?:\s*[-~～—–至到]\s*\d+)?(?:\s*[,，、]\s*\d+(?:\s*[-~～—–至到]\s*\d+)?)*\s*(?:[单双]周|周(?:\s*[（(]?[单双][）)]?)?)/g;
  const matches = text.match(weekPattern) || [];
  const labelledWeeks = lines.find((s) => /^(?:周次|教学周)\s*[:：]/.test(s));
  deps.assert(matches.length <= 1, '此格包含多组周次，请将不同课程拆成单独的行后导入');
  const weekText = labelledWeeks ? labelledWeeks.replace(/^[^:：]+[:：]\s*/, '') : matches[0] || '';
  const location =
    lines.find((s) => /^(?:地点|教室|上课地点)\s*[:：]/.test(s))?.replace(/^[^:：]+[:：]\s*/, '') ||
    '';
  const title = lines.find(
    (s) =>
      !/^(?:周次|教学周|地点|教室|教师|老师|上课地点)\s*[:：]/.test(s) &&
      s !== matches[0] &&
      !timeRange(s, deps),
  );
  deps.assert(title, '未识别到课程名称，请将课程名称放在单元格首行');
  return {
    title: title.replace(/^(?:课程名称|课程)\s*[:：]\s*/, ''),
    location,
    weekText,
    range: timeRange(text, deps),
  };
}
export function parseCourses(rows, semesterStart, options = {}, deps) {
  deps.assert(Array.isArray(rows) && rows.length <= 10000, '课表为空或超过 10000 行');
  deps.assert(options && typeof options === 'object' && !Array.isArray(options), '导入选项无效');
  deps.assert(
    options.defaultWeeks === undefined || typeof options.defaultWeeks === 'string',
    '默认周次无效',
  );
  const map = sectionMap(options.sectionTimes, deps),
    result = [];
  const hi = rows.findIndex((r) => {
    const headers = r.map(header);
    return (
      headers.some((h) => aliases.title.includes(h)) &&
      headers.some((h) => [...aliases.date, ...aliases.weekday].includes(h))
    );
  });
  if (hi >= 0) {
    const headers = rows[hi].map(header);
    const columns = Object.fromEntries(
      Object.entries(aliases).map(([key, names]) => [
        key,
        headers.findIndex((h) => names.includes(h)),
      ]),
    );
    const get = (row, key) => clean(row[columns[key]]);
    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i] || [],
        title = get(row, 'title');
      if (!title) continue;
      context(`第 ${i + 1} 行「${title.slice(0, 40)}」`, () => {
        let range;
        if (get(row, 'start') && get(row, 'end'))
          range = [normalizeTime(get(row, 'start'), deps), normalizeTime(get(row, 'end'), deps)];
        else range = timeRange(get(row, 'range') || get(row, 'start'), deps);
        if (!range && get(row, 'sections')) range = sectionRange(get(row, 'sections'), map, deps);
        deps.assert(
          range,
          '缺少实际起止时间；可填写开始/结束时间，或填写节次并在导入选项补充节次时间',
        );
        const base = {
          title,
          start: range[0],
          end: range[1],
          location: get(row, 'location'),
          kind: 'course',
        };
        result.push(
          ...(get(row, 'date')
            ? [deps.event({ ...base, date: normalizeDate(get(row, 'date'), deps) })]
            : recurring(
                base,
                get(row, 'weekday'),
                get(row, 'weeks') || options.defaultWeeks,
                semesterStart,
                deps,
              )),
        );
      });
      deps.assert(result.length <= 10000, '课程超过 10000 条，请按学期拆分导入');
    }
  } else {
    const mi = rows.findIndex((row) => new Set(row.map(weekday).filter(Boolean)).size >= 2);
    deps.assert(
      mi >= 0,
      '未找到课表表头。可直接粘贴 Excel 表格，列表需含「课程/科目」及「日期/星期」，矩阵需有周一、周二等列；图片和 PDF 需先转为表格',
    );
    const days = rows[mi].map(weekday),
      firstDay = days.findIndex(Boolean);
    deps.assert(firstDay > 0, '矩阵课表需在星期列左侧提供上课时间或节次');
    for (let i = mi + 1; i < rows.length; i++) {
      const row = rows[i] || [],
        label = row.slice(0, firstDay).map(clean).filter(Boolean).join(' ');
      for (let col = firstDay; col < days.length; col++) {
        if (!days[col] || !clean(row[col])) continue;
        context(`第 ${i + 1} 行，周${weekdayNames[days[col] - 1]}`, () => {
          const course = matrixCourse(row[col], deps);
          const merged = (rows.mergeRanges || []).find(
            (m) => m.startRow === i && m.startCol === col,
          );
          deps.assert(
            !merged || merged.endCol === col,
            '课程横跨多个星期的合并单元格，请取消横向合并后导入',
          );
          let range = course.range || timeRange(label, deps);
          if (!course.range && merged && merged.endRow > i) {
            const endLabel = (rows[merged.endRow] || [])
              .slice(0, firstDay)
              .map(clean)
              .filter(Boolean)
              .join(' ');
            const ending = timeRange(endLabel, deps);
            if (range && ending) range = [range[0], ending[1]];
            else {
              const first = sectionLabel(label);
              const last = sectionLabel(endLabel);
              range = sectionRange(
                `${sections(first, deps)[0]}-${sections(last, deps)[1]}`,
                map,
                deps,
              );
            }
          }
          if (!range) range = sectionRange(sectionLabel(label), map, deps);
          result.push(
            ...recurring(
              {
                title: course.title,
                location: course.location,
                start: range[0],
                end: range[1],
                kind: 'course',
              },
              days[col],
              course.weekText || options.defaultWeeks,
              semesterStart,
              deps,
            ),
          );
        });
      }
      deps.assert(result.length <= 10000, '课程超过 10000 条，请按学期拆分导入');
    }
  }
  deps.assert(result.length > 0, '没有可导入课程，请检查表格是否包含课程名称和有效行');
  return result;
}
