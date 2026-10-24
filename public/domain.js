import { sha256 } from './sha256.js';
export const id = () => crypto.randomUUID();
export const hash = sha256;
export function assert(ok, message, status = 400) {
  if (!ok) throw Object.assign(new Error(message), { status });
}
export function text(s, max = 200) {
  assert(typeof s === 'string' && s.trim().length > 0 && s.length <= max, `请输入 1–${max} 个字符`);
  return s.trim();
}
export function date(s) {
  assert(
    typeof s === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    '日期无效',
  );
  return s;
}
export function time(s) {
  assert(typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s), '时间无效');
  return s;
}
export const minutes = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export const clock = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const chinaDay = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function addDays(day, n) {
  return new Date(Date.parse(date(day)) + n * 86400000).toISOString().slice(0, 10);
}
export const initialState = () => ({
  vaultId: id(),
  events: [],
  transactions: [],
  reports: {},
  settings: {
    name: '同学',
    model: 'deepseek-flash',
    apiKey: '',
    budget: 2000,
    semesterStart: '',
    dayStart: '08:00',
    dayEnd: '22:00',
  },
});
export function event(input) {
  const e = {
    id: id(),
    title: text(input.title, 120),
    date: date(input.date),
    start: time(input.start),
    end: time(input.end),
    kind: ['study', 'life', 'work', 'course'].includes(input.kind) ? input.kind : 'study',
    location: String(input.location || '').slice(0, 120),
    done: Boolean(input.done),
    reminder: input.reminder === undefined ? 10 : Number(input.reminder),
    alarm: Boolean(input.alarm),
  };
  assert([-1, 0, 5, 10, 15, 30, 60].includes(e.reminder), '提醒时间无效');
  assert(minutes(e.end) > minutes(e.start), '结束时间必须晚于开始时间');
  return e;
}
export const overlaps = (a, b) => a.date === b.date && a.start < b.end && b.start < a.end;
export function validatePlan(rows, existing) {
  assert(Array.isArray(rows) && rows.length > 0 && rows.length <= 80, '规划为空或数量过多');
  const result = [];
  for (const row of rows) {
    const e = event({ ...row, done: false });
    assert(e.date >= chinaDay() && e.date <= addDays(chinaDay(), 90), '建议必须位于未来 90 天内');
    assert(
      ![...existing, ...result].some((x) => overlaps(e, x)),
      `「${e.title}」与现有安排冲突，请重新规划`,
    );
    result.push(e);
  }
  return result;
}
export function localPlan(goal, existing, settings, days = 7, duration = 60) {
  text(goal, 2000);
  assert(
    Number.isInteger(days) && days >= 1 && days <= 30 && [25, 45, 60, 90, 120].includes(duration),
    '规划范围无效',
  );
  const results = [];
  const now = new Date();
  const chinaMinute = minutes(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  for (let n = 0; n < days; n++) {
    const day = addDays(chinaDay(), n);
    for (let m = minutes(settings.dayStart); m + duration <= minutes(settings.dayEnd); m += 30) {
      if (n === 0 && m <= chinaMinute) continue;
      const e = event({
        title: goal.slice(0, 100),
        date: day,
        start: clock(m),
        end: clock(m + duration),
        kind: 'study',
      });
      if (!existing.some((x) => overlaps(e, x))) {
        results.push(e);
        break;
      }
    }
  }
  return results;
}
export function transaction(input) {
  const amount = Math.round(Number(input.amount) * 100);
  assert(
    Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000,
    '金额需在 0.01–1,000,000 元之间',
  );
  assert(['expense', 'income', 'refund', 'transfer'].includes(input.direction), '收支类型无效');
  return {
    id: id(),
    date: date(input.date),
    amount,
    direction: input.direction,
    category: text(input.category || '其他', 30),
    merchant: text(input.merchant || '手动记账', 160),
    source: 'manual',
    fingerprint: id(),
  };
}
export function monthly(state, month) {
  assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), '月份无效');
  const tx = state.transactions.filter((t) => t.date.startsWith(month));
  const ev = state.events.filter((e) => e.date.startsWith(month));
  const sum = (type) => tx.filter((t) => t.direction === type).reduce((n, t) => n + t.amount, 0);
  const categories = Object.create(null);
  tx.forEach((t) => {
    if (t.direction === 'expense')
      categories[t.category] = (categories[t.category] || 0) + t.amount;
  });
  return {
    month,
    income: sum('income'),
    expense: sum('expense'),
    refund: sum('refund'),
    netExpense: sum('expense') - sum('refund'),
    count: tx.length,
    events: ev.length,
    completed: ev.filter((e) => e.done).length,
    studyMinutes: ev
      .filter((e) => e.done && ['study', 'course'].includes(e.kind))
      .reduce((n, e) => n + minutes(e.end) - minutes(e.start), 0),
    categories,
    generatedAt: new Date().toISOString(),
  };
}
export function previousMonth(day = chinaDay()) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
export function autoReports(state) {
  const months = new Set([
    ...state.events.map((e) => e.date.slice(0, 7)),
    ...state.transactions.map((t) => t.date.slice(0, 7)),
    previousMonth(),
  ]);
  let changed = false;
  for (const m of months)
    if (m < chinaDay().slice(0, 7) && !state.reports[m]) {
      state.reports[m] = monthly(state, m);
      changed = true;
    }
  return changed;
}
