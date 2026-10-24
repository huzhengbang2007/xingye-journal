// A native MessagePort is granted only to the configured HTTPS top-level origin.
window.addEventListener('message', (e) => {
  if (
    e.data !== 'xingye:bridge' ||
    !e.ports?.[0] ||
    (e.origin && e.origin !== 'null' && e.origin !== location.origin)
  )
    return;
  const channel = e.ports[0];
  window.XingyeHost = { postMessage: (data) => channel.postMessage(data) };
  channel.onmessage = (event) => {
    try {
      window.dispatchEvent(new CustomEvent('xingye-native', { detail: JSON.parse(event.data) }));
    } catch {}
  };
  channel.start();
  window.dispatchEvent(new Event('xingye-bridge-ready'));
});
export function createCollaboration({
  api,
  esc,
  toast,
  getState,
  receive,
  locked,
  canRefresh,
  isOffline = () => false,
}) {
  let stream,
    active = false,
    pending = false,
    revision = 0,
    inflight = false,
    timer,
    queuedRevision = 0,
    lastNativePayload = null,
    pollTimer;
  const native = () => typeof window.XingyeHost?.postMessage === 'function';
  const calendarEnabled = () => localStorage.getItem('xingye.calendar') === 'on';
  function label(text, mode = '') {
    const el = document.querySelector('#sync-status');
    if (el) {
      el.textContent = text;
      el.dataset.mode = mode;
    }
  }
  function post(message) {
    if (native()) window.XingyeHost.postMessage(JSON.stringify(message));
  }
  function syncAppearance(theme = document.documentElement.dataset.theme) {
    post({ type: 'appearance.set', resolvedTheme: theme === 'dark' ? 'dark' : 'light' });
  }
  function syncNative(force = false) {
    if (!native() || !calendarEnabled() || !getState()) return;
    const payload = JSON.stringify({
      type: 'calendar.sync',
      events: getState().events.map(
        ({ id, title, date, start, end, location, reminder, version, alarm }) => ({
          id,
          title,
          date,
          start,
          end,
          location,
          reminder,
          version,
          alarm,
        }),
      ),
    });
    if (!force && payload === lastNativePayload) return;
    lastNativePayload = payload;
    window.XingyeHost.postMessage(payload);
  }
  function update(next) {
    queuedRevision = Math.max(queuedRevision, next);
    clearTimeout(timer);
    timer = setTimeout(flush, 100);
  }
  async function flush() {
    if (!active || inflight || queuedRevision <= (getState()?._revision || revision)) return;
    pending = true;
    if (!canRefresh()) {
      label('有更新 · 点此合并', 'pending');
      return;
    }
    inflight = true;
    try {
      await receive();
      revision = getState()?._revision || queuedRevision;
      pending = false;
      label('电脑已就绪 · 连接设备', 'online');
    } catch {
      if (active) label('连接待恢复', 'offline');
    } finally {
      inflight = false;
      if (active && queuedRevision > (getState()?._revision || revision)) {
        clearTimeout(timer);
        timer = setTimeout(flush, 100);
      }
    }
  }
  function readRevision(e) {
    try {
      const value = JSON.parse(e.data);
      if (Number.isSafeInteger(value.revision)) update(value.revision);
    } catch {
      label('同步消息异常，请手动刷新', 'offline');
    }
  }
  function start() {
    if (active) return;
    active = true;
    if (isOffline()) {
      label('连接设备', 'local');
      return;
    }
    revision = getState()?._revision || 0;
    stream = new EventSource('/api/stream');
    stream.addEventListener('ready', (e) => {
      label('电脑已就绪 · 连接设备', 'online');
      readRevision(e);
    });
    stream.addEventListener('change', readRevision);
    stream.addEventListener('locked', () => {
      stop();
      locked();
    });
    pollTimer = setInterval(poll, 25000);
    stream.onerror = () => {
      if (active) label('等待重新连接', 'offline');
    };
  }
  function stop() {
    clearInterval(pollTimer);
    active = false;
    pending = false;
    clearTimeout(timer);
    queuedRevision = 0;
    lastNativePayload = null;
    stream?.close();
    stream = null;
    label('未连接');
  }
  async function manual() {
    if (!canRefresh()) {
      toast('请先保存或关闭正在编辑的内容，再合并其他设备更新');
      return;
    }
    try {
      await receive();
      revision = getState()?._revision || 0;
      pending = false;
      label('电脑已就绪 · 连接设备', 'online');
      syncNative();
      toast('已载入所有设备的最新记录');
    } catch (error) {
      toast(error.message, true);
    }
  }
  async function devices(root) {
    try {
      const { devices } = await api('devices');
      if (!root.isConnected) return;
      root.innerHTML = `<div class="device-list">${devices.map((d) => `<div class="device-row"><span class="device-icon">${d.current ? '◉' : '◇'}</span><div><strong>${esc(d.device)} ${d.current ? '<span class="pill">当前</span>' : ''}</strong><p>上次操作 ${esc(new Date(d.lastActive).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p></div>${d.current ? '' : `<button class="button small danger" data-revoke="${esc(d.id)}">撤销</button>`}</div>`).join('')}</div><div class="field-grid section-space"><label>本设备名称<input id="device-name" maxlength="60" placeholder="例如：天选 6 Pro / 小米 17P / Pad 7" value="${esc(devices.find((d) => d.current)?.device || '')}"></label><div class="device-name-action"><button class="button small" id="rename-device">保存设备名称</button></div></div><p class="help-text">共享同一台电脑上的保险库，不经过云端。最多 10 个会话；锁定当前设备不影响其他设备。更新会自动合并；正在编辑时暂缓刷新。</p>`;
      // Refresh through a fresh endpoint result rather than retaining session credentials.
      root.querySelectorAll('[data-revoke]').forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              await api('devices/revoke', { id: b.dataset.revoke });
              toast('该设备已退出登录');
              await renderDevices(root);
            } catch (error) {
              toast(error.message, true);
            }
          }),
      );
      root.querySelector('#rename-device').onclick = async () => {
        try {
          await api('devices/name', { name: root.querySelector('#device-name').value });
          toast('设备名称已保存');
          await renderDevices(root);
        } catch (error) {
          toast(error.message, true);
        }
      };
    } catch (error) {
      root.textContent = error.message;
    }
  }
  const renderDevices = (root) => devices(root);
  function integrations(root) {
    if (!root) return;
    root.innerHTML = `<h2>小米日历与系统提醒</h2><p class="help-text section-space">${native() ? '通过 Android 标准接口与系统日历互通。开启后仅同步日程，不包含账单或手记；这些日程会成为系统日历中的普通明文事件。' : '当前为浏览器，无法直接获取系统日历或闹钟权限。可以下载带提醒的 ICS 文件导入小米日历；自动同步需安装 Android 伴侣端。'}</p><label class="check-label"><input type="checkbox" id="native-calendar" ${calendarEnabled() ? 'checked' : ''} ${native() ? '' : 'disabled'}><span>此设备自动同步到系统日历（伴侣端授权后生效）</span></label><div class="row-actions"><button class="button small" id="export-calendar">下载带提醒的日历</button>${native() ? '<button class="button small" id="sync-calendar">立即同步日历</button><button class="button small" data-system-open="calendar">打开系统日历</button><button class="button small" data-system-open="app-settings">日历权限设置</button><button class="button small" data-system-open="battery-settings">省电与后台设置</button>' : ''}</div><p class="help-text section-space">可在小米系统日历中查看「星野记」日历，并按需添加系统日历桌面小组件。若提醒未出现，请检查日历应用的通知和省电设置。HyperOS 的跨设备流转由系统和账户控制，本应用未接入其私有互联协议。系统闹钟仍需在时钟确认页核对。</p><p class="help-text" id="system-integration-status" role="status"></p>`;
    root.querySelectorAll('[data-system-open]').forEach((button) => {
      button.onclick = () => post({ type: 'system.open', target: button.dataset.systemOpen });
    });
    root.querySelector('#native-calendar').onchange = (e) => {
      localStorage.setItem('xingye.calendar', e.target.checked ? 'on' : 'off');
      if (e.target.checked) syncNative(true);
    };
    root.querySelector('#export-calendar').onclick = () => {
      window.location.href = '/api/calendar.ics';
    };
    if (root.querySelector('#sync-calendar'))
      root.querySelector('#sync-calendar').onclick = () => syncNative(true);
  }
  function scheduleSaved(e) {
    syncNative();
    if (e?.alarm) {
      if (native()) post({ type: 'alarm.create', event: e });
      else toast('已保存：系统闹钟需 Android 伴侣端；可导出日历提醒');
    }
  }
  window.addEventListener('xingye-bridge-ready', () => {
    const root = document.querySelector('#integration-panel');
    if (root) integrations(root);
    syncNative(true);
    syncAppearance();
  });
  window.addEventListener('xingye:appearance-change', (e) =>
    syncAppearance(e.detail?.resolvedTheme),
  );
  window.addEventListener('xingye-native', (e) => {
    const result = e.detail;
    if (result?.message) toast(result.message, result.ok === false);
    if (result?.message && document.querySelector('#system-integration-status'))
      document.querySelector('#system-integration-status').textContent = result.message;
  });
  async function poll() {
    if (!active || document.hidden || isOffline()) return;
    try {
      const next = await api('sync');
      await update(next.revision);
    } catch {
      if (active) label('连接待恢复', 'offline');
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active && !isOffline()) {
      api('sync')
        .then((r) => update(r.revision))
        .catch(() => {});
    }
  });
  function acknowledge() {
    revision = getState()?._revision || 0;
    pending = false;
    if (active && !isOffline()) label('电脑已就绪 · 连接设备', 'online');
  }
  return {
    start,
    stop,
    acknowledge,
    manual,
    devices: renderDevices,
    integrations,
    scheduleSaved,
    syncNative,
    hasPending: () => pending,
  };
}
