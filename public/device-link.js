import qrcode from './qrcode.js';
import { nativeRequest } from './offline.js';

export function createDeviceLink({
  api,
  offline,
  getState,
  getGeneration,
  canSync,
  refresh,
  esc,
  toast,
  openModal,
}) {
  let busy = false,
    nextAttempt = 0,
    failures = 0,
    conflict = false,
    pendingRefresh = false,
    timer,
    scheduled;
  const $ = (s) => document.querySelector(s);
  function label(value, mode = '') {
    const node = $('#sync-status');
    if (node) {
      node.textContent = value;
      node.dataset.mode = mode;
    }
  }
  function safe() {
    return Boolean(getState()) && !document.hidden && canSync();
  }
  function message(error) {
    if (error.status === 423) return '等待电脑解锁';
    if (error.status === 401 || error.status === 495) return '需要重新配对';
    if (error.status === 409) return '记录有变化 · 重试同步';
    return '等待电脑 · 点此查看';
  }
  async function mount(root) {
    if (!root) return;
    if (offline) {
      root.innerHTML = '<p>正在检查配对…</p>';
      try {
        const status = await nativeRequest('pairing.status');
        if (!root.isConnected) return;
        root.innerHTML = `<p>${status.paired ? '已配对电脑。设备打开并解锁时自动同步，电脑关闭时可继续离线记录。' : '在电脑点击「连接手机」，然后扫描二维码。'}</p><div class="row-actions section-space"><button class="button primary" id="pair-scan">${status.paired ? '重新扫描电脑' : '扫描电脑二维码'}</button>${status.paired ? '<button class="button small danger" id="pair-forget">解除配对</button>' : ''}</div><p class="help-text section-space">电脑和本机需网络互通；校园网不通时，让电脑连接自己的手机热点。系统日历与提醒在下方单独设置。</p>`;
        $('#pair-scan').onclick = scan;
        if ($('#pair-forget'))
          $('#pair-forget').onclick = async () => {
            if (!confirm('解除本机与电脑的配对？本机已有记录会保留。')) return;
            try {
              await nativeRequest('pairing.forget');
              conflict = false;
              label('连接设备', 'local');
              await mount(root);
            } catch (e) {
              toast(e.message, true);
            }
          };
      } catch (e) {
        root.textContent = e.message;
      }
      return;
    }
    try {
      const status = await api('pairing/status?passive=1');
      if (!root.isConnected) return;
      root.innerHTML = `<p>手机和平板扫码配对后，打开并解锁即可自动同步。</p><button class="button primary section-space" id="pair-computer">连接手机 / 平板</button><div class="paired-devices section-space">${status.devices.length ? status.devices.map((d) => `<div class="device-row"><span>${esc(d.name)}</span><button class="button small" data-pair-name="${esc(d.id)}">重命名</button><button class="button small danger" data-pair-revoke="${esc(d.id)}">解除配对</button></div>`).join('') : '<p class="help-text">尚未配对设备</p>'}</div>${status.error ? `<p class="form-error">${esc(status.error)}</p>` : ''}<p class="help-text section-space">电脑需保持运行并解锁。网络不通时使用自己的手机热点；Windows 防火墙提示时允许专用网络访问。</p>`;
      $('#pair-computer').onclick = desktop;
      root.querySelectorAll('[data-pair-revoke]').forEach(
        (node) =>
          (node.onclick = async () => {
            if (!confirm('解除这台设备的配对？它将停止同步，已有记录保留。')) return;
            try {
              await api('pairing/revoke', { id: node.dataset.pairRevoke });
              await mount(root);
            } catch (e) {
              toast(e.message, true);
            }
          }),
      );
      root.querySelectorAll('[data-pair-name]').forEach(
        (node) =>
          (node.onclick = async () => {
            const name = prompt(
              '设备名称',
              status.devices.find((d) => d.id === node.dataset.pairName)?.name || '',
            );
            if (!name?.trim()) return;
            try {
              await api('pairing/name', { id: node.dataset.pairName, name });
              await mount(root);
            } catch (e) {
              toast(e.message, true);
            }
          }),
      );
    } catch (e) {
      root.textContent = e.message;
    }
  }
  async function desktop() {
    openModal(
      '连接手机或平板',
      '<p id="pairing-message" role="status">正在准备电脑连接…</p><div id="pairing-qr"></div><div id="pairing-pending"></div><button class="button small" id="pairing-refresh">刷新二维码</button><p class="help-text section-space">手机打开星野记，点击顶部「连接设备」扫码，再在这里确认设备。二维码两分钟内有效。网络不通时，让电脑连接自己的手机热点；如有 Windows 防火墙提示，请允许专用网络访问。</p>',
    );
    const message = $('#pairing-message');
    let expires = 0;
    const invite = async () => {
      try {
        message.textContent = '正在准备电脑连接…';
        const invitation = await api('pairing/invite', {});
        if (!message.isConnected) return;
        const qr = qrcode(0, 'M');
        qr.addData(JSON.stringify(invitation));
        qr.make();
        const count = qr.getModuleCount(),
          border = 4;
        let path = '';
        for (let y = 0; y < count; y++)
          for (let x = 0; x < count; x++)
            if (qr.isDark(y, x)) path += `M${x + border} ${y + border}h1v1h-1z`;
        $('#pairing-qr').innerHTML =
          `<svg class="pairing-code" viewBox="0 0 ${count + border * 2} ${count + border * 2}" role="img" aria-label="手机配对二维码"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="black"/></svg>`;
        expires = invitation.expires;
        message.textContent = `请用手机星野记扫描二维码。电脑指纹：${invitation.fingerprint}`;
      } catch (e) {
        if (message.isConnected) message.textContent = e.message;
      }
    };
    $('#pairing-refresh').onclick = invite;
    await invite();
    let polling = false;
    const poll = setInterval(async () => {
      if (!message.isConnected || !getState()) {
        clearInterval(poll);
        return;
      }
      if (polling) return;
      polling = true;
      try {
        const status = await api('pairing/status?passive=1');
        if (!message.isConnected) return;
        if (expires && expires < Date.now()) {
          $('#pairing-qr').innerHTML = '';
          message.textContent = '二维码已过期，请点击刷新';
          expires = 0;
        }
        const pending = $('#pairing-pending');
        // Don't replace focused buttons on each poll.
        const signature = JSON.stringify(status.pending);
        if (pending.dataset.signature !== signature) {
          pending.dataset.signature = signature;
          pending.innerHTML = status.pending
            .map(
              (p) =>
                `<div class="notice section-space"><p>允许「${esc(p.name)}」同步日程、账单与加密日记？</p><p>来源：${esc(p.ip)} · 核对码：${esc(p.verificationCode)}。请确认手机显示相同的核对码。</p><div class="row-actions"><button class="button primary" data-pair-approve="${esc(p.id)}">允许配对</button><button class="button" data-pair-deny="${esc(p.id)}">拒绝</button></div></div>`,
            )
            .join('');
          pending.querySelectorAll('[data-pair-approve], [data-pair-deny]').forEach(
            (node) =>
              (node.onclick = async () => {
                node.disabled = true;
                try {
                  await api('pairing/approve', {
                    id: node.dataset.pairApprove || node.dataset.pairDeny,
                    allow: Boolean(node.dataset.pairApprove),
                  });
                  message.textContent = node.dataset.pairApprove
                    ? '配对成功，手机将自动同步。可刷新二维码连接下一台设备。'
                    : '已拒绝配对，可刷新二维码重试。';
                  $('#pairing-qr').innerHTML = '';
                  expires = 0;
                  await mount($('#device-panel'));
                } catch (e) {
                  message.textContent = e.message;
                  node.disabled = false;
                }
              }),
          );
        }
      } catch (e) {
        if (message.isConnected) message.textContent = e.message;
      } finally {
        polling = false;
      }
    }, 1500);
  }
  async function scan() {
    if (busy || !safe()) {
      toast('请先保存并关闭编辑内容、锁定手记，再连接设备');
      return;
    }
    busy = true;
    label('扫码后请在电脑确认', 'pending');
    try {
      await nativeRequest('pairing.resume');
      await nativeRequest('pairing.scan');
      failures = 0;
      nextAttempt = 0;
      conflict = false;
      label('配对成功 · 正在同步');
      await mount($('#device-panel'));
    } catch (e) {
      label('连接设备', 'local');
      toast(e.message, true);
    } finally {
      busy = false;
    }
    await run(false, true);
  }
  function showConflicts(result) {
    openModal(
      '处理同步冲突',
      `<p>以下内容在两端同时修改，请选择要保留的版本。</p><div id="pair-conflicts">${result.conflicts.map((c) => `<label>${c.type === 'diary' ? '加密日记' : esc(c.local?.title || c.remote?.title || c.local?.merchant || c.remote?.merchant || '删除与编辑冲突')}<select data-conflict="${esc(c.key)}"><option value="">请选择</option><option value="local">本机${c.local ? '版本' : '删除结果'}</option><option value="remote">电脑${c.remote ? '版本' : '删除结果'}</option></select></label>`).join('')}</div><p id="pair-conflict-error" class="form-error" role="alert"></p><button class="button primary" id="pair-conflict-save" disabled>确认合并</button>`,
    );
    const choices = {};
    $('#pair-conflicts')
      .querySelectorAll('select')
      .forEach(
        (node) =>
          (node.onchange = async () => {
            choices[node.dataset.conflict] = node.value;
            try {
              const preview = await offline.previewSync(choices);
              if ($('#pair-conflict-save'))
                $('#pair-conflict-save').disabled = Boolean(preview.conflicts.length);
            } catch (e) {
              if ($('#pair-conflict-error')) $('#pair-conflict-error').textContent = e.message;
            }
          }),
      );
    $('#pair-conflict-save').onclick = async () => {
      if (busy) return;
      busy = true;
      $('#pair-conflict-save').disabled = true;
      $('#close-modal').disabled = true;
      try {
        const preview = await offline.previewSync();
        if (!confirmDeletion(preview)) return;
        await offline.commitSync({ confirmDeletions: preview.deletion.needsConfirmation });
        conflict = false;
        failures = 0;
        $('#modal').close();
        $('#modal-body').innerHTML = '';
        await refresh();
        label('已同步', 'online');
      } catch (e) {
        if ($('#pair-conflict-error'))
          $('#pair-conflict-error').textContent = `${e.message}。关闭后点击顶部重新检查。`;
      } finally {
        busy = false;
        $('#close-modal').disabled = false;
        if ($('#pair-conflict-save')) $('#pair-conflict-save').disabled = false;
      }
    };
  }
  function confirmDeletion(preview) {
    return (
      !preview.deletion?.needsConfirmation ||
      confirm(
        `本次同步将删除电脑上的 ${preview.deletion.count} 条记录${preview.deletion.diaryDelete ? '，并删除加密日记' : ''}${preview.deletion.restoreCount ? `，恢复 ${preview.deletion.restoreCount} 条已删除记录` : ''}。系统会保留同步前副本。确认继续？`,
      )
    );
  }
  async function run(manual = false, force = false) {
    if (offline && !busy && getState() && !document.hidden && !canSync()) {
      label('编辑中 · 保存并关闭后同步', 'pending');
      return;
    }
    if (
      !offline ||
      busy ||
      !safe() ||
      (!manual && (conflict || (!force && Date.now() < nextAttempt)))
    )
      return;
    busy = true;
    const generation = getGeneration();
    try {
      if (pendingRefresh && safe()) {
        await refresh();
        pendingRefresh = false;
      }
      const status = await nativeRequest('pairing.status');
      if (!status.paired) {
        label('连接设备', 'local');
        if (manual) {
          busy = false;
          await scan();
        }
        return;
      }
      label('正在同步…');
      const result = await offline.connectPaired();
      if (!getState() || generation !== getGeneration() || !safe()) {
        label('等待编辑完成后同步', 'pending');
        return;
      }
      if (result.conflicts.length) {
        conflict = true;
        label('处理冲突', 'pending');
        if (manual) showConflicts(result);
        return;
      }
      if (!result.unchanged) {
        if (result.deletion.needsConfirmation && !manual) {
          label('同步变更待确认 · 点此查看', 'pending');
          return;
        }
        if (!confirmDeletion(result)) return;
        await offline.commitSync({ confirmDeletions: result.deletion.needsConfirmation });
        pendingRefresh = true;
      }
      if (pendingRefresh && safe() && generation === getGeneration()) {
        await refresh();
        pendingRefresh = false;
      }
      if (getState() && generation === getGeneration())
        label(pendingRefresh ? '已同步 · 保存编辑后更新' : '已同步', 'online');
      conflict = false;
      failures = 0;
      nextAttempt = Date.now() + 15000;
    } catch (e) {
      failures++;
      nextAttempt = Date.now() + Math.min(120000, 5000 * 2 ** Math.min(failures, 5));
      if (getState()) {
        label(message(e), 'offline');
        if (manual) toast(e.message, true);
      }
    } finally {
      busy = false;
    }
  }
  $('#modal')?.addEventListener('close', () => {
    if (conflict && !busy) {
      conflict = false;
      label('冲突待处理 · 点此重试', 'pending');
      nextAttempt = Date.now() + 15000;
    }
  });
  function start() {
    if (!offline || timer) return;
    timer = setInterval(() => run(), 15000);
    schedule();
  }
  function schedule(changed = false) {
    if (!offline) return;
    if (changed) nextAttempt = 0;
    clearTimeout(scheduled);
    scheduled = setTimeout(() => run(), 1200);
  }
  window.addEventListener('online', () => {
    nextAttempt = 0;
    run();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      nextAttempt = 0;
      run();
    }
  });
  return {
    mount,
    start,
    schedule,
    open: () => {
      if (!getState()) return;
      if (offline && !safe()) {
        toast('请先保存并关闭编辑内容、锁定手记，再同步');
        return;
      }
      return offline ? run(true, true) : desktop();
    },
    busy: () => busy,
  };
}
