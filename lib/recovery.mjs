import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const pattern = /^before-(device-sync|restore)-\d{13}-[a-f0-9]{8}\.vault$/;
export function recoveryFiles(directory) {
  return readdirSync(directory)
    .filter((name) => pattern.test(name))
    .sort()
    .reverse();
}
export function saveRecovery(directory, vault, reason) {
  if (!['device-sync', 'restore'].includes(reason)) throw new Error('Invalid recovery reason');
  const bytes = readFileSync(vault);
  const history = recoveryFiles(directory).filter((f) => f.startsWith(`before-${reason}-`));
  const timestamp = Math.max(
    Date.now(),
    ...history.map((f) => Number(f.match(/-(\d{13})-/)[1]) + 1),
  );
  const name = `before-${reason}-${timestamp}-${randomBytes(4).toString('hex')}.vault`;
  writeFileSync(resolve(directory, name), bytes, { mode: 0o600, flag: 'wx' });
  // Preserve the previous single-slot file for older recovery instructions.
  const legacy = resolve(directory, `before-${reason}.vault`);
  if (existsSync(legacy) && history.length === 0) {
    const migrated = `before-${reason}-${timestamp - 1}-${randomBytes(4).toString('hex')}.vault`;
    writeFileSync(resolve(directory, migrated), readFileSync(legacy), { mode: 0o600, flag: 'wx' });
  }
  writeFileSync(legacy, bytes, { mode: 0o600 });
  for (const old of recoveryFiles(directory)
    .filter((f) => f.startsWith(`before-${reason}-`))
    .slice(5))
    unlinkSync(resolve(directory, old));
}
