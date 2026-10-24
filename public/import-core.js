import { parseCourses } from './course-parser.js';
export const xmlText = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export function createImportCore({ assert, hash, id, date, time, event, addDays }) {
  function csvRows(raw, delimiter) {
    raw = String(raw).replace(/^\uFEFF/, '');
    // Clipboard tables use tabs; exports may use semicolons instead of commas.
    if (!delimiter) {
      const counts = [',', '\t', ';'].map((separator) => {
        let maximum = 0,
          count = 0,
          quoted = false,
          lines = 0;
        for (let i = 0; i < raw.length && lines < 30; i++) {
          if (raw[i] === '"') {
            if (quoted && raw[i + 1] === '"') i++;
            else quoted = !quoted;
          } else if (raw[i] === separator && !quoted) count++;
          else if (raw[i] === '\n' && !quoted) {
            maximum = Math.max(maximum, count);
            count = 0;
            lines++;
          }
        }
        return Math.max(maximum, count);
      });
      delimiter = [',', '\t', ';'][counts.indexOf(Math.max(...counts))];
    }
    assert([',', '\t', ';'].includes(delimiter), '不支持此表格分隔符');
    const rows = [];
    let row = [],
      cell = '',
      quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') {
        if (quoted && raw[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (quoted || !cell.trim()) quoted = !quoted;
        else cell += c;
      } else if (c === delimiter && !quoted) {
        row.push(cell.trim());
        cell = '';
      } else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && raw[i + 1] === '\n') i++;
        row.push(cell.trim());
        if (row.some(Boolean)) rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    assert(!quoted, 'CSV 引号未闭合');
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  const clean = (s) =>
    String(s || '')
      .replace(/^\uFEFF|[\t\u200B]/g, '')
      .trim();
  const category = (s) =>
    /食|餐|饭|咖啡|茶|美团|饿了么/.test(s)
      ? '餐饮'
      : /地铁|公交|打车|滴滴|车票|铁路/.test(s)
        ? '交通'
        : /超市|购物|淘宝|京东|拼多多/.test(s)
          ? '购物'
          : /书|课程|学费|打印/.test(s)
            ? '学习'
            : /电影|游戏|音乐|视频/.test(s)
              ? '娱乐'
              : '其他';
  function billImport(rows, source, existing = []) {
    assert(['wechat', 'alipay'].includes(source), '请选择账单来源');
    const index = rows.findIndex(
      (r) =>
        r.some((c) => /交易时间|交易创建时间/.test(c)) &&
        r.some((c) => /金额/.test(c)) &&
        r.some((c) => /收.?支/.test(c)),
    );
    assert(index >= 0, '未找到微信/支付宝账单表头，请导出用于个人对账的明细');
    const headers = rows[index].map(clean);
    const col = (re) => headers.findIndex((h) => re.test(h));
    const ti = col(/交易时间|交易创建时间/),
      ai = col(/金额/),
      di = col(/收.?支/),
      mi = col(/交易对方/),
      pi = col(/商品|商品说明/),
      si = col(/当前状态|交易状态/),
      oi = col(/^交易单号$|^交易号$|^交易订单号$/),
      ci = col(/交易分类|交易类型/);
    const fingerprints = new Set(existing.map((t) => t.fingerprint));
    const imported = [],
      invalidRows = [];
    let duplicates = 0,
      ignored = 0,
      invalid = 0;
    for (let rowIndex = index + 1; rowIndex < rows.length; rowIndex++) {
      const r = rows[rowIndex];
      if (!r.some(Boolean) || /^[-=]/.test(clean(r[0]))) continue;
      const get = (i) => clean(r[i]);
      const status = get(si),
        desc = get(di),
        type = get(ci),
        merchant = get(mi) || get(pi) || '未注明交易方';
      if (/关闭|失败|撤销|待付款|未支付/.test(status)) {
        ignored++;
        continue;
      }
      let direction = /支出/.test(desc) ? 'expense' : /收入/.test(desc) ? 'income' : 'transfer';
      // Keep expense and refund legs separately. A status is not a refund amount.
      const refundRow =
        /退款|退货/.test(type + desc) || (direction !== 'expense' && /退款|退货/.test(get(pi)));
      if (refundRow) direction = 'refund';
      const rawAmount = get(ai).replace(/[¥￥,\s]/g, '');
      const amount = Math.round(Math.abs(Number(rawAmount)) * 100);
      let day = get(ti).slice(0, 10).replace(/\//g, '-');
      try {
        if (/^\d+(\.\d+)?$/.test(get(ti)))
          day = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(get(ti))) * 86400000)
            .toISOString()
            .slice(0, 10);
        date(day);
        assert(
          rawAmount !== '' && Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000,
          '金额无效',
        );
      } catch (error) {
        invalid++;
        if (invalidRows.length < 60)
          invalidRows.push({
            row: rowIndex + 1,
            reason: error instanceof RangeError ? '日期超出有效范围' : error.message,
          });
        continue;
      }
      const order = get(oi);
      const fingerprint = hash(
        [source, order || [get(ti), merchant, amount, get(pi)].join('|'), direction].join('|'),
      );
      if (fingerprints.has(fingerprint)) {
        duplicates++;
        continue;
      }
      fingerprints.add(fingerprint);
      imported.push({
        id: id(),
        date: day,
        amount,
        direction,
        merchant: merchant.slice(0, 160),
        category: direction === 'transfer' ? '转账/不计收支' : category(type + merchant + get(pi)),
        source,
        fingerprint,
      });
    }
    const refundStatuses = rows.slice(index + 1).filter((r) => /退款/.test(clean(r[si]))).length;
    assert(imported.length <= 30000, '每次最多导入 30000 笔');
    return {
      items: imported,
      duplicates,
      ignored,
      invalid,
      invalidRows,
      refundStatuses,
      notes: `转账和不计收支单列；原支出保留，独立退款明细抵扣。${refundStatuses ? `检测到 ${refundStatuses} 条退款状态，请核对是否另有退款明细；若没有，请手动补记实际退款金额。` : ''}不根据状态文字猜测退款金额。跨平台的同一笔交易需人工核对。`,
    };
  }
  function icsStamp(v) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
    assert(m, '暂不支持全天课程，请使用带起止时间的 ICS');
    let day = date(`${m[1]}-${m[2]}-${m[3]}`),
      tm = time(`${m[4]}:${m[5]}`);
    if (m[7]) {
      const local = new Date(`${day}T${tm}:00Z`);
      local.setUTCHours(local.getUTCHours() + 8);
      day = local.toISOString().slice(0, 10);
      tm = local.toISOString().slice(11, 16);
    }
    return { day, tm };
  }
  const unescapeICS = (s) => (s || '').replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1');
  function icsImport(raw) {
    const lines = raw.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    assert(lines.includes('BEGIN:VCALENDAR'), '不是有效 ICS 日历');
    let cur;
    const result = [];
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') {
        cur = {};
        continue;
      }
      if (!cur) continue;
      if (line === 'END:VEVENT') {
        assert(
          !cur.RDATE && !cur['RECURRENCE-ID'],
          '暂不支持特殊补课规则，请导出单次事件或使用 CSV',
        );
        const start = icsStamp(cur.DTSTART || ''),
          end = icsStamp(cur.DTEND || '');
        assert(start.day === end.day, '暂不支持跨天课程');
        const base = {
          title: unescapeICS(cur.SUMMARY) || '课程',
          date: start.day,
          start: start.tm,
          end: end.tm,
          location: unescapeICS(cur.LOCATION),
          kind: 'course',
        };
        const excluded = new Set(
          (cur.EXDATE || '')
            .split(',')
            .filter(Boolean)
            .map((x) => icsStamp(x).day),
        );
        if (!cur.RRULE) {
          if (!excluded.has(base.date)) result.push(event(base));
        } else {
          const rule = Object.fromEntries(cur.RRULE.split(';').map((s) => s.split('=')));
          assert(
            rule.FREQ === 'WEEKLY' &&
              Object.keys(rule).every((k) =>
                ['FREQ', 'COUNT', 'UNTIL', 'INTERVAL', 'BYDAY', 'WKST'].includes(k),
              ),
            '只支持每周重复课表，请展开其他重复规则后导入',
          );
          const weekDays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
          const days = rule.BYDAY
            ? rule.BYDAY.split(',').map((d) => weekDays.indexOf(d))
            : [new Date(base.date).getUTCDay()];
          assert(
            days.every((d) => d >= 0),
            '重复星期无效',
          );
          const count = rule.COUNT ? Number(rule.COUNT) : 1000,
            interval = Number(rule.INTERVAL || 1);
          assert(
            (rule.COUNT || rule.UNTIL) &&
              Number.isInteger(count) &&
              count > 0 &&
              count <= 1000 &&
              Number.isInteger(interval) &&
              interval > 0 &&
              interval <= 52,
            '重复课程需要截止日期或次数（最多 1000 次）',
          );
          const until = rule.UNTIL
            ? /^\d{8}$/.test(rule.UNTIL)
              ? `${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}`
              : icsStamp(rule.UNTIL).day
            : addDays(base.date, 731);
          assert(until <= addDays(base.date, 731), '课表跨度不得超过两年');
          let occurrences = 0;
          const startWeekday = (new Date(base.date).getUTCDay() + 6) % 7;
          for (let n = 0; n <= 731 && occurrences < count; n++) {
            const day = addDays(base.date, n);
            if (day > until) break;
            if (
              Math.floor((n + startWeekday) / 7) % interval === 0 &&
              days.includes(new Date(day).getUTCDay())
            ) {
              occurrences++;
              if (!excluded.has(day)) result.push(event({ ...base, date: day }));
            }
          }
        }
        cur = null;
        assert(result.length <= 10000, '课程数量过多');
        continue;
      }
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const full = line.slice(0, colon),
        key = full.split(';')[0];
      const tz = /TZID=([^;]+)/.exec(full)?.[1];
      assert(
        !tz || ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Hong_Kong'].includes(tz),
        '仅支持北京时间或 UTC 课表',
      );
      cur[key] =
        key === 'EXDATE' && cur[key]
          ? cur[key] + ',' + line.slice(colon + 1)
          : line.slice(colon + 1);
    }
    assert(result.length > 0, '文件中没有可导入课程');
    return result;
  }
  function courseImport(rows, semesterStart, options = {}) {
    return parseCourses(rows, semesterStart, options, { assert, date, time, event, addDays });
  }
  const courseFingerprint = (e) => hash([e.title, e.date, e.start, e.end, e.location].join('|'));

  return { csvRows, billImport, icsImport, courseImport, courseFingerprint };
}
