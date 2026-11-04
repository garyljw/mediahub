// Packaged copy of `npm run db:migrate`, bundled to dist/mediahub/tools/migrate.mjs by scripts/package.mjs.
// Same behaviour as scripts/migrate.ts, but resolves drizzle/ from this file's location (../drizzle),
// so it works from any working directory.
//
// Usage: node --env-file=<config> tools/migrate.mjs

import { fileURLToPath } from "node:url";
import { applyMigrations } from "../src/server/db/migrate";

try {
  applyMigrations(fileURLToPath(new URL("../drizzle", import.meta.url)));
  console.log("Migrations applied.");
} catch (error) {
  // Print only the message. Config errors list variable names, never values.
  console.error(`db:migrate: ${error instanceof Error ? error.message : "unexpected error."}`);
  process.exitCode = 1;
}
