// Diary plaintext and its second key exist only in this browser tab's memory.
const enc = new TextEncoder(),
  dec = new TextDecoder();
const b64 = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function diaryKey(password, salt) {
  if (password.length < 10 || password.length > 256)
    throw new Error('日记独立密码需要 10–256 个字符');
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptDiary(entries, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify({ entries }));
  if (plain.length > 3 * 1024 * 1024) throw new Error('日记超过当前 3 MB 容量，请整理后保存');
  const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  plain.fill(0);
  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 310000,
    salt: b64(salt),
    iv: b64(iv),
    body: b64(new Uint8Array(body)),
  };
}
export async function decryptDiary(envelope, key) {
  if (envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== 310000)
    throw new Error('日记版本不受支持');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes(envelope.iv) },
    key,
    bytes(envelope.body),
  );
  let result;
  try {
    result = JSON.parse(dec.decode(plain));
  } finally {
    new Uint8Array(plain).fill(0);
  }
  if (
    !Array.isArray(result.entries) ||
    result.entries.length > 5000 ||
    !result.entries.every(
      (e) =>
        typeof e.id === 'string' &&
        typeof e.title === 'string' &&
        typeof e.body === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.date),
    )
  )
    throw new Error('日记内容格式无效');
  return result.entries;
}

