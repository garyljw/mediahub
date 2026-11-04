// Packaged entry point, bundled to dist/mediahub/mediahub.mjs by scripts/package.mjs.
//
// Usage: node --env-file=<config> mediahub.mjs
//
// Backs up the database when migrations are pending (or restores it after a rolled-back update, see
// src/server/db/update-safety.ts), applies pending migrations from the drizzle/ folder next to this file, then starts the
// Next.js standalone server (server.js, next to this file). preparePackagedRuntime() first copies
// MEDIAHUB_HOST and MEDIAHUB_PORT onto the HOSTNAME and PORT that server.js reads, and makes
// DATABASE_PATH absolute (server.js changes the working directory).
// This file reads no env vars itself: env() does all config reading. Paths come from
// import.meta.url, so the folder works from any working directory.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openSqliteForMigration } from "../src/server/db";
import { applyMigrations } from "../src/server/db/migrate";
import { prepareDatabaseForStart } from "../src/server/db/update-safety";
import { env, preparePackagedRuntime } from "../src/server/env";

async function main() {
  try {
    preparePackagedRuntime();
    // Backs up the database before a migration, or restores that copy after a rolled-back update.
    await prepareDatabaseForStart({
      open: openSqliteForMigration,
      dbPath: path.resolve(env().DATABASE_PATH),
      updatesDir: env().MEDIAHUB_UPDATES_DIR,
      now: new Date(),
      log: (message) => console.log(`mediahub: ${message}`),
    });
    applyMigrations(fileURLToPath(new URL("./drizzle", import.meta.url)));
  } catch (error) {
    // Print only the message, as scripts/migrate.ts does. Config errors list variable names, never values.
    console.error(`mediahub: ${error instanceof Error ? error.message : "unexpected error."}`);
    process.exitCode = 1;
    return;
  }
  console.log("Migrations applied.");
  try {
    // Loaded by a computed URL so the bundler leaves it alone: server.js is copied next to this file, not bundled.
    await import(pathToFileURL(fileURLToPath(new URL("./server.js", import.meta.url))).href);
  } catch (error) {
    console.error(`mediahub: the server failed to start: ${error instanceof Error ? error.message : "unexpected error."}`);
    process.exitCode = 1;
  }
}

void main();
