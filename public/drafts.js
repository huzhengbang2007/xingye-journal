// Only ciphertext survives a lock or reload; the key lives in this tab's memory.
const encoder = new TextEncoder();
const encode = (bytes) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
};
const decode = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export function createFormDrafts({
  storage = sessionStorage,
  changed = () => {},
  failed = () => {},
} = {}) {
  const slot = 'xingye.forms.encrypted.v1';
  let key = null,
    records = {},
    queue = Promise.resolve(),
    epoch = 0,
    unlockGeneration = 0;
  const id = (meta) => `${meta.kind}:${meta.id || 'new'}`;
  function persist() {
    const snapshot = JSON.stringify(records),
      activeKey = key,
      generation = epoch;
    if (!activeKey) return;
    queue = queue
      .then(async () => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          activeKey,
          encoder.encode(snapshot),
        );
        // A lock may clear the in-memory key while this last write finishes.
        if (generation !== epoch) return;
        const old = JSON.parse(storage.getItem(slot));
        storage.setItem(
          slot,
          JSON.stringify({
            salt: old.salt,
            iv: encode(iv),
            ciphertext: encode(new Uint8Array(ciphertext)),
          }),
        );
      })
      .catch(() => failed('草稿保存失败，请保留当前输入并尽快保存。'));
  }
  return {
    async unlock(password) {
      const generation = ++unlockGeneration;
      await queue;
      let envelope;
      try {
        envelope = JSON.parse(storage.getItem(slot));
      } catch {}
      const salt = envelope?.salt
        ? decode(envelope.salt)
        : crypto.getRandomValues(new Uint8Array(16));
      const material = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      const openedKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      let openedRecords = {};
      if (envelope?.ciphertext) {
        try {
          openedRecords = JSON.parse(
            new TextDecoder().decode(
              await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: decode(envelope.iv) },
                openedKey,
                decode(envelope.ciphertext),
              ),
            ),
          );
        } catch {
          if (generation !== unlockGeneration) return;
          key = null;
          records = {};
          failed('旧草稿无法解密，已保留原密文。');
          return;
        }
      }
      if (generation !== unlockGeneration) return;
      if (!envelope?.ciphertext) storage.setItem(slot, JSON.stringify({ salt: encode(salt) }));
      key = openedKey;
      records = openedRecords;
      epoch++;
      changed();
    },
    lock() {
      unlockGeneration++;
      key = null;
      records = {};
      changed();
    },
    list: () => Object.entries(records).map(([token, record]) => ({ token, ...record })),
    bind(form, meta) {
      form.dataset.draftToken = id(meta);
      const capture = () => {
        if (!key) return;
        const values = {};
        for (const field of form.elements) {
          if (!field.name || field.type === 'password' || field.type === 'file') continue;
          values[field.name] = field.type === 'checkbox' ? field.checked : field.value;
        }
        records[id(meta)] = { ...meta, values, updatedAt: new Date().toISOString() };
        form.dataset.dirty = 'true';
        persist();
        changed();
      };
      form.addEventListener('input', capture);
      form.addEventListener('change', capture);
    },
    remove(token) {
      delete records[token];
      persist();
      changed();
    },
    async settled() {
      await queue;
    },
  };
}
