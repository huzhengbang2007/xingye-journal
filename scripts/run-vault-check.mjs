import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--test', 'tests/native-vault.test.mjs'], {
  env: { ...process.env, XINGYE_REQUIRE_VAULT_HELPER: '1' },
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
