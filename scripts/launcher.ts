// Packaged entry point, bundled to dist/mediahub/mediahub.mjs by scripts/package.mjs.
//
// Usage: node --env-file=<config> mediahub.mjs
//
// Backs up the database when migrations are pending (or restores it after a rolled-back update, see
// src/server/db/update-safety.ts), applies pending migrations from the drizzle/ folder next to this file, then starts the
// Next.js standalone server (server.js, next to this file). preparePackagedRuntime() first copies
// MEDIAHUB_HOST and MEDIAHUB_PORT onto the HOSTNAME and PORT that server.js reads, and makes
// DATABASE_PATH absolute (server.js changes the working directory).
// Once the server has loaded, on Windows, it also runs the updater's stage 1 (tools/updater.mjs) about once a minute
// when a check is due. Stage 1 starts stage 2 outside this process (see src/server/updater/system.ts), so an update
// can stop the service.
// This file reads no env vars itself: env() does all config reading. Paths come from
// import.meta.url, so the folder works from any working directory.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openSqliteForMigration } from "../src/server/db";
import { applyMigrations } from "../src/server/db/migrate";
import { prepareDatabaseForStart } from "../src/server/db/update-safety";
import { env, preparePackagedRuntime, processEnvironment } from "../src/server/env";
import { childEnv, NIGHTLY_HOUR, shouldRunStage1 } from "../src/server/updater/loop";
import { localDate } from "../src/server/updater/schedule";
import { hasRequests } from "../src/server/updater/requests";

/**
 * Looks once a minute whether stage 1 of the updater should run: once 30 seconds after the server starts (so an
 * interrupted update is recovered), on a "check now" request, and once in the nightly hour. It never runs two at a
 * time. Stage 1 itself decides whether a check is due. A failure here never stops the server.
 * Only one short line is logged when a run can't start. Nothing from the environment is logged.
 */
function startUpdaterLoop(): void {
  if (process.platform !== "win32") return;
  const updater = fileURLToPath(new URL("./tools/updater.mjs", import.meta.url));
  if (!existsSync(updater)) return;
  const updatesDir = env().MEDIAHUB_UPDATES_DIR;
  if (!updatesDir) return;
  // This file is <APP>\app\mediahub.mjs.
  const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dataDir = path.dirname(updatesDir);
  const envFile = path.join(dataDir, "mediahub.env");
  const requestsDir = path.join(updatesDir, "requests");
  let running = false;
  let startup = true;
  let nightlyRanOn: string | null = null;

  const tick = () => {
    let child: ChildProcess;
    try {
      const now = new Date();
      if (!shouldRunStage1({ now, hasRequest: hasRequests(requestsDir), running, startup, nightlyRanOn })) return;
      startup = false;
      if (now.getHours() === NIGHTLY_HOUR) nightlyRanOn = localDate(now);
      // The env file is read at each start, and childEnv keeps the file's values from being overridden by the
      // inherited environment, so an edit to it applies without a service restart.
      // childEnv returns a plain dictionary; the cast only adds the NODE_ENV key that ProcessEnv requires here.
      const childEnvironment = childEnv(processEnvironment(), readFileSync(envFile, "utf8")) as NodeJS.ProcessEnv;
      child = spawn(process.execPath, [`--env-file=${envFile}`, updater, "--app-dir", appDir, "--data-dir", dataDir], {
        windowsHide: true,
        stdio: "ignore",
        env: childEnvironment,
      });
    } catch {
      console.error("mediahub: the updater check could not start.");
      return;
    }
    running = true;
    child.once("error", (error) => {
      running = false;
      console.error(`mediahub: the updater check could not start (${(error as NodeJS.ErrnoException).code ?? "error"}).`);
    });
    child.once("exit", () => {
      running = false;
    });
  };

  const first = setTimeout(tick, 30_000);
  first.unref();
  const timer = setInterval(tick, 60_000);
  timer.unref();
}

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
    startUpdaterLoop();
  } catch (error) {
    console.error(`mediahub: the server failed to start: ${error instanceof Error ? error.message : "unexpected error."}`);
    process.exitCode = 1;
  }
}

void main();
