import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : /\.(mjs|js)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}
for (const file of [
  join(root, 'server.mjs'),
  ...['lib', 'public', 'tests', 'scripts'].flatMap((d) => walk(join(root, d))),
]) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(1);
  }
}
console.log('JavaScript syntax checks passed.');
