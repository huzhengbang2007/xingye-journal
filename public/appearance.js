// Applied before styles load so a saved dark appearance never flashes a light page.
(() => {
  const root = document.documentElement;
  if (new URLSearchParams(location.search).get('view') === 'courses')
    root.dataset.courseWindow = 'true';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const themes = ['system', 'light', 'dark'];
  const read = (key, fallback) => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private browsing can block storage; the appearance still works for this visit.
    }
  };
  const validScale = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(145, Math.max(85, Math.round(number / 5) * 5)) : 100;
  };
  let preference = read('xingye.theme', 'system');
  if (!themes.includes(preference)) preference = 'system';
  let scale = 100;
  function apply() {
    const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    root.style.colorScheme = theme;
    root.style.setProperty('--reading-scale', String(scale / 100));
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#101620' : '#eef2f7');
    document.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === preference));
    });
    document.querySelectorAll('[data-reading-scale]').forEach((input) => {
      input.value = String(scale);
    });
    document.querySelectorAll('[data-reading-output]').forEach((output) => {
      output.value = `${scale}%`;
    });
    window.dispatchEvent(
      new CustomEvent('xingye:appearance-change', {
        detail: { theme: preference, resolvedTheme: theme, scale },
      }),
    );
  }
  apply();
  system.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'xingye.theme') {
      preference = themes.includes(event.newValue) ? event.newValue : 'system';
      apply();
    }
    if (event.key === 'xingye.reading-scale') {
      scale = 100;
      apply();
    }
  });
  function mount(container, id) {
    if (!container) return;
    const picker = document.createElement('details');
    picker.className = 'appearance-picker';
    picker.innerHTML = `<summary aria-label="外观与文字大小" title="外观与文字大小"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg><span class="appearance-label">外观</span></summary>
      <div class="appearance-menu"><h2>让空间适合你</h2><p>外观</p><div class="theme-choices" role="group" aria-label="配色方案"><button type="button" data-theme-choice="light">浅色</button><button type="button" data-theme-choice="dark">深色</button><button type="button" data-theme-choice="system">跟随系统</button></div></div>`;
    picker.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        preference = button.dataset.themeChoice;
        write('xingye.theme', preference);
        apply();
      });
    });
    container.prepend(picker);
  }
  document.addEventListener('DOMContentLoaded', () => {
    mount(document.querySelector('.topbar-actions'), 'workspace');
    mount(document.querySelector('.auth-panel'), 'welcome');
    apply();
    document.addEventListener('click', (event) => {
      document.querySelectorAll('.appearance-picker[open]').forEach((picker) => {
        if (!picker.contains(event.target)) picker.open = false;
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('.appearance-picker[open]').forEach((picker) => {
        picker.open = false;
        picker.querySelector('summary').focus();
      });
    });
  });
})();
