if (window.__XINGYE_NATIVE__ && window.__TAURI_INTERNALS__) {
  document.documentElement.dataset.nativeDesktop = 'true';
  const ready = () => {
    window.addEventListener('xingye:service-stopped', () => {
      if (document.getElementById('service-stopped-notice')) return;
      const notice = document.createElement('div');
      notice.id = 'service-stopped-notice';
      notice.className = 'notice warn';
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;top:64px;left:16px;right:16px;z-index:10000';
      notice.textContent =
        '本机服务已停止。请先复制尚未保存的文字，再关闭并重新打开星野记。已成功保存的记录仍在本机。';
      document.body.append(notice);
    });
    const titlebar = document.createElement('div');
    titlebar.className = 'native-titlebar';
    titlebar.innerHTML =
      '<span class="native-drag">✦ 星野记<span>我的生活空间</span></span><div class="native-window-actions"><button type="button" data-window="minimize" aria-label="最小化">−</button><button type="button" data-window="maximize" aria-label="最大化或还原">□</button><button type="button" data-window="close" aria-label="关闭窗口">×</button></div>';
    const invoke = (action) =>
      window.__TAURI_INTERNALS__.invoke('window_action', { action }).catch(() => {});
    window.XingyeDesktop = { courses: () => invoke('courses') };
    const syncTheme = () =>
      invoke(document.documentElement.dataset.theme === 'dark' ? 'theme-dark' : 'theme-light');
    window.addEventListener('xingye:appearance-change', syncTheme);
    syncTheme();
    titlebar.querySelector('.native-drag').addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.detail === 1) invoke('drag');
    });
    titlebar.querySelector('.native-drag').addEventListener('dblclick', () => invoke('maximize'));
    titlebar.addEventListener('click', (e) => {
      const button = e.target.closest('[data-window]');
      if (button) invoke(button.dataset.window);
    });
    document.body.prepend(titlebar);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
}
