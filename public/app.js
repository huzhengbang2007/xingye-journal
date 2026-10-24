import { createDeviceLink } from './device-link.js';
import { mapSearch, placeQuery } from './places.js';
import { createOfflineRuntime } from './offline.js';
import { calendarFeed } from './calendar.js';
import { createDiary } from './diary.js';
import { createCollaboration } from './collaboration.js';
import { createFormDrafts } from './drafts.js';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
  wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7m0 6h-5v4h5m-3-2h.1"/>',
  chart: '<path d="M4 3v17h17M8 15v-3m5 3V7m5 8v-5"/>',
  settings:
    '<path d="m9 3-.6 2.1-2 .9-2.1-.5-2 3.5 1.5 1.6v2.3L2.3 15l2 3.5 2.1-.5 2 .9L9 21h4l.6-2.1 2-.9 2.1.5 2-3.5-1.5-1.6v-2.3L19.7 9l-2-3.5-2.1.5-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  book: '<path d="M12 5v16M3 4c4-1 6 0 9 1 3-1 5-2 9-1v15c-4-1-6 0-9 2-3-2-5-3-9-2V4Z"/>',
  laptop: '<rect x="5" y="3" width="14" height="12" rx="1"/><path d="m5 15-3 5h20l-3-5"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4m-4-13h4"/>',
  tablet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M10 18h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  flower: '<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.calendar}</svg>`;
function paintIcons() {
  $$('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const addDay = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
const weekday = (s) =>
  ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(s).getUTCDay()];
const prettyDate = (s) => `${Number(s.slice(5, 7))}月${Number(s.slice(8))}日`;
const money = (cents) =>
  new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cents / 100,
  );
const kinds = { study: '专注学习', course: '大学课表', work: '工作事务', life: '生活安排' };
const directions = { expense: '支出', income: '收入', refund: '退款', transfer: '不计收支' };
const sources = { wechat: '微信', alipay: '支付宝', manual: '手动记录' };
const offline =
  location.hostname === 'appassets.androidplatform.net' ? createOfflineRuntime() : null;
let refreshFlight = null,
  eventsByDate = new Map(),
  summaryCache = new Map();
let state,
  csrf,
  sessionInfo,
  page = new URLSearchParams(location.search).get('view') === 'courses' ? 'calendar' : 'dashboard',
  selectedDay = today(),
  calendarMonth = today().slice(0, 7),
  ledgerMonth = today().slice(0, 7),
  reportMonth = today().slice(0, 7),
  plan = null,
  ledgerPage = 0,
  toastTimer,
  initialized = false,
  authGeneration = 0;
