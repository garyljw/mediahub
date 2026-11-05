// Packaged auto-updater, bundled to dist/mediahub/tools/updater.mjs by scripts/package.mjs.
// It must not import the database: the updater runs from its own copy of node.exe in the updates folder.
//
// The launcher (scripts/launcher.ts, the service's own process) runs stage 1 about once a minute when it is due:
//   node --env-file=<config> tools/updater.mjs --app-dir <APP> --data-dir <DATA>
// Stage 1 checks GitHub and downloads a verified update when one is due. It then copies node and this script into
// <DATA>\updates\run, leaves run\job.json there, and starts stage 2 through WMI (see startStage2 in
// src/server/updater/system.ts). Stage 2 runs as:
//   node --env-file=<DATA>\mediahub.env <DATA>\updates\run\updater.mjs --stage2 --app-dir <APP> --data-dir <DATA>
// It runs outside the service's process tree, so it survives the service being stopped. Stage 1 then exits, so
// <APP>\node.exe is free. Nothing in Task Scheduler is used.
// --check-only checks GitHub once, writes the status file, and never installs (the release workflow uses it).
//
// This is the only file that reads paths from the command line. The config comes from env().

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { env } from "../src/server/env";
import { download, fetchReleases } from "../src/server/updater/github";
import { createLogger } from "../src/server/updater/log";
import { UPDATE_PUBLIC_KEY_PEM } from "../src/server/updater/public-key";
import { checkRelease, readInstalledVersion, readJob, runStage1, runStage2, type UpdaterContext } from "../src/server/updater/run";
import { createWindowsSystem } from "../src/server/updater/system";

function absolutePath(value: string | undefined, name: string): string {
  if (!value || !path.isAbsolute(value)) throw new Error(`--${name} is required and must be an absolute path.`);
  return value;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    strict: true,
    options: {
      "app-dir": { type: "string" },
      "data-dir": { type: "string" },
      "check-only": { type: "boolean" },
      stage2: { type: "boolean" },
    },
    args: process.argv.slice(2),
  });
  const appDir = absolutePath(values["app-dir"], "app-dir");
  const dataDir = absolutePath(values["data-dir"], "data-dir");
  const config = env();
  const updDir = path.join(dataDir, "updates");
  mkdirSync(updDir, { recursive: true });

  const ctx: UpdaterContext = {
    appDir,
    dataDir,
    updDir,
    installedVersion: readInstalledVersion(appDir),
    publicKeyPem: UPDATE_PUBLIC_KEY_PEM,
    system: createWindowsSystem(appDir, dataDir),
    net: { fetchReleases, download },
    log: createLogger(path.join(updDir, "updater.log")),
    now: () => new Date(),
  };

  try {
    if (values.stage2) {
      await runStage2(ctx, readJob(updDir));
      return 0;
    }

    if (values["check-only"]) {
      const outcome = await checkRelease(ctx, { manual: true, nightlyDate: null });
      return outcome.kind === "failed" ? 1 : 0;
    }

    const result = await runStage1(ctx, {
      checkOnly: false,
      autoUpdate: config.MEDIAHUB_AUTO_UPDATE,
      scriptPath: fileURLToPath(import.meta.url),
    });
    return result.kind === "failed" ? 1 : 0;
  } catch (error) {
    ctx.log(`Updater stopped: ${error instanceof Error ? error.message : "unknown error"}`);
    return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Argument and config errors happen before the log exists, so they go to stderr.
    console.error(`updater: ${error instanceof Error ? error.message : "unexpected error."}`);
    process.exitCode = 1;
  },
);
