import {
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  existsSync,
  copyFileSync,
} from 'node:fs';
// Atomic replacement with a durable file and one previous encrypted generation.
export function durableWrite(path, content) {
  const temporary = path + '.tmp';
  const fd = openSync(temporary, 'w', 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (existsSync(path)) copyFileSync(path, path + '.previous');
  renameSync(temporary, path);
}
export function createLoginLimiter({ limit = 5, delay = 60000, now = Date.now } = {}) {
  const sources = new Map();
  function prune() {
    for (const [key, row] of sources) if (now() - row.at >= delay) sources.delete(key);
  }
  return {
    blocked(source) {
      prune();
      return (sources.get(source)?.failures || 0) >= limit;
    },
    fail(source) {
      prune();
      if (sources.size >= 1024 && !sources.has(source)) sources.delete(sources.keys().next().value);
      const row = sources.get(source) || { failures: 0, at: now() };
      row.failures++;
      sources.set(source, row);
    },
    clear(source) {
      sources.delete(source);
    },
  };
}
export function streamWrite(stream, message) {
  if (stream.destroyed || stream.writableEnded) return false;
  try {
    if (!stream.write(message)) {
      stream.end();
      return false;
    }
    return true;
  } catch {
    stream.destroy();
    return false;
  }
}
