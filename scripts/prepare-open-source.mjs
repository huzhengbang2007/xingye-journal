import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
} from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const metadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const output = resolve(root, 'outputs/open-source', `${metadata.version}-${Date.now()}`);
const source = resolve(output, 'xingye-journal');
const git = (args, cwd = root) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const allowedRoots = new Set([
  '.github',
  'android-companion',
  'docs',
  'examples',
  'fastlane',
  'lib',
  'native',
  'public',
  'scripts',
  'tests',
]);
const allowedFiles = new Set([
  '.gitignore',
  '.gitattributes',
  '.prettierignore',
  '.prettierrc.json',
  'LICENSE',
  'NOTICE',
  'package.json',
  'package-lock.json',
  'server.mjs',
  'start.cmd',
  'uninstall.cmd',
]);
const listed = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .split('\0')
  .filter(Boolean);
const files = {};
mkdirSync(source, { recursive: true });
for (const file of [...new Set(listed)].sort()) {
  const parts = file.replaceAll('\\', '/').split('/');
  if (
    !(
      allowedRoots.has(parts[0]) ||
      allowedFiles.has(file) ||
      (parts.length === 1 && extname(file) === '.md')
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
    parts.some((part) => part.startsWith('.env')) ||
    /\.(pfx|p12|keystore|jks|dpapi|vault|pem|zip|7z|xz|exe|apk|pdb)$/i.test(file) ||
    (/\.key$/i.test(file) && file !== 'tests/fixtures/device-test-only.key') ||
    (file.endsWith('.jar') && file !== 'android-companion/gradle/wrapper/gradle-wrapper.jar') ||
    file.endsWith('/local.properties')
  )
    throw new Error(`Forbidden public source path: ${file}`);
  const from = resolve(root, file);
  if (!existsSync(from)) continue;
  if (lstatSync(from).isSymbolicLink()) throw new Error(`Symlink requires review: ${file}`);
  const content = readFileSync(from);
  if (!/\.(png|ico|jar|cer)$/i.test(file) && file !== 'tests/fixtures/device-test-only.key') {
    const secret =
      /(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----)/;
    if (secret.test(content.toString('utf8')))
      throw new Error(`Potential secret in ${file}; manual review required`);
  }
  const to = resolve(source, file);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  files[file] = createHash('sha256').update(content).digest('hex');
}
for (const required of [
  'LICENSE',
  'NOTICE',
  'README.md',
  'THIRD-PARTY-NOTICES.md',
  'docs/PRIVACY.md',
  'package-lock.json',
  'native/Cargo.lock',
  'android-companion/gradle/wrapper/gradle-wrapper.jar',
  'public/index.html',
  'server.mjs',
]) {
  if (!files[required]) throw new Error(`Missing required public source file: ${required}`);
}
writeFileSync(resolve(source, '.gitattributes'), '* -text\n');
git(['init', '--initial-branch=main'], source);
git(['config', 'core.autocrlf', 'false'], source);
git(['add', '--all'], source);
git(
  [
    '-c',
    'user.name=HOSHINO TEAM',
    '-c',
    'user.email=build@hoshino.invalid',
    'commit',
    '-m',
    `Prepare Apache-2.0 open source release ${metadata.version}`,
  ],
  source,
);
const result = {
  source,
  output,
  version: metadata.version,
  files: Object.keys(files).length,
  commit: git(['rev-parse', 'HEAD'], source).trim(),
  originCommit: git(['rev-parse', 'HEAD']).trim(),
  originDirty: Boolean(git(['status', '--porcelain']).trim()),
  historyIncluded: false,
  scan: 'Known token patterns and private-key blocks; not a comprehensive security audit',
  hashes: files,
};
writeFileSync(resolve(output, 'SOURCE-REPORT.json'), JSON.stringify(result, null, 2) + '\n');
writeFileSync(
  resolve(root, 'outputs/open-source/latest.json'),
  JSON.stringify({ source, output }, null, 2) + '\n',
);
console.log(JSON.stringify({ source, output, files: result.files, commit: result.commit }));
