import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const metadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const destination = resolve(root, 'tmp', `source-${metadata.version}-${Date.now()}`);
const git = (args, cwd = root) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const listed = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .split('\0')
  .filter(Boolean);
const roots = new Set([
  '.github',
  'docs',
  'fastlane',
  'android-companion',
  'examples',
  'lib',
  'native',
  'public',
  'scripts',
  'tests',
]);
const hashes = {};
mkdirSync(destination, { recursive: false });
for (const file of [...new Set(listed)].sort()) {
  if (!existsSync(resolve(root, file))) continue;
  const parts = file.replaceAll('\\', '/').split('/');
  if (
    !(
      roots.has(parts[0]) ||
      (parts.length === 1 &&
        (['.gitignore', '.prettierignore', '.prettierrc.json', 'LICENSE', 'NOTICE'].includes(
          file,
        ) ||
          ['.md', '.json', '.cmd', '.txt', '.mjs'].includes(extname(file))))
    )
  )
    continue;
  if (
    parts.some((part) =>
      ['.git', '.signing', '.gradle', 'node_modules', 'target', 'gen', 'build'].includes(part),
    )
  )
    continue;
  if (
    /\.(pfx|p12|keystore|dpapi|vault|pem)$/i.test(file) ||
    (/\.key$/i.test(file) && file !== 'tests/fixtures/device-test-only.key')
  )
    throw new Error(`Private-looking source file excluded: ${file}`);
  const target = resolve(destination, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, file), target);
  hashes[file] = createHash('sha256').update(readFileSync(target)).digest('hex');
}
for (const required of [
  'server.mjs',
  'package.json',
  'start.cmd',
  'public/index.html',
  'native/Cargo.lock',
  'scripts/packaging/publisher.json',
  'android-companion/app/build.gradle',
]) {
  if (!hashes[required]) throw new Error(`Release source snapshot is missing ${required}`);
}
writeFileSync(resolve(destination, '.gitattributes'), '* -text\n');
writeFileSync(
  resolve(destination, 'SOURCE-ORIGIN.json'),
  JSON.stringify(
    {
      version: metadata.version,
      publisher: 'HOSHINO TEAM',
      originCommit: git(['rev-parse', 'HEAD']).trim(),
      originDirty: Boolean(git(['status', '--porcelain', '--untracked-files=all']).trim()),
      files: hashes,
    },
    null,
    2,
  ) + '\n',
);
git(['init', '--initial-branch=codex/release-' + metadata.version], destination);
git(['config', 'core.autocrlf', 'false'], destination);
git(['add', '--all'], destination);
git(
  [
    '-c',
    'user.name=HOSHINO TEAM',
    '-c',
    'user.email=build@hoshino.invalid',
    'commit',
    '-m',
    `Release source snapshot ${metadata.version}`,
  ],
  destination,
);
if (git(['status', '--porcelain', '--untracked-files=all'], destination).trim())
  throw new Error('Snapshot is not clean');
const result = {
  root: destination,
  commit: git(['rev-parse', 'HEAD'], destination).trim(),
  version: metadata.version,
  files: Object.keys(hashes).length,
};
mkdirSync(resolve(root, 'artifacts', metadata.version), { recursive: true });
writeFileSync(
  resolve(root, 'artifacts', metadata.version, 'source-snapshot.json'),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
