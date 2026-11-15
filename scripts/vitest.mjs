// Runs Vitest with an upper-case drive letter. On Windows, VS Code's terminal
// starts in "c:\..." while Vitest resolves test files under "C:\...". The test
// workers then load two copies of Vitest and every suite fails with
// "Cannot read properties of undefined (reading 'config')". Normalising inside
// vitest.config.mts is too late: Vitest is already loaded by then.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const upperDrive = (p) => p.replace(/^[a-z]:/, (d) => d.toUpperCase());

const cwd = upperDrive(process.cwd());
const bin = upperDrive(fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)));
const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: "inherit" });
if (result.error) {
  console.error(`Could not start Vitest: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  console.error(`Vitest was stopped by ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