const diary = createDiary({
  api,
  esc,
  toast,
  today,
  storageLabel: () => (offline ? '已加密保存 · 仅在此设备' : '已加密保存 · 已协同到服务器'),
});
const drafts = createFormDrafts({
  changed: paintDrafts,
  failed: (message) => toast(message, true),
});
function paintDrafts() {
  const existingButton = document.querySelector('#form-drafts');
  if (!state || !drafts.list().length) {
    existingButton?.remove();
    return;
  }
  if (existingButton) {
    existingButton.textContent = `未保存编辑（${drafts.list().length}）`;
    return;
  }
  const button = document.createElement('button');
  button.id = 'form-drafts';
  button.className = 'button small';
  button.textContent = `未保存编辑（${drafts.list().length}）`;
  button.onclick = () => {
    openModal(
      '恢复未保存编辑',
      '<p class="help-text">草稿只保留在当前标签页，关闭标签页可能丢失。密码和 API 密钥不进入草稿。</p><div id="draft-list"></div>',
    );
    for (const draft of drafts.list()) {
      const row = document.createElement('div');
      const restore = document.createElement('button');
      restore.className = 'button';
      restore.textContent = `${draft.kind === 'event' ? '日程' : draft.kind === 'transaction' ? '账单' : '设置'} · ${new Date(draft.updatedAt).toLocaleString('zh-CN')}`;
      restore.onclick = () => {
        closeModal();
        const existing =
          draft.kind === 'event'
            ? state.events.find((x) => x.id === draft.id)
            : state.transactions.find((x) => x.id === draft.id);
        if (draft.id && !existing) {
          if (!confirm('原记录已删除。将草稿恢复为新记录供你核对？保存后才会新增。')) return;
        }
        if (draft.kind === 'settings') navigate('settings');
        else if (draft.kind === 'event') eventModal(existing);
        else transactionModal(existing);
        const form = document.querySelector(
          draft.kind === 'settings'
            ? '#settings-form'
            : draft.kind === 'event'
              ? '#event-form'
              : '#transaction-form',
        );
        for (const [name, value] of Object.entries(draft.values)) {
          const field = form.elements.namedItem(name);
          if (!field || field.type === 'password') continue;
          if (field.type === 'checkbox') field.checked = value;
          else {
            if (field.tagName === 'SELECT' && ![...field.options].some((x) => x.value === value))
              field.add(new Option(value, value));
            field.value = value;
          }
        }
        form.dispatchEvent(new Event('input', { bubbles: true }));
        if (draft.id && !existing) drafts.remove(draft.token);
        toast('草稿已恢复，请核对当前记录后保存；尚未写入数据。');
      };
      const discard = document.createElement('button');
      discard.className = 'button small';
      discard.textContent = '丢弃';
      discard.onclick = () => {
        if (confirm('丢弃这份未保存编辑？')) {
          drafts.remove(draft.token);
          row.remove();
        }
      };
      row.append(restore, discard);
      $('#draft-list').append(row);
    }
  };
  $('.topbar').append(button);
}
async function showEditConflict(error, form, target) {
  if (!target) return;
  target.textContent = error.message;
  if (error.status !== 409) return;
  try {
    const latest = await api('state');
    const current =
      form.id === 'settings-form'
        ? latest.settings
        : (form.id === 'event-form' ? latest.events : latest.transactions).find(
            (x) => x.id === form.dataset.recordId,
          );
    const differences = Object.entries(Object.fromEntries(new FormData(form)))
      .filter(
        ([name, value]) =>
          current &&
          name in current &&
          name !== 'apiKey' &&
          String(current[name]) !==
            String(name === 'amount' ? Math.round(Number(value) * 100) : value),
      )
      .map(
        ([name]) =>
          `${form.elements.namedItem(name)?.closest('label')?.childNodes[0]?.textContent?.trim() || name}：当前保存值 ${String(current[name])}`,
      );
    target.textContent += current
      ? `。你的输入已保留。${differences.join('；')}。关闭后合并更新，再从「未保存编辑」恢复并核对。`
      : '。原记录已删除，你的草稿已保留。';
  } catch {
    target.textContent += '。你的输入已保留，请恢复连接后再核对。';
  }
}
const collaboration = createCollaboration({
  api,
  esc,
  toast,
  getState: () => state,
  isOffline: () => Boolean(offline),
  receive: () => refresh(true),
  locked: showAuth,
  canRefresh: () =>
    !$('#modal').open &&
    page !== 'diary' &&
    !$('#content input:focus, #content textarea:focus, #content select:focus') &&
    !$('#content form[data-dirty=true]'),
});
const deviceLink = createDeviceLink({
  api,
  offline,
  getState: () => state,
  getGeneration: () => authGeneration,
  refresh,
  esc,
  toast,
  openModal,
  canSync: () =>
    !$('#modal').open &&
    !diary.isUnlocked() &&
    !$('#content form[data-dirty=true]') &&
    !$('#content input:focus, #content textarea:focus, #content select:focus'),
});
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 4500);
}
async function api(path, data) {
  if (offline) {
    try {
      const result = await offline.api(path, data);
      if (data !== undefined && !['lock', 'unlock', 'setup'].includes(path))
        deviceLink.schedule(true);
      return result;
    } catch (error) {
      if (error.status === 401 && !['setup', 'unlock'].includes(path)) showAuth();
      throw error;
    }
  }
  const res = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers:
      data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: 'no-store',
    signal: AbortSignal.timeout(
      ['plan', 'report', 'automations/action'].includes(path) ? 75000 : 15000,
    ),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('服务连接异常，请确认电脑上的星野记仍在运行');
  }
  if (!res.ok) {
    if (res.status === 401 && !['unlock', 'setup'].includes(path)) showAuth();
    throw Object.assign(new Error(json.error || '操作未成功'), { status: res.status });
  }
  return json;
}
function showAuth() {
  drafts.lock();
  collaboration.stop();
  diary.lock();
  authGeneration++;
  refreshFlight = null;
  eventsByDate.clear();
  summaryCache.clear();
  state = null;
  csrf = null;
  plan = null;
  $('#content').innerHTML = '';
  $('#modal').close();
  $('#modal-body').innerHTML = '';
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#password').value = '';
  $('#confirm-password').value = '';
  $('#auth-title').textContent = initialized ? '欢迎回到你的空间' : '欢迎来到星野记';
  $('#auth-description').textContent = initialized
    ? '输入主密码，继续安排属于你的每一天。'
    : '设置一个主密码，创建只属于你的加密空间。';
  $('#confirm-label').hidden = initialized;
  $('#confirm-password').required = !initialized;
  $('#password').autocomplete = initialized ? 'current-password' : 'new-password';
  $('#auth-submit').disabled = false;
  $('#auth-submit').innerHTML = initialized
    ? '解锁我的空间 <span>↗</span>'
    : '创建我的空间 <span>↗</span>';
}
function indexState() {
  eventsByDate = new Map();
  summaryCache.clear();
  for (const e of state.events) {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date).push(e);
  }
  for (const rows of eventsByDate.values()) rows.sort((a, b) => a.start.localeCompare(b.start));
}
const dayEvents = (day) => eventsByDate.get(day) || [];
async function refresh(passive = false) {
  if (refreshFlight) return refreshFlight;
  const generation = authGeneration;
  const work = (async () => {
    const next = await api(passive ? 'state?passive=1' : 'state');
    if (generation !== authGeneration) return;
    state = next;
    indexState();
    $('#profile-name').textContent = state.settings.name + '的空间';
    $$('.avatar').forEach((el) => (el.textContent = state.settings.name.slice(0, 1)));
    render();
    collaboration.start();
    collaboration.acknowledge();
    deviceLink.start();
    collaboration.syncNative();
  })();
  refreshFlight = work;
  try {
    return await work;
  } finally {
    if (refreshFlight === work) refreshFlight = null;
  }
}
function navigate(next) {
  if (!state) return;
  if (page === 'diary' && next !== 'diary') {
    if (!diary.canLeave()) return;
    diary.lock();
  }
  const order = [
    'dashboard',
    'calendar',
    'planner',
    'automations',
    'ledger',
    'diary',
    'reports',
    'settings',
  ];
  const slide = order.indexOf(next) >= order.indexOf(page) ? 22 : -22;
  page = next;
  render();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    $('#content').animate(
      [
        { opacity: 0, transform: `translateX(${slide}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 260, easing: 'ease-out' },
    );
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function render() {
  if (!state) return;
  const labels = {
    automations: '自动任务',
    dashboard: '生活概览',
    calendar: '日程与课表',
    planner: 'AI 规划师',
    ledger: '生活账本',
    reports: '月度复盘',
    diary: '星野手记',
    settings: '设置与安全',
  };
  $('#page-name').textContent = labels[page];
  document.title = `${labels[page]} · 星野记`;
  $$('[data-nav]').forEach(
    (el) => (
      el.classList.toggle('active', el.dataset.nav === page),
      el.dataset.nav === page
        ? el.setAttribute('aria-current', 'page')
        : el.removeAttribute('aria-current')
    ),
  );
  $('#content').innerHTML = {
    automations,
    dashboard,
    calendar,
    planner,
    ledger,
    reports,
    settings,
    diary: diary.markup,
  }[page]();
  paintIcons();
  bindPage();
  bindDaily();
  paintDrafts();
  if (page === 'settings') drafts.bind($('#settings-form'), { kind: 'settings' });
}
const heading = (label, title, description, action = '') =>
  `<div class="page-header"><div><span class="eyebrow">${label}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
const empty = (title, description, action = '', name = 'calendar') =>
  `<div class="empty"><span class="empty-icon">${icon(name)}</span><strong>${title}</strong>${description}${action}</div>`;
function summary(month) {
  if (summaryCache.has(month)) return summaryCache.get(month);
  const tx = state.transactions.filter((t) => t.date.startsWith(month)),
    ev = state.events.filter((e) => e.date.startsWith(month));
  const sum = (d) => tx.filter((t) => t.direction === d).reduce((n, t) => n + t.amount, 0);
  const categories = Object.create(null);
  tx.forEach((t) => {
    if (t.direction === 'expense')
      categories[t.category] = (categories[t.category] || 0) + t.amount;
  });
  const result = {
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
      .reduce(
        (n, e) =>
          n +
          (Number(e.end.slice(0, 2)) - Number(e.start.slice(0, 2))) * 60 +
          Number(e.end.slice(3)) -
          Number(e.start.slice(3)),
        0,
      ),
    categories,
  };
  summaryCache.set(month, result);
  return result;
}
const stat = (label, value, unit, foot, name) =>
  `<div class="stat"><div class="stat-label">${label}${icon(name)}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-foot">${foot}</div></div>`;
function agenda(e) {
  return `<div class="agenda-item"><div class="event-time">${e.start}<small>${e.end}</small></div><span class="event-mark ${esc(e.kind)}"></span><div class="event-info ${e.done ? 'done' : ''}"><strong>${esc(e.title)}</strong><small>${esc(e.location || kinds[e.kind])}</small></div><button class="event-done ${e.done ? 'checked' : ''}" data-done="${esc(e.id)}" aria-label="${e.done ? '取消完成' : '标记完成'}：${esc(e.title)}">${e.done ? '✓' : ''}</button><button class="edit-event" data-edit="${esc(e.id)}" aria-label="编辑日程">⋯</button></div>`;
}
function categoriesHTML(s) {
  const entries = Object.entries(s.categories).sort((a, b) => b[1] - a[1]);
  return entries.length
    ? `<div class="category-list">${entries
        .slice(0, 4)
        .map(
          ([name, amount]) =>
            `<div class="category-row"><span class="category-dot"></span><span>${esc(name)}</span><span>¥ ${money(amount)}</span></div>`,
        )
        .join('')}</div>`
    : '<p class="help-text section-space">导入第一份账单，看看生活的小开销。</p>';
}
function dashboard() {
  const day = today(),
    month = day.slice(0, 7),
    s = summary(month),
    ev = dayEvents(day),
    done = ev.filter((e) => e.done).length;
  const weekStart = addDay(selectedDay, -((new Date(selectedDay).getUTCDay() + 6) % 7));
  const dateParts = day.split('-');
  const remaining = ev.filter((e) => !e.done).length;
  const hours = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  const greeting = hours < 11 ? '早上好' : hours < 14 ? '中午好' : hours < 18 ? '下午好' : '晚上好';
  return (
    heading(
      'COLLECT MOMENTS. CONNECT YOUR STARS.',
      `${greeting}，${esc(state.settings.name)} <span class="muted">☀</span>`,
      '生活有很多可能，今天也从容一点。',
      `<div class="date-tag">${icon('calendar')}${dateParts[0]}年${Number(dateParts[1])}月${Number(dateParts[2])}日 · ${weekday(day)}</div>`,
    ) +
    `<section class="hero"><div><span class="eyebrow">XINGYE JOURNAL / A SMALL UNIVERSE OF YOUR OWN</span><h2><span>把日常连成星图，</span><span>下一站，自由生长。</span></h2><p>${remaining ? `今天还有 ${remaining} 项安排。留一点余地，按照自己的节奏来。` : '从一个小小的计划开始，让日程、学习与生活慢慢井然有序。'}</p><button class="button" data-nav="planner">${icon('spark')}和 AI 一起安排未来 ${icon('arrow')}</button></div><div class="hero-art star-mascot" aria-hidden="true"><img src="/constellation.svg" alt=""><small>YOUR DAYS, AMONG THE STARS</small></div></section>
  <div class="stats-grid">${stat('今日日程', ev.length.toString().padStart(2, '0'), '项', `<span class="green">${done} 项已完成</span> · ${remaining} 项待进行`, 'calendar')}${stat('本月专注', (s.studyMinutes / 60).toFixed(1), '小时', '统计已完成的学习与课程时长', 'clock')}${stat('本月净支出', money(s.netExpense), '元', `${s.count} 笔记录 · 退款已抵扣`, 'wallet')}${stat('计划完成率', s.events ? Math.round((s.completed / s.events) * 100) : '0', '%', `本月 ${s.completed} / ${s.events} 项已完成`, 'chart')}</div>
  <div class="content-grid"><section class="card"><div class="card-header"><div><h2>日程一览</h2><p class="card-subtitle">${selectedDay === day ? '今天' : prettyDate(selectedDay)}，一步一步来就很好。</p></div><button class="text-button" data-nav="calendar">完整日历 ${icon('arrow')}</button></div><div class="week-strip">${Array.from(
    { length: 7 },
    (_, i) => {
      const d = addDay(weekStart, i);
      return `<button class="day-chip ${d === selectedDay ? 'selected' : ''} ${d === day ? 'today' : ''}" data-day="${d}"><span>${weekday(d)}</span><strong>${Number(d.slice(8))}</strong>${eventsByDate.has(d) ? '<i></i>' : '<span></span>'}</button>`;
    },
  ).join(
    '',
  )}</div><div class="agenda-list">${dayEvents(selectedDay).slice(0, 5).map(agenda).join('') || empty('今天的留白，等你来安排', '写下第一件想做的小事吧。', '<button class="button small light" data-new="event">＋ 添加日程</button>')}</div></section>
  <section class="card"><div class="card-header"><div><h2>${Number(month.slice(5))}月生活账本</h2><p class="card-subtitle">每一笔小记录，都让生活更清楚。</p></div><button class="text-button" data-nav="ledger">查看 ${icon('arrow')}</button></div><div class="finance-total"><div><span class="eyebrow">净支出</span><strong><small>¥</small>${money(s.netExpense)}</strong></div><div><span class="eyebrow">收入</span><strong class="positive"><small>¥</small>${money(s.income)}</strong></div></div><progress value="${Math.max(0, s.netExpense)}" max="${Math.max(1, state.settings.budget * 100)}" aria-label="月预算使用进度"></progress><div class="budget-label"><span>月预算 ¥ ${money(state.settings.budget * 100)}</span><span>${state.settings.budget ? Math.max(0, Math.round(s.netExpense / state.settings.budget)).toString() + '%' : '未设预算'}</span></div>${categoriesHTML(s)}<div class="divider"></div><div class="import-buttons"><button class="button" data-import="wechat">${icon('upload')}导入微信账单</button><button class="button" data-import="alipay">${icon('upload')}导入支付宝账单</button></div></section></div>
  <div class="bottom-grid"><section class="card tip-card"><span class="tip-symbol">✳</span><div><h3>每个月，都值得好好回望。</h3><p>日程完成度、学习时长、收支变化，自动汇成一份生活小结。</p><button class="text-button" data-nav="reports">打开我的月度复盘 ${icon('arrow')}</button></div></section><section class="card"><div class="card-header"><h2>生活小捷径</h2><span class="eyebrow">QUICK ACCESS</span></div><div class="quick-links"><button class="quick-link" data-import="courses"><span>${icon('book')}</span><span>导入大工课表</span></button><button class="quick-link" data-new="transaction"><span>${icon('wallet')}</span><span>随手记一笔</span></button><button class="quick-link" data-action="backup"><span>${icon('shield')}</span><span>加密备份</span></button></div></section></div>`
  );
}
function calendar() {
  const first = calendarMonth + '-01',
    offset = (new Date(first).getUTCDay() + 6) % 7,
    start = addDay(first, -offset);
  return (
    heading(
      'A LITTLE STRUCTURE, A LOT OF POSSIBILITY',
      '日程与课表',
      '课程、计划和生活，在同一张日历里相遇。',
      '<button class="button primary" data-new="event">＋ 新建日程</button>',
    ) +
    `${dailyCourses()}<div class="notice gesture-hint">✦ 电脑在日历空白处右键，手机在日期空白处长按，即可新建日程。</div><div class="toolbar"><a class="button" href="/api/calendar.ics">导出日历与提醒 ↓</a><button class="button" data-import="courses">${icon('book')}导入大工课表</button><a class="button" href="https://teach.dlut.edu.cn/index.htm" target="_blank" rel="noopener noreferrer">大工教务处 ↗</a><button class="text-button" data-action="course-template">下载课表模板 ↓</button></div><section class="card calendar-card"><div class="calendar-toolbar"><button class="icon-button" data-month-step="-1" aria-label="上月">‹</button><strong>${calendarMonth.slice(0, 4)}年 ${Number(calendarMonth.slice(5))}月</strong><button class="icon-button" data-month-step="1" aria-label="下月">›</button><button class="button small" data-action="calendar-today">回到今天</button></div><div class="calendar-grid">${['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((d) => `<div class="calendar-head">${d}</div>`).join('')}${Array.from(
      { length: 42 },
      (_, i) => {
        const d = addDay(start, i),
          items = dayEvents(d);
        return `<div data-calendar-date="${d}" class="calendar-cell ${d.startsWith(calendarMonth) ? '' : 'outside'} ${d === today() ? 'is-today' : ''}"><button class="day-number" data-new-date="${d}" aria-label="${d} 添加日程">${Number(d.slice(8))}</button>${items
          .slice(0, 3)
          .map(
            (e) =>
              `<button class="calendar-event ${esc(e.kind)} ${e.done ? 'done' : ''}" data-edit="${esc(e.id)}" title="${esc(e.start + ' ' + e.title + ' ' + e.location)}">${e.start} ${esc(e.title)}</button>`,
          )
          .join(
            '',
          )}${items.length > 3 ? `<button class="text-button" data-day-detail="${d}">另 ${items.length - 3} 项</button>` : ''}</div>`;
      },
    ).join('')}</div><div class="legend">${Object.entries(kinds)
      .map(([k, v]) => `<span><i class="${k}"></i>${v}</span>`)
      .join(
        '',
      )}</div></section><div class="notice section-space">课程可直接粘贴表格或选择 ICS / CSV / TSV / XLSX，自动识别常见表头、星期与单双周。矩阵课表需注明真实时间，或补充学校节次作息。学校账号只在官方教务页面登录；本应用不保存学校密码。目前不提供自动登录抓取或自动更新课表。</div>`
  );
}
function safeMapSearch(value) {
  try {
    return mapSearch(value);
  } catch {
    return 'https://uri.amap.com/search?keyword=' + encodeURIComponent(String(value).slice(0, 120));
  }
}
function dailyCourses() {
  const courses = dayEvents(selectedDay)
    .filter((e) => e.kind === 'course')
    .sort((a, b) => a.start.localeCompare(b.start));
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return `<section class="card daily-card"><div class="daily-toolbar"><h2>每日课表</h2><button class="icon-button" data-course-step="-1" aria-label="前一天">‹</button><input id="course-day" type="date" value="${selectedDay}" aria-label="课表日期"><button class="icon-button" data-course-step="1" aria-label="后一天">›</button><button class="button small" id="course-today">今天</button></div><div class="course-timeline">${courses.map((e) => `<div class="course-slot ${selectedDay === today() ? (clock >= e.end ? 'past' : clock >= e.start ? 'current' : '') : ''}"><div><strong>${e.start}</strong><small>${e.end}</small></div><div><button class="text-button" data-edit="${esc(e.id)}">${esc(e.title)}</button><small>${esc(e.location || '未填写教室')}</small>${e.location ? `<a class="location-link" href="${esc(safeMapSearch(e.location))}" target="_blank" rel="noopener noreferrer">在地图中搜索 ↗</a>` : ''}</div></div>`).join('') || '<p class="daily-empty">这一天没有课程，自由安排你的时间。</p>'}</div><div class="row-actions section-space"><button class="button small" id="pin-courses">${offline ? '添加桌面每日课表' : '打开独立课表窗口'}</button>${offline ? '<button class="button small" id="clear-course-widget">关闭桌面课表展示</button>' : ''}</div><p class="help-text">Android 支持桌面小组件。课程名称、教室和时间会显示在桌面；电脑浏览器可收藏每日课表入口。课表变动后打开应用更新。</p></section>`;
}
let lastWidgetPayload = '';
function widgetSnapshot(type = 'widget.snapshot') {
  if (!window.XingyeHost) return;
  if (type === 'widget.snapshot' && localStorage.getItem('xingye.widget') !== 'on') return;
  const payload = JSON.stringify({
    type,
    events: state.events
      .filter((e) => e.kind === 'course')
      .map(({ title, date, start, end, location }) => ({ title, date, start, end, location })),
  });
  if (type === 'widget.snapshot' && payload === lastWidgetPayload) return;
  lastWidgetPayload = payload;
  window.XingyeHost.postMessage(payload);
}
function bindDaily() {
  if (!state) return;
  widgetSnapshot();
  document.querySelectorAll('[data-course-step]').forEach(
    (b) =>
      (b.onclick = () => {
        selectedDay = addDay(selectedDay, Number(b.dataset.courseStep));
        render();
      }),
  );
  if ($('#course-day'))
    $('#course-day').onchange = (e) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
        selectedDay = e.target.value;
        render();
      }
    };
  if ($('#course-today'))
    $('#course-today').onclick = () => {
      selectedDay = today();
      render();
    };
  if ($('#pin-courses'))
    $('#pin-courses').onclick = () => {
      if (window.XingyeHost) {
        if (confirm('在桌面显示课程名称、教室和时间？锁定应用后桌面课表仍可见。')) {
          localStorage.setItem('xingye.widget', 'on');
          widgetSnapshot('widget.pin');
        }
      } else if (window.XingyeDesktop) {
        window.XingyeDesktop.courses();
      } else {
        window.open(location.origin + '/?view=courses', '_blank', 'noopener,width=440,height=760');
      }
    };
  if ($('#clear-course-widget'))
    $('#clear-course-widget').onclick = () => {
      window.XingyeHost?.postMessage(JSON.stringify({ type: 'widget.clear' }));
      localStorage.removeItem('xingye.widget');
      toast('已关闭桌面课表内容展示');
    };
}
window.addEventListener('xingye-bridge-ready', () => {
  if (state) widgetSnapshot();
});
function planner() {
  return (
    heading(
      'A PLAN THAT FITS YOUR LIFE',
      '给未来，留一点好安排。',
      '把目标写下来，让空闲时间成为可以行动的计划。',
    ) +
    `<div class="planner-layout"><section class="card"><div class="planner-heading"><span class="eyebrow">YOUR PERSONAL PLANNING PARTNER</span><h2>想做什么，告诉星野记。</h2><p>先避开课表和已有安排，再为目标找一个合适的位置。</p></div><form id="plan-form"><label>这段时间，想完成什么？<textarea name="goal" maxlength="2000" required placeholder="例如：准备四级考试，每天留出一小时背单词和练听力。"></textarea></label><div class="field-grid"><label>规划范围<select name="days"><option value="7">未来 7 天</option><option value="3">未来 3 天</option><option value="14">未来 14 天</option><option value="30">未来 30 天</option></select></label><label>每天专注时长<select name="duration"><option value="60">60 分钟</option><option value="25">25 分钟</option><option value="45">45 分钟</option><option value="90">90 分钟</option><option value="120">120 分钟</option></select></label></div><label class="check-label"><input type="checkbox" name="useAI" ${state.settings.hasApiKey ? 'checked' : ''}><span>使用 DeepSeek AI 分解目标${state.settings.hasApiKey ? '' : '（请先在设置中填写密钥）'}。关闭后使用本地空闲时段规划。</span></label><label class="check-label"><input type="checkbox" name="consent"><span>本次使用 AI 时，同意发送上面的目标、作息和忙碌时段。日程标题、地点与账单明细不会发送。请求会消耗 DeepSeek 账户额度。</span></label><p class="form-error" id="plan-error" role="alert"></p><button class="button primary wide" type="submit">${icon('spark')}生成我的安排 ${icon('arrow')}</button></form><p class="help-text section-space">建议会先出现在右侧，确认后才会写入日程。时间以北京时间为准。</p></section><section class="card"><div class="card-header"><div><h2>为你留出的时间</h2><p class="card-subtitle">${plan ? esc(plan.source) + ' · ' + plan.items.length + ' 项建议' : '计划从一个小目标开始'}</p></div><span class="pill">先预览，再安排</span></div><div id="plan-result">${planHTML()}</div></section></div>`
  );
}
function planHTML() {
  if (!plan)
    return empty(
      '空白的下一页，也很有可能。',
      '写下目标，星野记会帮你寻找未来的空闲时段。',
      '',
      'spark',
    );
  if (!plan.items.length)
    return empty('这段时间安排得很满', '试试缩短专注时长、调整作息，或增加规划天数。', '', 'clock');
  return `${plan.note ? `<div class="plan-note">${esc(plan.note)}</div>` : ''}${plan.items.map((e) => `<div class="plan-row"><div class="plan-date">${weekday(e.date)}<b>${e.date.slice(5).replace('-', '/')}</b></div><div><h3>${esc(e.title)}</h3><p>${e.start} — ${e.end} · ${kinds[e.kind] || '专注学习'}</p></div></div>`).join('')}<div class="modal-actions"><button class="button" data-action="clear-plan">清空建议</button><button class="button primary" data-action="apply-plan">${icon('check')}确认加入日程</button></div>`;
}
function ledger() {
  const s = summary(ledgerMonth);
  return (
    heading(
      'SMALL RECORDS, CLEARER DAYS',
      '生活里的每一笔，都有迹可循。',
      '导入账单，自动分类。知道钱去了哪里，也更知道自己喜欢什么。',
      '<button class="button primary" data-new="transaction">＋ 记一笔</button>',
    ) +
    `<div class="stats-grid">${stat('本月净支出', money(s.netExpense), '元', '支出减去独立退款记录', 'wallet')}${stat('本月收入', money(s.income), '元', '转账 / 不计收支不计入', 'chart')}${stat('本月退款', money(s.refund), '元', '按独立退款明细统计，请核对退款状态', 'wallet')}${stat('账单笔数', s.count, '笔', '重复交易已按平台交易号过滤', 'book')}</div><section class="card"><div class="toolbar"><input type="month" id="ledger-month" class="filter-select" aria-label="账本月份" value="${ledgerMonth}"><select id="ledger-direction" class="filter-select" aria-label="收支筛选"><option value="">全部收支</option>${Object.entries(
      directions,
    )
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join(
        '',
      )}</select><input id="ledger-search" class="search-input" placeholder="搜索交易方或分类" aria-label="搜索账单"><span class="spacer"></span><button class="button small" data-import="wechat">${icon('upload')}微信</button><button class="button small" data-import="alipay">${icon('upload')}支付宝</button><button class="button small" data-action="export-ledger">${icon('download')}导出</button></div><div id="ledger-table"></div></section><div class="notice section-space">账单仅在电脑上解析与保存。自动分类可以在导入预览中核对；转账单列，原支出保留、独立退款明细抵扣；仅有退款状态时需手动补记退款金额。跨微信与支付宝的同一笔交易不会自动合并，建议避免重复导入同一支付的两份记录。</div>`
  );
}
function renderLedgerTable() {
  const search = ($('#ledger-search')?.value || '').toLowerCase(),
    direction = $('#ledger-direction')?.value;
  const items = state.transactions
    .filter(
      (t) =>
        t.date.startsWith(ledgerMonth) &&
        (!direction || t.direction === direction) &&
        (t.merchant + t.category).toLowerCase().includes(search),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const pages = Math.max(1, Math.ceil(items.length / 30));
  ledgerPage = Math.min(ledgerPage, pages - 1);
  $('#ledger-table').innerHTML = items.length
    ? `<div class="table-wrap"><table><thead><tr><th>日期</th><th>交易方 / 备注</th><th>分类</th><th>来源</th><th>金额</th><th></th></tr></thead><tbody>${items
        .slice(ledgerPage * 30, ledgerPage * 30 + 30)
        .map(
          (t) =>
            `<tr><td>${esc(t.date)}</td><td>${esc(t.merchant)}</td><td><span class="pill">${esc(t.category)}</span></td><td class="muted">${sources[t.source]}</td><td class="amount ${t.direction}">${['income', 'refund'].includes(t.direction) ? '+' : t.direction === 'expense' ? '−' : ''}${money(t.amount)}<br><small class="muted">${directions[t.direction]}</small></td><td><button class="table-action" data-edit-tx="${esc(t.id)}">编辑</button><button class="table-action" data-delete-tx="${esc(t.id)}" aria-label="删除 ${esc(t.merchant)}">删除</button></td></tr>`,
        )
        .join(
          '',
        )}</tbody></table></div><div class="pagination"><span>共 ${items.length} 笔 · 第 ${ledgerPage + 1} / ${pages} 页</span><div class="row-actions"><button class="button small" data-ledger-page="-1" ${ledgerPage === 0 ? 'disabled' : ''}>上一页</button><button class="button small" data-ledger-page="1" ${ledgerPage >= pages - 1 ? 'disabled' : ''}>下一页</button></div></div>`
    : empty(
        '账本的第一页，从这里开始',
        '导入微信或支付宝账单，也可以随手记录一笔。',
        '<button class="button small light" data-new="transaction">＋ 记一笔</button>',
        'wallet',
      );
}
function reports() {
  const s = summary(reportMonth),
    stored = state.reports[reportMonth];
  const ai = stored?.ai;
  return (
    heading(
      'LOOK BACK, MOVE FORWARD',
      '每一段生活，都值得好好回望。',
      '自动汇总真实记录，让下个月的你更了解自己。',
      `<button class="button" data-action="download-report">${icon('download')}导出复盘</button>`,
    ) +
    `<div class="toolbar"><input type="month" id="report-month" value="${reportMonth}" class="filter-select" aria-label="选择复盘月份"><span class="pill">本地统计自动更新</span><span class="spacer"></span><button class="button small light" data-action="generate-report">${icon('check')}保存本月小结</button></div><section class="report-hero"><div><span class="eyebrow">MY MONTH IN REVIEW</span><h2>${reportMonth.slice(0, 4)}年${Number(reportMonth.slice(5))}月 · 我的生活切片</h2><p>${s.count || s.events ? '每一次完成、每一笔记录，都是认真生活的痕迹。' : '这里还没有记录。写下一些日程或导入账单，再回来看看。'}</p></div><span class="report-symbol">✳</span></section><div class="stats-grid">${stat('日程完成', s.completed, '/ ' + s.events + ' 项', '包括学习、课程、生活与工作', 'calendar')}${stat('学习时长', (s.studyMinutes / 60).toFixed(1), '小时', '仅统计标记为完成的学习和课程', 'clock')}${stat('净支出', money(s.netExpense), '元', '原始支出 ¥ ' + money(s.expense), 'wallet')}${stat('本月结余', money(s.income - s.netExpense), '元', '收入 − 净支出，不含转账', 'chart')}</div><div class="content-grid"><section class="card"><div class="card-header"><h2>这个月，生活的轮廓</h2><span class="pill">基于本地记录</span></div><p class="report-text">${esc(localReport(s))}</p><div class="divider"></div><h3>DeepSeek 的复盘建议</h3>${ai ? `<p class="report-text section-space">${esc(ai.summary)}</p><ol class="report-list">${ai.suggestions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${stored.aiStale ? '<p class="help-text">记录有变化，这份 AI 建议已过期，可重新生成。</p>' : ''}` : '<p class="help-text section-space">需要时，再请 AI 帮你看看。仅发送该月分类金额、收支总额和日程完成统计。</p>'}<label class="check-label section-space"><input id="report-consent" type="checkbox"><span>同意将月度汇总发送给 DeepSeek，生成复盘建议。不会发送交易方、订单号、API 密钥正文或日程标题；调用会消耗账户额度。</span></label><button class="button light" data-action="ai-report">${icon('spark')}${ai ? '重新生成 AI 建议' : '生成 AI 复盘建议'}</button></section><section class="card"><div class="card-header"><h2>支出分布</h2><span class="muted">¥</span></div><div class="report-bars">${
      Object.entries(s.categories)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([c, n]) =>
            `<div class="bar-row"><span>${esc(c)}</span><progress value="${n}" max="${Math.max(1, s.expense)}" aria-label="${esc(c)}支出占比"></progress><span>${money(n)}</span></div>`,
        )
        .join('') || empty('还没有支出记录', '导入账单后会在这里看到分类。', '', 'chart')
    }</div><div class="divider"></div><p class="help-text">月初自动为上月生成本地小结；服务关闭或保险库锁定期间不运行，下一次解锁时补生成。历史数据变化后，统计会随之刷新。</p><div class="section-space"><h3>已保存的月份</h3><div class="row-actions section-space">${
      Object.keys(state.reports)
        .sort()
        .reverse()
        .slice(0, 12)
        .map((m) => `<button class="button small" data-report-month="${esc(m)}">${esc(m)}</button>`)
        .join('') || '<span class="muted">暂无</span>'
    }</div></div></section></div>`
  );
}
function localReport(s) {
  const top = Object.entries(s.categories).sort((a, b) => b[1] - a[1])[0];
  return `这个月，你记录了 ${s.events} 项日程，完成 ${s.completed} 项${s.events ? `，完成率 ${Math.round((s.completed / s.events) * 100)}%` : ''}。\n已完成的学习与课程累计 ${(s.studyMinutes / 60).toFixed(1)} 小时。\n\n账本共 ${s.count} 笔记录，收入 ¥${money(s.income)}，净支出 ¥${money(s.netExpense)}，退款 ¥${money(s.refund)}。${top ? `支出最多的分类是「${top[0]}」，共 ¥${money(top[1])}。` : ''}\n\n${s.events || s.count ? '数据只描述已经记下的部分。留意那些想继续的习惯，也给尚未完成的计划一点空间。' : '还没有足够的记录来描述这个月。可以先写下一个计划，或者导入一份账单。'}`;
}
function settings() {
  const s = state.settings;
  return (
    heading(
      'YOUR SPACE, YOUR RULES',
      '按你的习惯，安顿好一切。',
      '密钥、设备和数据，都由你掌握。',
    ) +
    `<div class="settings-grid"><div><section class="card settings-card"><h2>日常偏好</h2><p>为你的计划设定一些舒服的边界。</p><form id="settings-form"><label>怎么称呼你<input name="name" value="${esc(s.name)}" maxlength="30" required autocomplete="nickname"></label><div class="field-grid"><label>每天开始安排的时间<input type="time" name="dayStart" value="${esc(s.dayStart)}" required></label><label>每天结束安排的时间<input type="time" name="dayEnd" value="${esc(s.dayEnd)}" required></label></div><label>月度生活预算（元）<input name="budget" type="number" min="0" max="1000000" step="0.01" value="${s.budget}" required></label><label>学期第一周周一<input name="semesterStart" type="date" value="${esc(s.semesterStart)}"></label><p class="help-text">用于按周次导入课程，请根据大工校历填写。不预设学期日期或上课节次。</p><div class="divider"></div><h2>DeepSeek AI</h2><p class="help-text section-space">${offline ? '密钥经手机原生端调用 DeepSeek 官方接口，独立加密保存在本机，不需要电脑代转。' : '密钥通过电脑服务调用官方接口，加密保存在保险库中，保存后不再回显。'}</p><label>API 密钥${s.hasApiKey ? ' · 已配置' : ' · 尚未配置'}<input name="apiKey" type="password" autocomplete="off" maxlength="256" placeholder="${s.hasApiKey ? '留空保留现有密钥' : '输入你的 DeepSeek API Key'}"></label><label class="check-label"><input name="clearApiKey" type="checkbox"><span>删除已保存的密钥</span></label><label>每日 AI 调用上限（0 表示暂停）<input name="aiDailyLimit" type="number" min="0" max="100" step="1" required value="${s.aiDailyLimit ?? 100}"></label><p class="help-text">本设备今日已请求 ${state.aiUsage?.day === today() ? state.aiUsage.calls : 0} 次，失败请求也计入；次数不代表实际费用，按北京时间每日重置。</p><label>模型名称<input name="model" value="${esc(s.model)}" required maxlength="80" pattern="[a-zA-Z0-9._\-]+"></label><p class="help-text">默认 deepseek-flash，可按你的 DeepSeek 账户可用模型修改。<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">管理密钥 ↗</a></p><p class="form-error" id="settings-error" role="alert"></p><button class="button primary" type="submit">保存设置 ${icon('check')}</button></form></section></div><div><section class="card settings-card"><h2>安全与数据</h2><p>私密不是一个选项，而是这里的起点。</p><div class="security-row"><span>${icon('shield')}</span><div><strong>AES-256-GCM 加密存储</strong><small>密钥由主密码通过 scrypt 派生</small></div><span>已开启</span></div><div class="security-row"><span>${icon('lock')}</span><div><strong>30 分钟无请求自动锁定</strong><small>手动锁定会清除页面中的敏感数据</small></div><span>已开启</span></div><div class="security-row"><span>${icon('laptop')}</span><div><strong>${offline ? '本机离线存储' : '电脑本机访问'}</strong><small>${offline ? '扫码配对后通过加密连接同步' : '在下方连接设备中扫码配对手机和平板'}</small></div><span>${sessionInfo.secure ? 'HTTPS' : '本机'}</span></div><div class="row-actions section-space"><button class="button" data-action="backup">${icon('download')}导出加密备份</button><button class="button" data-action="restore">${icon('upload')}恢复备份</button><button class="button" data-action="backup-history">恢复历史副本</button></div><p class="help-text section-space">备份包含日程、账单和密钥，仍需主密码解密。恢复会替换现有记录；系统保留最近的加密历史副本，可从「恢复历史副本」导出。恢复不会改变电脑当前配对与撤销状态。密码无法找回。</p></section><section class="card settings-card"><h2>连接设备</h2><div id="device-panel">正在查看已登录设备…</div><div class="row-actions section-space"><button class="button small danger" data-action="lock-all">退出所有设备</button></div></section><section class="card settings-card" id="integration-panel"></section><section class="card settings-card"><h2>为你的三台设备而设计</h2><div class="device-list"><div class="device-row"><span class="device-icon">${icon('laptop')}</span><div><strong>天选 6 Pro · 完整工作台</strong><p>本机运行、宽屏日历、批量导入，无需本地大模型或显卡算力。</p></div></div><div class="device-row"><span class="device-icon">${icon('phone')}</span><div><strong>小米 17P · 随手记录</strong><p>大触控区域、底部导航、安全区适配与主屏幕快捷入口。</p></div></div><div class="device-row"><span class="device-icon">${icon('tablet')}</span><div><strong>小米 Pad 7 · 留出更多空间</strong><p>横屏双栏、竖屏自适应，课表和复盘更容易查看。</p></div></div></div><div class="notice section-space">手机和平板扫码配对后自动同步。电脑需保持运行并解锁，设备网络需互通；电脑关闭时可离线编辑。</div></section></div></div>`
  );
}

function automations() {
  if (offline)
    return heading(
      'AUTOMATIONS',
      '自动任务',
      '请通过电脑服务连接使用自动任务。手机独立离线模式暂不支持后台定时执行。',
    );
  const fmt = (value) =>
    value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未执行';
  return (
    heading(
      'AUTOMATIONS',
      '让重复的事，按时发生。',
      '同一任务持续使用同一段 API 对话，每次发送原始请求和完整历史。',
    ) +
    `<section class="card settings-card"><h2>新建自动任务</h2><p>电脑服务运行且保险库解锁时执行；锁定或关机期间暂停，恢复后只补执行一次。不会写入 DeepSeek 官网聊天记录。</p><form id="automation-form"><label>任务名称<input name="title" maxlength="80" required placeholder="每晚学习复盘"></label><label>重复发送的请求<textarea name="prompt" maxlength="4000" required placeholder="请根据本对话已有信息，提出下一轮学习建议；信息不足时明确指出。"></textarea></label><div class="field-grid"><label>首次执行时间（北京时间）<input name="nextRun" type="datetime-local" required></label><label>间隔（分钟）<input name="interval" type="number" min="5" max="43200" value="1440" required></label></div><label class="check-label"><input type="checkbox" name="consent" required>允许定时向 DeepSeek 发送该请求与本任务历史，产生 API 费用</label><button class="button primary" type="submit">创建自动任务</button><p id="automation-error" class="form-error" role="alert"></p></form></section><div class="automation-list">${(state.automations || []).map((t) => `<section class="card settings-card"><div class="card-header"><h2>${esc(t.title)}</h2><span>${t.enabled ? '已开启' : '已暂停'} · ${esc({ waiting: '等待执行', running: '执行中', success: '执行成功', failed: '执行失败' }[t.status] || '等待执行')}</span></div><p>${esc(t.prompt)}</p><p>每 ${esc(t.interval)} 分钟 · 下次：${esc(fmt(t.nextRun))}<br>上次：${esc(fmt(t.lastRun))} · 已完成 ${t.rounds || 0} 轮</p>${t.error ? `<p class="form-error">${esc(t.error)}</p>` : ''}<pre class="automation-reply">${esc(t.lastReply || '首次执行后，回复会显示在这里。')}</pre><details data-history="${esc(t.id)}"><summary>完整对话记录</summary><div class="task-history">展开后加载</div></details><div class="automation-actions">${['run', 'toggle', 'delete'].map((a, i) => `<button class="button" data-task="${esc(t.id)}" data-action="${a}" ${t.status === 'running' ? 'disabled' : ''}>${['立即执行', t.enabled ? '暂停' : '恢复', '删除'][i]}</button>`).join('')}</div></section>`).join('')}</div>`
  );
}
function bindPage() {
  if (page === 'automations' && !offline) {
    $$('[data-history]').forEach(
      (details) =>
        (details.ontoggle = async () => {
          if (!details.open || details.dataset.loaded) return;
          const target = $('.task-history', details);
          try {
            const { messages } = await api(
              'automations/history?id=' + encodeURIComponent(details.dataset.history),
            );
            target.innerHTML = messages
              .map(
                (m) =>
                  `<p><strong>${m.role === 'user' ? '请求' : 'DeepSeek'}</strong></p><pre class="automation-reply">${esc(m.content)}</pre>`,
              )
              .join('');
            const exportButton = document.createElement('button');
            exportButton.className = 'button small';
            exportButton.textContent = '导出对话 JSON（明文）';
            exportButton.onclick = () =>
              download(
                '星野记-自动任务对话.json',
                JSON.stringify(
                  {
                    title: state.automations.find((task) => task.id === details.dataset.history)
                      ?.title,
                    exportedAt: new Date().toISOString(),
                    messages,
                  },
                  null,
                  2,
                ),
                'application/json;charset=utf-8',
              );
            target.prepend(exportButton);
            details.dataset.loaded = 'true';
          } catch (error) {
            target.textContent = error.message;
          }
        }),
    );

    $('#automation-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target,
        button = $('button[type=submit]', f);
      button.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(f));
        data.nextRun = new Date(data.nextRun + ':00+08:00').toISOString();
        data.consent = f.consent.checked;
        await api('automations/create', data);
        await refresh();
        toast('自动任务已创建');
      } catch (error) {
        if ($('#automation-error')) $('#automation-error').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    $$('[data-task]').forEach(
      (button) =>
        (button.onclick = async () => {
          if (button.dataset.action === 'delete' && !confirm('删除此任务和对话记录？')) return;
          button.disabled = true;
          try {
            await api('automations/action', {
              id: button.dataset.task,
              action: button.dataset.action,
            });
            await refresh();
          } catch (error) {
            toast(error.message, true);
          } finally {
            button.disabled = false;
          }
        }),
    );
  }

  if (page === 'settings') {
    const column = $('.settings-grid>div:last-child');
    column.insertAdjacentHTML(
      'afterbegin',
      '<section class="card settings-card" id="visual-preferences"></section>',
    );
    mountVisualPreferences();
    const diagnosticCard = document.createElement('section');
    diagnosticCard.className = 'card settings-card';
    diagnosticCard.innerHTML =
      '<h2>使用诊断</h2><p class="help-text">只导出浏览器环境、界面尺寸和记录数量，不包含标题、正文、账单明细、密码或密钥。</p><button class="button small" id="export-diagnostics">导出诊断信息</button>';
    column.append(diagnosticCard);
    $('#export-diagnostics').onclick = () =>
      download(
        '星野记-诊断信息.json',
        JSON.stringify(
          {
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            runtime: offline ? 'android-offline' : 'local-service',
            userAgent: navigator.userAgent,
            viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            theme: document.documentElement.dataset.theme,
            connection: { secure: sessionInfo.secure, localOnly: sessionInfo.localOnly },
            counts: {
              events: state.events.length,
              transactions: state.transactions.length,
              automations: state.automations?.length || 0,
            },
          },
          null,
          2,
        ),
        'application/json;charset=utf-8',
      );
  }
  if (page === 'diary') diary.mount();
  if (page === 'settings') {
    deviceLink.mount($('#device-panel'));
    collaboration.integrations($('#integration-panel'));
  }
  $$('#content form').forEach((f) => f.addEventListener('input', () => (f.dataset.dirty = 'true')));

  if (page === 'ledger') {
    renderLedgerTable();
    $('#ledger-month').onchange = (e) => {
      if (!e.target.value) return;
      ledgerMonth = e.target.value;
      ledgerPage = 0;
      render();
    };
    $('#ledger-direction').onchange = () => {
      ledgerPage = 0;
      renderLedgerTable();
    };
    $('#ledger-search').oninput = () => {
      ledgerPage = 0;
      renderLedgerTable();
    };
  }
  if (page === 'reports')
    $('#report-month').onchange = (e) => {
      if (e.target.value) {
        reportMonth = e.target.value;
        render();
      }
    };
  if (page === 'settings')
    $('#settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target,
        data = Object.fromEntries(new FormData(f));
      data.clearApiKey = f.clearApiKey.checked;
      data.expectedSettingsVersion = state.settingsVersion || 0;
      const button = $('button[type=submit]', f);
      button.disabled = true;
      try {
        await api('settings', data);
        drafts.remove(f.dataset.draftToken);
        await refresh();
        toast('偏好与密钥已加密保存');
      } catch (error) {
        await showEditConflict(error, f, $('#settings-error'));
      } finally {
        button.disabled = false;
      }
    };
  if (page === 'planner')
    $('#plan-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target,
        data = Object.fromEntries(new FormData(f));
      data.useAI = f.useAI.checked;
      data.consent = f.consent.checked;
      if (data.useAI && !data.consent) {
        $('#plan-error').textContent = '请先确认本次发送给 AI 的数据范围。';
        return;
      }
      const b = $('button[type=submit]', f);
      b.disabled = true;
      b.textContent = data.useAI ? 'DeepSeek 正在规划，最多等待 60 秒…' : '正在寻找空闲时段…';
      $('#plan-error').textContent = '';
      const generation = authGeneration;
      try {
        const result = await api('plan', data);
        if (generation !== authGeneration) return;
        plan = result;
        if (page === 'planner') {
          $('#plan-result').innerHTML = planHTML();
        }
        toast('建议已生成，确认后才会加入日程');
      } catch (err) {
        if ($('#plan-error')) $('#plan-error').textContent = err.message;
      } finally {
        b.disabled = false;
        b.innerHTML = `${icon('spark')}生成我的安排 ${icon('arrow')}`;
      }
    };
}
function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').showModal();
}
function closeModal() {
  $('#modal').close();
  $('#modal-body').innerHTML = '';
}
function eventModal(existing, day = selectedDay) {
  const e = existing || {
    title: '',
    date: day,
    start: '09:00',
    end: '10:00',
    kind: 'study',
    location: '',
  };
  openModal(
    existing ? '留一点时间，调整一下。' : '写下一个新的安排',
    `<form id="event-form"><label>日程名称<input name="title" value="${esc(e.title)}" maxlength="120" placeholder="今天想做些什么？" required></label><div class="field-grid"><label>日期<input name="date" type="date" value="${e.date}" required></label><label>类型<select name="kind">${Object.entries(
      kinds,
    )
      .map(([k, v]) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${v}</option>`)
      .join(
        '',
      )}</select></label><label>开始时间<input type="time" name="start" value="${e.start}" required></label><label>结束时间<input type="time" name="end" value="${e.end}" required></label></div><label>地点 / 教室<input list="recent-places" name="location" maxlength="120" value="${esc(e.location)}" placeholder="例如：大连理工大学凌水校区 图书馆"></label><datalist id="recent-places"></datalist><div class="place-tools"><button type="button" class="button small" id="find-place">在高德地图中搜索 ↗</button><button type="button" class="button small" id="remember-place">记为常用地点</button></div><p class="place-status" id="place-status">校内教室请补充校区或楼名。地点仅在点击地图搜索后发送给高德，不会自动获取定位。</p><div class="field-grid"><label>日历提前提醒<select name="reminder">${[
      [-1, '不提醒'],
      [0, '开始时'],
      [5, '提前 5 分钟'],
      [10, '提前 10 分钟'],
      [15, '提前 15 分钟'],
      [30, '提前 30 分钟'],
      [60, '提前 1 小时'],
    ]
      .map(
        ([n, label]) =>
          `<option value="${n}" ${n === (e.reminder ?? 10) ? 'selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select></label><label class="check-label native-alarm-check"><input name="alarm" type="checkbox" ${e.alarm ? 'checked' : ''}><span>关联系统闹钟（需 Android 伴侣端，仅未来 24 小时单次安排）</span></label></div><p class="form-error" id="event-error" role="alert"></p><div class="modal-actions">${existing ? `<button type="button" class="button danger" id="delete-event">删除日程</button><button type="button" class="button light" id="modal-toggle-done">${existing.done ? '取消完成' : '标记完成'}</button>` : ''}<button class="button primary" type="submit">保存日程 ${icon('check')}</button></div></form>`,
  );
  const placeInput = $('#event-form').elements.location;
  $('#event-form').dataset.recordId = existing?.id || '';
  drafts.bind($('#event-form'), { kind: 'event', id: existing?.id });
  let places = [
    ...new Set(
      state.events.map((e) => e.location).filter((x) => typeof x === 'string' && x.trim()),
    ),
  ].slice(-12);
  $('#recent-places').innerHTML = places.map((x) => `<option value="${esc(x)}"></option>`).join('');
  $('#find-place').onclick = () => {
    try {
      const url = mapSearch(placeInput.value);
      window.open(url, '_blank', 'noopener');
      $('#place-status').textContent =
        '已打开地图搜索，请在地图中确认具体位置；应用不会把搜索结果当作已验证坐标。';
    } catch (e) {
      $('#place-status').textContent = e.message;
    }
  };
  $('#remember-place').onclick = () => {
    try {
      const text = placeQuery(placeInput.value);
      places = [text, ...places.filter((x) => x !== text)].slice(0, 12);

      $('#recent-places').innerHTML = places
        .map((x) => `<option value="${esc(x)}"></option>`)
        .join('');
      $('#place-status').textContent = '已加入本次编辑建议；保存日程后可在下次使用';
    } catch (e) {
      $('#place-status').textContent = e.message;
    }
  };
  $('#event-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const b = $('button[type=submit]', ev.target);
    b.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(ev.target));
      if (data.location.trim()) data.location = placeQuery(data.location);
      data.alarm = ev.target.elements.alarm.checked;
      if (existing) {
        data.id = existing.id;
        data.expectedVersion = existing.version || 0;
      }
      const saved = await api(existing ? 'events/update' : 'events', data);
      drafts.remove(ev.target.dataset.draftToken);
      closeModal();
      await refresh();
      collaboration.scheduleSaved(
        existing ? state.events.find((x) => x.id === existing.id) : saved,
      );
      toast('日程已保存');
    } catch (err) {
      await showEditConflict(err, ev.target, $('#event-error'));
    } finally {
      b.disabled = false;
    }
  };
  if (existing) {
    $('#delete-event').onclick = async () => {
      if (!confirm('删除这项日程？')) return;
      try {
        await api('events/update', {
          id: existing.id,
          delete: true,
          expectedVersion: existing.version || 0,
        });
        closeModal();
        await refresh();
        toast('日程已删除');
      } catch (err) {
        toast(err.message, true);
      }
    };
    $('#modal-toggle-done').onclick = async () => {
      try {
        await api('events/update', {
          id: existing.id,
          done: !existing.done,
          expectedVersion: existing.version || 0,
        });
        closeModal();
        await refresh();
        toast(existing.done ? '已恢复为待完成' : '又完成一件小事，很好。');
      } catch (err) {
        toast(err.message, true);
      }
    };
  }
}
function openExistingTransaction(id) {
  const row = state.transactions.find((t) => t.id === id);
  if (!row) {
    toast('账单已被删除，请刷新列表', true);
    return;
  }
  transactionModal(row);
}
function transactionModal(existing) {
  openModal(
    '生活里的小小一笔',
    `<form id="transaction-form"><div class="field-grid"><label>金额（元）<input type="number" name="amount" min="0.01" max="1000000" step="0.01" required placeholder="0.00"></label><label>类型<select name="direction">${Object.entries(
      directions,
    )
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join(
        '',
      )}</select></label><label>日期<input type="date" name="date" value="${today()}" required></label><label>分类<select name="category">${['餐饮', '交通', '购物', '学习', '娱乐', '住宿', '工资', '生活费', '其他'].map((c) => `<option>${c}</option>`).join('')}</select></label></div><label>交易方 / 备注<input name="merchant" maxlength="160" required placeholder="例如：学校食堂午餐"></label><p class="form-error" id="transaction-error" role="alert"></p><div class="modal-actions"><button class="button primary" type="submit">保存这笔记录 ${icon('check')}</button></div></form>`,
  );
  if (existing) {
    const f = $('#transaction-form');
    for (const key of ['date', 'direction', 'category', 'merchant']) {
      if (
        key === 'category' &&
        ![...f.elements.category.options].some((o) => o.value === existing.category)
      )
        f.elements.category.add(new Option(existing.category, existing.category));
      f.elements[key].value = existing[key];
    }
    f.elements.amount.value = (existing.amount / 100).toFixed(2);
  }
  $('#transaction-form').dataset.recordId = existing?.id || '';
  drafts.bind($('#transaction-form'), { kind: 'transaction', id: existing?.id });
  $('#transaction-form').onsubmit = async (e) => {
    e.preventDefault();
    const button = $('button', e.target);
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(e.target));
      if (existing) {
        data.id = existing.id;
        data.expectedVersion = existing.version || 0;
      }
      await api(existing ? 'transactions/update' : 'transactions', data);
      drafts.remove(e.target.dataset.draftToken);
      closeModal();
      await refresh();
      toast('已经帮你记下来了');
    } catch (err) {
      await showEditConflict(err, e.target, $('#transaction-error'));
    } finally {
      button.disabled = false;
    }
  };
}
function file64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取文件'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}
function importModal(type) {
  const courses = type === 'courses',
    label = courses ? '大工课程表' : sources[type] + '账单';
  openModal(
    '导入' + label,
    `${courses ? `<div class="notice">直接选择教务导出的 Excel / CSV / ICS，或复制表格粘贴。自动识别常见表头、周一等星期和单双周，也支持按星期排列的矩阵课表。先预览，确认后才写入日程。</div><div class="row-actions"><a class="button small" href="https://teach.dlut.edu.cn/index.htm" target="_blank" rel="noopener noreferrer">打开大工教务处 ↗</a><button class="button small" data-action="course-template">下载示例表格 ↓</button></div><label class="section-space">学期第一周周一<input id="import-semester" type="date" value="${esc(state.settings.semesterStart)}"></label><p class="help-text">按星期、周次导入时填写；按具体日期或 ICS 导入可留空。</p><details class="section-space"><summary>按节次导入 / 补充默认周次</summary><label>默认周次（表格中未注明时使用）<input id="import-weeks" placeholder="例如 1-16 或 1-16单周" maxlength="120"></label><label>各节实际时间，每节一行<textarea id="import-sections" rows="4" maxlength="4000" placeholder="1=08:00-08:45&#10;2=08:55-09:40"></textarea></label><p class="help-text">请按学校实际作息填写。这里只是格式示例，不会预设上课时间。矩阵格中的地点可写为「教室：A101」。</p></details><label class="section-space">直接粘贴课表<textarea id="import-paste" rows="5" placeholder="从 Excel 或教务表格复制（含表头）后粘贴，也支持 CSV 文本。" maxlength="2000000"></textarea></label><button class="button light" type="button" id="preview-paste">预览粘贴的课表</button>` : `<p class="modal-help">${type === 'wechat' ? '微信 → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单，选择用于个人对账的明细。' : '支付宝 → 我的 → 账单 → 右上角菜单 → 开具交易流水 / 下载账单，选择用于个人对账的明细。'}菜单名称可能因版本而不同。先解压邮件附件，再选择 CSV 或 XLSX 文件。</p>`}<div class="import-drop section-space">${icon('upload')}<input type="file" id="import-file" accept="${courses ? '.ics,.csv,.tsv,.txt,.xlsx' : '.csv,.xlsx'}" aria-label="选择${label}文件"><p>文件不超过 8 MB · 在本机解析 · 导入前可预览</p></div>${courses ? '<button class="button small" type="button" id="preview-file">重新预览所选文件</button>' : ''}<label>Excel 工作表名称（可选）<input id="import-worksheet" maxlength="160" placeholder="留空读取第一张表；可填写 Excel 底部的表名"></label><p class="form-error" id="import-error" role="alert"></p><div id="import-preview"></div>`,
  );
  let request = 0,
    previewFlight = Promise.resolve();
  const previewFile = async (file) => {
    if (!file) {
      $('#import-error').textContent = '请先选择文件，或在上方粘贴课表';
      return;
    }
    const currentRequest = ++request;
    $('#import-preview').innerHTML = '';
    if (file.size > 8 * 1024 * 1024) {
      $('#import-error').textContent = '文件不能超过 8 MB';
      return;
    }
    $('#import-error').textContent = '';
    $('#import-preview').innerHTML = '<div class="loading">正在本机读取文件…</div>';
    const generation = authGeneration;
    try {
      const content = await file64(file);
      const payload = {
        type,
        filename: file.name,
        content,
        worksheet: $('#import-worksheet').value.trim(),
        ...(courses
          ? {
              semesterStart: $('#import-semester').value,
              defaultWeeks: $('#import-weeks').value,
              sectionTimes: $('#import-sections').value,
            }
          : {}),
      };
      // Keep preview requests in order: the server stores one confirmation token.
      previewFlight = previewFlight
        .catch(() => {})
        .then(() =>
          currentRequest === request && generation === authGeneration && $('#import-preview')
            ? api('import/preview', payload)
            : null,
        );
      const p = await previewFlight;

      if (
        !p ||
        generation !== authGeneration ||
        currentRequest !== request ||
        !$('#import-preview')
      )
        return;
      $('#import-preview').innerHTML =
        `<div class="preview-metrics"><span><strong>${p.items.length}</strong>待导入</span><span>${p.duplicates} 条重复</span><span>${p.ignored || 0} 条跳过</span><span>${p.invalid || 0} 条无效</span>${p.conflicts ? `<span>${p.conflicts} 条时间冲突</span>` : ''}</div>${p.notes ? `<p class="modal-help">${esc(p.notes)}</p>` : ''}${p.invalid ? `<div class="notice warn">有无法识别的记录，不会计入。请核对原始文件后再导入。${(p.invalidRows || []).length ? `<ul>${p.invalidRows.map((row) => `<li>第 ${esc(row.row)} 行：${esc(row.reason)}</li>`).join('')}</ul><small>最多列出前 60 条；行号按解析后的表格记录编号。</small>` : ''}</div>` : ''}${p.conflicts ? '<div class="notice warn">部分课程与已有日程重叠。课程会保留原时间，导入后请在日历中调整冲突。</div>' : ''}<div class="preview-list">${
          courses
            ? p.items
                .slice(0, 60)
                .map(
                  (e) =>
                    `<div class="plan-row"><div class="plan-date">${weekday(e.date)}<b>${e.date.slice(5).replace('-', '/')}</b></div><div><h3>${esc(e.title)}</h3><p>${e.start}—${e.end} ${esc(e.location)}</p></div></div>`,
                )
                .join('')
            : `<table><thead><tr><th>日期</th><th>交易方</th><th>类型</th><th>金额</th></tr></thead><tbody>${p.items
                .slice(0, 60)
                .map(
                  (t) =>
                    `<tr><td>${esc(t.date)}</td><td>${esc(t.merchant)}</td><td>${directions[t.direction]}<br><span class="muted">${esc(t.category)}</span></td><td>${money(t.amount)}</td></tr>`,
                )
                .join('')}</tbody></table>`
        }</div>${p.items.length > 60 ? '<p class="modal-help">仅展示前 60 条，确认后将导入全部有效记录。</p>' : ''}<div class="modal-actions"><button class="button primary" id="commit-import" ${p.items.length ? '' : 'disabled'}>确认导入 ${p.items.length} 条记录</button></div>`;
      $('#commit-import').onclick = async (ev) => {
        ev.target.disabled = true;
        try {
          const result = await api('import/commit', { token: p.token });
          closeModal();
          await refresh();
          toast(`已导入 ${result.count} 条记录`);
        } catch (err) {
          toast(err.message, true);
          ev.target.disabled = false;
        }
      };
    } catch (err) {
      if (currentRequest === request && $('#import-error')) {
        $('#import-error').textContent = err.message;
        $('#import-preview').innerHTML = '';
      }
    }
  };
  $('#import-worksheet').oninput = () => {
    request++;
    $('#import-preview').innerHTML = '';
  };
  $('#import-file').onchange = (e) => previewFile(e.target.files[0]);
  if (courses) {
    $('#preview-file').onclick = () => previewFile($('#import-file').files[0]);
    $('#preview-paste').onclick = () => {
      const text = $('#import-paste').value;
      if (!text.trim()) {
        $('#import-error').textContent = '请先粘贴包含表头的课表';
        return;
      }
      previewFile(new File([text], '粘贴课表.tsv', { type: 'text/tab-separated-values' }));
    };
    for (const field of ['#import-semester', '#import-weeks', '#import-sections', '#import-paste'])
      $(field).oninput = () => {
        request++;
        $('#import-preview').innerHTML = '';
        $('#import-error').textContent = '内容已更改，请重新预览后确认导入';
      };
  }
}
function download(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  if (offline) {
    offline
      .exportFile(filename, blob)
      .then(() => toast('已交给系统文件保存器'))
      .catch((e) => toast(e.message, true));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Neutralize spreadsheet formula injection in every exported cell.
const csvCell = (s) =>
  '"' + (/^[=+\-@\t\r]/.test(String(s)) ? "'" + String(s) : String(s)).replace(/"/g, '""') + '"';
function downloadReport() {
  const s = summary(reportMonth),
    ai = state.reports[reportMonth]?.ai;
  download(
    `星野记-${reportMonth}-月度复盘.md`,
    `# ${reportMonth} · 我的月度复盘\n\n${localReport(s)}\n\n## 支出分类\n\n${Object.entries(
      s.categories,
    )
      .map(([c, n]) => `${c}：¥${money(n)}`)
      .join(
        '\n',
      )}\n\n${ai ? `## DeepSeek 建议${state.reports[reportMonth].aiStale ? '（数据已变化，建议需更新）' : ''}\n\n${ai.summary}\n\n${ai.suggestions.map((x) => '- ' + x).join('\n')}` : ''}\n\n生成于 ${today()}（北京时间）。统计来自本地记录。`,
  );
}
async function doAction(action, target) {
  if (action === 'backup-history') {
    const files = offline ? await offline.recoveryFiles() : (await api('backups')).files;
    openModal(
      '恢复历史副本',
      files.length
        ? `<p>先导出所需副本，再使用「恢复备份」。副本仍需生成时的主密码；恢复数据不会恢复旧设备授权。</p>${files.map((name) => `<button class="button section-space" data-recovery="${esc(name)}">${esc(name)}</button>`).join('')}`
        : '<p>尚无同步前或恢复前副本。</p>',
    );
    document.querySelectorAll('[data-recovery]').forEach(
      (button) =>
        (button.onclick = async () => {
          try {
            const name = button.dataset.recovery;
            let blob;
            if (offline) blob = await offline.backupPrevious(name);
            else {
              const response = await fetch(`/api/backup/history?name=${encodeURIComponent(name)}`);
              if (!response.ok) throw new Error('读取历史副本失败，请重新解锁后再试');
              blob = await response.blob();
            }
            download(name, blob, 'application/octet-stream');
          } catch (error) {
            toast(error.message, true);
          }
        }),
    );
    return;
  }
  if (action === 'sync-now') return deviceLink.open();
  if (action === 'lock-all') {
    if (!confirm('退出电脑、手机和平板上的所有登录会话？')) return;
    await api('lock-all', {});
    showAuth();
    return;
  }
  if (action === 'backup' && offline) {
    download(`星野记-${today()}.vault`, await offline.backup(), 'application/octet-stream');
    return;
  }
  if (action === 'backup') {
    const res = await fetch('/api/backup');
    if (!res.ok) throw new Error('请先解锁保险库再备份');
    download(`星野记-${today()}.vault`, await res.blob(), 'application/octet-stream');
    toast('加密备份已导出，请记住主密码');
  } else if (action === 'calendar-today') {
    calendarMonth = today().slice(0, 7);
    render();
  } else if (action === 'course-template') {
    download(
      '大工课表导入模板.csv',
      '\uFEFF课程名称,日期,星期,开始时间,结束时间,周次,地点\r\n高等数学,,1,08:00,09:35,1-16,请填写真实教室\r\n大学英语,,3,10:05,11:40,1-16单周,请填写真实教室\r\n',
    );
    toast('模板仅为格式示例，请按真实课表与上课时间填写');
  } else if (action === 'clear-plan') {
    plan = null;
    render();
  } else if (action === 'apply-plan') {
    target.disabled = true;
    try {
      const result = await api('plan/apply', { items: plan.items });
      plan = null;
      await refresh();
      collaboration.syncNative();
      toast(`已把 ${result.count} 项计划加入日程`);
    } finally {
      target.disabled = false;
    }
  } else if (action === 'export-ledger') {
    if (!confirm('将导出未加密的账单 CSV，其中包含交易方信息。确认导出？')) return;
    const rows = [
      ['日期', '交易方', '分类', '来源', '类型', '金额（元）'],
      ...state.transactions
        .filter((t) => t.date.startsWith(ledgerMonth))
        .map((t) => [
          t.date,
          t.merchant,
          t.category,
          sources[t.source],
          directions[t.direction],
          (t.amount / 100).toFixed(2),
        ]),
    ];
    download(
      `星野记-${ledgerMonth}-账本.csv`,
      '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'),
      'text/csv;charset=utf-8',
    );
  } else if (action === 'download-report') downloadReport();
  else if (action === 'generate-report' || action === 'ai-report') {
    const useAI = action === 'ai-report';
    if (useAI && !$('#report-consent').checked)
      throw new Error('请先确认本次发送给 AI 的月度汇总范围');
    target.disabled = true;
    const old = target.innerHTML;
    target.textContent = useAI ? '正在生成 AI 复盘…' : '正在保存…';
    try {
      await api('report', { month: reportMonth, useAI, consent: useAI });
      await refresh();
      toast(useAI ? 'AI 复盘已生成' : '本月小结已保存');
    } finally {
      target.disabled = false;
      target.innerHTML = old;
    }
  } else if (action === 'restore') {
    openModal(
      '从加密备份中恢复',
      `<div class="notice warn">恢复会替换当前全部记录。系统会保留恢复前加密副本，可从「恢复历史副本」导出；电脑当前设备配对与撤销状态保持不变。恢复后的数据使用当前主密码加密。</div><form id="restore-form"><label>选择星野记备份<input type="file" name="file" accept=".vault" required></label><label>这份备份的主密码<input type="password" name="password" minlength="10" maxlength="256" autocomplete="off" required></label><label class="check-label"><input type="checkbox" required><span>我已了解本次恢复会替换当前日程、账单与设置。</span></label><p class="form-error" id="restore-error" role="alert"></p><div class="modal-actions"><button class="button primary" type="submit">确认恢复备份</button></div></form>`,
    );
    $('#restore-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target,
        button = $('button', f);
      button.disabled = true;
      try {
        const file = f.elements.file.files[0];
        if (file.size > 64 * 1024 * 1024) throw new Error('备份文件超过 64 MB');
        await api('restore', { content: await file64(file), password: f.password.value });
        closeModal();
        plan = null;
        await refresh();
        toast('数据已恢复，使用当前主密码解锁');
      } catch (err) {
        if ($('#restore-error')) $('#restore-error').textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
  }
}
document.addEventListener('click', async (e) => {
  const el = e.target.closest('button,[data-nav]');
  if (!el) return;
  try {
    if (el.dataset.nav) navigate(el.dataset.nav);
    else if (el.dataset.new) el.dataset.new === 'transaction' ? transactionModal() : eventModal();
    else if (el.dataset.import) importModal(el.dataset.import);
    else if (el.dataset.day) {
      selectedDay = el.dataset.day;
      render();
    } else if (el.dataset.newDate) eventModal(null, el.dataset.newDate);
    else if (el.dataset.edit) {
      const found = state.events.find((x) => x.id === el.dataset.edit);
      if (found) eventModal(found);
    } else if (el.dataset.done) {
      el.disabled = true;
      const ev = state.events.find((x) => x.id === el.dataset.done);
      if (!ev) {
        await refresh();
        throw new Error('日程已被删除，已刷新列表');
      }
      await api('events/update', { id: ev.id, done: !ev.done, expectedVersion: ev.version || 0 });
      await refresh();
    } else if (el.dataset.monthStep) {
      const d = new Date(calendarMonth + '-01');
      d.setUTCMonth(d.getUTCMonth() + Number(el.dataset.monthStep));
      calendarMonth = d.toISOString().slice(0, 7);
      render();
    } else if (el.dataset.dayDetail) {
      const d = el.dataset.dayDetail;
      openModal(
        `${prettyDate(d)} · ${weekday(d)}`,
        `<div class="agenda-list">${dayEvents(d).map(agenda).join('')}</div>`,
      );
    } else if (el.dataset.editTx) openExistingTransaction(el.dataset.editTx);
    else if (el.dataset.deleteTx) {
      if (!confirm('删除这笔账单？删除后可重新导入。')) return;
      await api('transactions/delete', {
        id: el.dataset.deleteTx,
        expectedVersion: state.transactions.find((t) => t.id === el.dataset.deleteTx)?.version || 0,
      });
      await refresh();
      toast('记录已删除');
    } else if (el.dataset.ledgerPage) {
      ledgerPage += Number(el.dataset.ledgerPage);
      renderLedgerTable();
    } else if (el.dataset.reportMonth) {
      reportMonth = el.dataset.reportMonth;
      render();
    } else if (el.dataset.action) await doAction(el.dataset.action, el);
  } catch (error) {
    toast(error.message, true);
    el.disabled = false;
  }
});
$('#close-modal').onclick = () => {
  if (!deviceLink.busy()) closeModal();
};
$('#modal').addEventListener('cancel', (e) => {
  if (deviceLink.busy()) e.preventDefault();
});
$('#modal').addEventListener('click', (e) => {
  if (e.target === $('#modal')) {
    const r = e.target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      closeModal();
  }
});
$('#sync-status').onclick = () => deviceLink.open();
$('#quick-add').onclick = () => eventModal(null, today());
async function manualLock() {
  try {
    await api('lock', {});
    showAuth();
  } catch (error) {
    showAuth();
    toast(error.message, true);
  }
}
$('#lock-button').onclick = manualLock;
$('#mobile-lock').onclick = manualLock;
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const password = $('#password').value;
  $('#auth-error').textContent = '';
  if (!initialized && password !== $('#confirm-password').value) {
    $('#auth-error').textContent = '两次输入的密码不一致';
    return;
  }
  $('#auth-submit').disabled = true;
  try {
    const result = await api(initialized ? 'unlock' : 'setup', {
      password,
      device: /Android/i.test(navigator.userAgent)
        ? innerWidth > 700
          ? '小米平板 / Android'
          : '小米手机 / Android'
        : '天选电脑 / 浏览器',
    });
    csrf = result.csrf;
    initialized = true;
    sessionInfo = await api('session');
    try {
      await drafts.unlock(password);
    } catch {
      drafts.lock();
      toast('当前浏览器无法保存加密草稿，请及时保存编辑内容。', true);
    }
    $('#password').value = '';
    $('#confirm-password').value = '';
    $('#auth').hidden = true;
    $('#app').hidden = false;
    await refresh();
  } catch (error) {
    $('#auth-error').textContent = error.message;
  } finally {
    $('#auth-submit').disabled = false;
  }
};
// Collaboration heartbeats do not refresh the server-side authentication timeout.
let lastActivity = Date.now();
['pointerdown', 'keydown', 'touchstart'].forEach((name) =>
  document.addEventListener(
    name,
    () => {
      lastActivity = Date.now();
      offline?.touch();
    },
    { passive: true },
  ),
);
setInterval(() => {
  if (state && Date.now() - lastActivity >= 30 * 60000) manualLock();
}, 15000);
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && state) {
    try {
      sessionInfo = await api('session');
      if (!sessionInfo.unlocked) showAuth();
    } catch {
      toast('连接已断开，请确认电脑上的星野记仍在运行', true);
    }
  }
});
async function init() {
  document.documentElement.dataset.visual = localStorage.getItem('xingye.visual') || 'balanced';
  paintIcons();
  api('artwork')
    .then((a) => {
      document.body.classList.toggle('has-hero-art', a.hero);
      document.body.classList.toggle('has-mascot-art', a.mascot);
      document.body.classList.toggle('has-cover-art', a.cover);
    })
    .catch(() => {});
  try {
    sessionInfo = await api('session');
    initialized = sessionInfo.initialized;
    // Re-enter the password after a reload to recover the tab's encrypted drafts.
    showAuth();
  } catch (error) {
    $('#auth-description').textContent = '连接本地服务失败，请刷新重试。';
    $('#auth-error').textContent = error.message;
  }
}
init();