export function createDiary({
  api,
  esc,
  toast,
  today,
  storageLabel = () => '已加密保存 · 已协同到服务器',
}) {
  let key,
    salt,
    revision = null,
    entries = [],
    selected = null,
    dirty = false,
    lastUse = Date.now(),
    epoch = 0,
    busy = false;
  const $ = (s) => document.querySelector(s);
  function lock() {
    if (key && dirty) {
      capture();
      const draftKey = key,
        draftSalt = salt,
        draftEntries = structuredClone(entries),
        draftRevision = revision;
      encryptDiary(draftEntries, draftKey, draftSalt)
        .then((envelope) => {
          sessionStorage.setItem(
            'xingye.diary.encrypted-draft',
            JSON.stringify({ envelope, revision: draftRevision }),
          );
          toast('未保存手记已保留为本标签页加密草稿，重新解锁后可恢复');
        })
        .catch(() => toast('加密草稿保存失败，未保存手记已清除', true));
    }
    epoch++;
    key = null;
    salt = null;
    entries = [];
    selected = null;
    dirty = false;
    if ($('#diary-root')) mount();
  }
  function markup() {
    return `<div class="page-header"><div><span class="eyebrow">THE PART OF THE UNIVERSE THAT IS ONLY YOURS</span><h1>星野手记</h1><p>那些只想对自己说的话，放进第二把锁里。</p></div><span class="pill">独立密码 · 浏览器端加密</span></div><section id="diary-root" class="card diary-root"></section>`;
  }
  function markDirty() {
    dirty = true;
    lastUse = Date.now();
    $('#diary-save-state').textContent = '尚未保存';
  }
  function capture() {
    if (!key || !selected || !$('#diary-title')) return;
    const e = entries.find((x) => x.id === selected);
    e.title = $('#diary-title').value;
    e.date = $('#diary-date').value || today();
    e.body = $('#diary-body').value;
    e.mood = $('#diary-mood').value;
    e.updatedAt = new Date().toISOString();
  }
  function select(entryId) {
    if (dirty && !confirm('这篇日记还没有保存，放弃未保存的编辑？')) return;
    selected = entryId;
    dirty = false;
    mountUnlocked();
  }
  function mountUnlocked() {
    const root = $('#diary-root');
    if (!root || !key) return;
    const active = entries.find((e) => e.id === selected);
    root.innerHTML = `<div class="card-header"><div><h2>只有你，读得懂这里的星光。</h2><p class="card-subtitle">5 分钟无操作或离开手记时再次锁定，未保存内容会保留为本标签页的加密草稿。</p></div><button class="button small" id="diary-lock">锁上手记 ◇</button></div><div class="diary-layout"><aside class="diary-list"><button class="button primary wide" id="diary-new">＋ 写一篇手记</button>${
      entries
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(
          (e) =>
            `<button class="diary-entry ${e.id === selected ? 'active' : ''}" data-diary-id="${esc(e.id)}"><small>${esc(e.date)} · ${esc(e.mood || '平静')}</small><strong>${esc(e.title || '未命名手记')}</strong><span>${esc(e.body.slice(0, 38) || '留给自己的空白。')}</span></button>`,
        )
        .join('') || '<div class="empty">第一篇，写给今天的自己。</div>'
    }</aside><div class="diary-editor">${active ? `<form id="diary-editor-form"><div class="field-grid"><label>日期<input type="date" id="diary-date" value="${esc(active.date)}" required></label><label>此刻心情<select id="diary-mood">${['平静', '开心', '期待', '疲惫', '低落', '复杂'].map((m) => `<option ${m === active.mood ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div><input id="diary-title" class="diary-title" maxlength="120" placeholder="为这一页起个名字" value="${esc(active.title)}" aria-label="手记标题"><textarea id="diary-body" maxlength="80000" placeholder="今天，有什么想记住的？" aria-label="手记正文">${esc(active.body)}</textarea><div class="diary-editor-footer"><span id="diary-save-state">已载入 · 请及时保存</span><div class="row-actions"><button type="button" class="button danger small" id="diary-delete">删除</button><button class="button primary" id="diary-save" type="submit">加密保存 ✦</button></div></div></form>` : '<div class="diary-blank"><span>✧</span><h2>夜空很大，这一页只属于你。</h2><p>从左侧选择手记，或写下今天的第一行。</p></div>'}</div></div><div class="notice section-space">标题、日期、心情和正文一起二次加密，不进入 AI 提示词或月度复盘。独立密码遗失无法找回；加密备份包含手记密文。截图、键盘与已解锁浏览器的安全仍由设备本身负责。</div>`;
    $('#diary-lock').onclick = () => {
      if (!dirty || confirm('手记尚未保存。确定清除未保存内容并锁定？')) lock();
    };
    $('#diary-new').onclick = () => {
      if (dirty && !confirm('放弃当前未保存的编辑？')) return;
      const e = {
        id: crypto.randomUUID(),
        date: today(),
        title: '',
        body: '',
        mood: '平静',
        updatedAt: new Date().toISOString(),
      };
      entries.push(e);
      selected = e.id;
      dirty = true;
      mountUnlocked();
      $('#diary-title').focus();
      markDirty();
    };
    root
      .querySelectorAll('[data-diary-id]')
      .forEach((b) => (b.onclick = () => select(b.dataset.diaryId)));
    if (!active) return;
    $('#diary-editor-form').addEventListener('input', markDirty);
    $('#diary-editor-form').onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      capture();
      await save();
    };
    $('#diary-delete').onclick = async () => {
      if (!confirm('从全部设备的手记中删除这一篇？')) return;
      entries = entries.filter((e) => e.id !== selected);
      selected = null;
      dirty = true;
      if (await save()) mountUnlocked();
    };
  }
  async function save() {
    if (!key || busy) return false;
    busy = true;
    const generation = epoch;
    const button = $('#diary-save');
    if (button) button.disabled = true;
    try {
      const envelope = await encryptDiary(entries, key, salt);
      if (generation !== epoch) return false;
      const response = await api('diary/save', { envelope, revision });
      if (generation !== epoch) return false;
      revision = response.revision;
      sessionStorage.removeItem('xingye.diary.encrypted-draft');
      dirty = false;
      lastUse = Date.now();
      if ($('#diary-save-state')) $('#diary-save-state').textContent = storageLabel();
      document.querySelectorAll('[data-diary-id]').forEach((node) => {
        const e = entries.find((x) => x.id === node.dataset.diaryId);
        if (e) {
          node.querySelector('strong').textContent = e.title || '未命名手记';
          node.querySelector('span').textContent = e.body.slice(0, 38) || '留给自己的空白。';
          node.querySelector('small').textContent = e.date + ' · ' + (e.mood || '平静');
        }
      });
      toast('手记已二次加密保存');
      return true;
    } catch (error) {
      toast(error.message, true);
      return false;
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }
  async function mount() {
    if (key) return mountUnlocked();
    const root = $('#diary-root');
    if (!root) return;
    const generation = ++epoch;
    root.innerHTML = '<div class="empty">正在查看手记保险箱…</div>';
    try {
      const current = await api('diary');
      if (generation !== epoch || !$('#diary-root')) return;
      revision = current.revision;
      root.innerHTML = `<div class="diary-unlock"><div class="diary-lock-art">✧<small>PRIVATE ORBIT</small></div><span class="eyebrow">A SECOND KEY, A QUIETER SPACE</span><h2>${current.envelope ? '再解开一把，只属于你的锁。' : '给私密心事，设置第二把锁。'}</h2><p>日记密码独立于登录密码，建议使用不同的长密码。<br>加密和解密都在此设备完成。</p><form id="diary-unlock-form"><label>手记独立密码<input type="password" name="password" minlength="10" maxlength="256" autocomplete="off" required></label>${current.envelope ? '' : '<label>确认手记独立密码<input type="password" name="confirm" minlength="10" maxlength="256" autocomplete="off" required></label>'}<p class="form-error" id="diary-error" role="alert"></p><button class="button primary wide" type="submit">${current.envelope ? '解锁我的手记' : '创建二次加密手记'} ✧</button></form><p class="help-text section-space">独立密码不会发送到服务器，也没有找回入口。每次在另一台设备打开手记，都需要再次解锁。</p></div>`;
      $('#diary-unlock-form').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target,
          password = f.elements.password.value;
        if (!current.envelope && password !== f.elements.confirm.value) {
          $('#diary-error').textContent = '两次日记密码不一致';
          return;
        }
        const b = f.querySelector('button');
        b.disabled = true;
        try {
          if (!crypto.subtle) throw new Error('日记加密需要本机 localhost 或可信 HTTPS 连接');
          const localSalt = current.envelope
            ? bytes(current.envelope.salt)
            : crypto.getRandomValues(new Uint8Array(16));
          const localKey = await diaryKey(password, localSalt);
          let opened;
          try {
            opened = current.envelope ? await decryptDiary(current.envelope, localKey) : [];
          } catch {
            throw new Error('日记密码不正确或密文已损坏');
          }
          if (generation !== epoch) return;
          let recovered = false;
          const draftText = sessionStorage.getItem('xingye.diary.encrypted-draft');
          if (draftText) {
            try {
              const draft = JSON.parse(draftText);
              const draftKey = await diaryKey(password, bytes(draft.envelope.salt));
              const recoveredEntries = await decryptDiary(draft.envelope, draftKey);
              if (
                confirm(
                  '检测到未保存的加密手记草稿，恢复为待保存内容？服务器有新版本时将保留草稿为副本。',
                )
              ) {
                opened =
                  draft.revision === current.revision
                    ? recoveredEntries
                    : [
                        ...opened,
                        ...recoveredEntries.map((e) => ({
                          ...e,
                          id: crypto.randomUUID(),
                          title: e.title + '（恢复草稿）',
                        })),
                      ];
                recovered = true;
              }
            } catch {
              /* Another vault or password: retain the encrypted draft. */
            }
          }
          key = localKey;
          salt = localSalt;
          entries = opened;
          dirty = recovered;
          f.reset();
          lastUse = Date.now();
          if (!current.envelope && !(await save())) {
            key = null;
            return;
          }
          selected = entries[0]?.id || null;
          mountUnlocked();
        } catch (error) {
          if ($('#diary-error')) $('#diary-error').textContent = error.message;
        } finally {
          b.disabled = false;
        }
      };
    } catch (error) {
      if (generation === epoch && $('#diary-root'))
        root.innerHTML = `<div class="notice">${esc(error.message)}</div>`;
    }
  }
  document.addEventListener(
    'pointerdown',
    () => {
      if (key && $('#diary-root')) lastUse = Date.now();
    },
    { passive: true },
  );
  document.addEventListener('keydown', () => {
    if (key && $('#diary-root')) lastUse = Date.now();
  });
  setInterval(() => {
    if (key && Date.now() - lastUse >= 5 * 60000) {
      lock();
      toast('手记已自动二次锁定');
    }
  }, 10000);
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  return {
    markup,
    mount,
    lock,
    isUnlocked: () => Boolean(key),
    isDirty: () => dirty,
    canLeave: () => !dirty || confirm('手记尚未保存。离开会清除未保存内容，确定继续？'),
  };
}
