import { verifyRelease } from '../lib/release-integrity.mjs';
import { resolve } from 'node:path';
try {
  const info = verifyRelease(resolve(import.meta.dirname, '..'), { required: true });
  console.log(`Verified ${info.version}: HOSHINO TEAM; ${Object.keys(info.hashes).length} files`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