// Right-click / deliberate long press work only in the app's schedule surface, never on form fields.
function gestureTarget(target) {
  if (!state || $('#modal').open || !['dashboard', 'calendar'].includes(page)) return null;
  if (
    target.closest(
      'input,textarea,select,a,[data-edit],.calendar-event,.agenda-item,.day-chip,button:not(.day-number)',
    )
  )
    return null;
  if (window.getSelection()?.toString()) return null;
  return (
    target.closest('[data-calendar-date],.agenda-list') || (target.id === 'content' ? target : null)
  );
}
function gestureCreate(target) {
  const surface = gestureTarget(target);
  if (!surface) return false;
  eventModal(
    null,
    target.closest('[data-calendar-date]')?.dataset.calendarDate ||
      (page === 'dashboard' ? selectedDay : today()),
  );
  return true;
}
let holdTimer,
  holdPoint,
  holdTarget,
  holdPointerId,
  suppressTapUntil = 0;
const gesturePointers = new Set();
function cancelHold() {
  clearTimeout(holdTimer);
  holdPoint = holdTarget = holdPointerId = null;
}
document.addEventListener('contextmenu', (e) => {
  if (gestureTarget(e.target)) {
    e.preventDefault();
    if (gesturePointers.size < 2 && Date.now() > suppressTapUntil) gestureCreate(e.target);
  }
});
document.addEventListener(
  'pointerdown',
  (e) => {
    cancelHold();
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    gesturePointers.add(e.pointerId);
    // A second finger anywhere on the page belongs to zooming, never long press.
    if (gesturePointers.size > 1) {
      suppressTapUntil = Date.now() + 900;
      return;
    }
    if (!gestureTarget(e.target)) return;
    holdPoint = { x: e.clientX, y: e.clientY };
    holdTarget = e.target;
    holdPointerId = e.pointerId;
    holdTimer = setTimeout(() => {
      if (gesturePointers.size === 1 && gestureCreate(holdTarget)) {
        suppressTapUntil = Date.now() + 900;
        navigator.vibrate?.(15);
      }
    }, 550);
  },
  { passive: true },
);
document.addEventListener(
  'pointermove',
  (e) => {
    if (
      holdPoint &&
      e.pointerId === holdPointerId &&
      Math.hypot(e.clientX - holdPoint.x, e.clientY - holdPoint.y) > 10
    )
      cancelHold();
  },
  { passive: true },
);
['pointerup', 'pointercancel'].forEach((name) =>
  document.addEventListener(
    name,
    (e) => {
      gesturePointers.delete(e.pointerId);
      cancelHold();
    },
    { passive: true, capture: true },
  ),
);
document.addEventListener('scroll', cancelHold, { passive: true, capture: true });
window.addEventListener('blur', () => {
  gesturePointers.clear();
  cancelHold();
});
document.addEventListener(
  'click',
  (e) => {
    if (
      Date.now() < suppressTapUntil &&
      e.target.closest('#content') &&
      !e.target.closest('#modal')
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true,
);

function mountVisualPreferences() {
  const root = $('#visual-preferences');
  if (!root) return;
  const current = document.documentElement.dataset.visual || 'balanced';
  root.innerHTML = `<h2>玻璃与流畅度</h2><p class="help-text section-space">默认以透光、折射边缘与静态高光表现玻璃，减少大面积实时模糊。</p><label>本设备视觉效果<select id="visual-mode"><option value="balanced" ${current === 'balanced' ? 'selected' : ''}>流畅玻璃 · 推荐</option><option value="enhanced" ${current === 'enhanced' ? 'selected' : ''}>增强玻璃 · 少量背景模糊</option><option value="minimal" ${current === 'minimal' ? 'selected' : ''}>极简流畅 · 关闭透明效果</option></select></label>`;
  $('#visual-mode').onchange = (e) => {
    document.documentElement.dataset.visual = e.target.value;
    localStorage.setItem('xingye.visual', e.target.value);
    toast('已应用本设备的视觉偏好');
  };
}
document.addEventListener(
  'click',
  (e) => {
    const link = e.target.closest('a[href^="/api/calendar.ics"]');
    if (offline && link) {
      e.preventDefault();
      download('星野记日历.ics', calendarFeed(state.events), 'text/calendar;charset=utf-8');
    }
  },
  true,
);

window.addEventListener('xingye:open-courses', () => navigate('calendar'));
