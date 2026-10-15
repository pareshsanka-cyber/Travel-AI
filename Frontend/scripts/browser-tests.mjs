import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const installing = process.argv.includes('--install');
if (!installing) {
  const build = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'build'], { stdio:'inherit' });
  if (build.error || build.status !== 0) process.exit(build.status || 1);
}
const args = installing ? ['install', 'chromium'] : ['test', ...process.argv.slice(2)];
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url)), ...args], {
  stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
});
if (result.error) { process.stderr.write(result.error.message + '\n'); process.exit(1); }
process.exit(result.status ?? 1);
