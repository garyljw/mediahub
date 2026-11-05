import "server-only";
import { createHash } from "node:crypto";
import { createReadStream, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { verifyManifest } from "./manifest";
import { pickRelease, type Release } from "./releases";
import { hasRequests, takeRequests } from "./requests";
import { decide } from "./schedule";
import { readStatus, writeStatus, type LastResult, type Status } from "./status";

/** Windows actions. The real ones are in system.ts; tests pass a fake. */
export interface System {
  /** Runs `MediaHub.exe stopwait` and confirms the service reports STOPPED. Throws when it does not. */
  stopService(): Promise<void>;
  /** Starts the service. Used only when an update could not start and nothing was changed. */
  startService(): Promise<void>;
  /** Runs an Inno Setup installer silently with /UPDATER. Resolves with its exit code (-1 if it did not exit normally). */
  runInstaller(exe: string, logFile: string): Promise<number>;
  /** True when the installed build-info reports `expectVersion` and the login page answers 200 within the timeout. */
  waitHealthy(expectVersion: string, timeoutMs: number): Promise<boolean>;
  /**
   * Starts <UPD>\run\node.exe with updater.mjs --stage2 outside this process tree, so stopping the service can't kill it.
   * Throws when the process could not be started.
   */
  startStage2(): Promise<void>;
}

export interface Net {
  fetchReleases(): Promise<Release[]>;
  download(url: string, dest: string, maxBytes: number): Promise<{ sha256: string; size: number }>;
}

export interface UpdaterContext {
  appDir: string;
  dataDir: string;
  /** <DATA>\updates */
  updDir: string;
  installedVersion: string;
  publicKeyPem: string;
  system: System;
  net: Net;
  log: (message: string) => void;
  now: () => Date;
}

/** The file in the updates folder that asks the launcher to restore its pre-update database backup. */
export const RESTORE_MARKER_NAME = "restore-db.json";

// Longer than a stage 2 run can take, so a live stage 2 always holds a fresh lock. Stage 2 stops the service (up to
// about 3 minutes, see system.ts), runs the installer (15-minute limit), waits for the new version (2 minutes), and
// if it rolls back, does the same again. That is about 40 minutes at most.
const LOCK_MAX_AGE_MS = 70 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 120_000;
const MANIFEST_MAX_BYTES = 64 * 1024;

const buildInfoSchema = z.object({ version: z.string().min(1) });

/** The installed version, from <APP>\app\build-info.json. Throws when it is missing or invalid. */
export function readInstalledVersion(appDir: string): string {
  return buildInfoSchema.parse(JSON.parse(readFileSync(path.join(appDir, "app", "build-info.json"), "utf8"))).version;
}

function paths(updDir: string) {
  return {
    status: path.join(updDir, "status.json"),
    lock: path.join(updDir, "update.lock"),
    requests: path.join(updDir, "requests"),
    downloads: path.join(updDir, "downloads"),
    run: path.join(updDir, "run"),
    installers: path.join(updDir, "installers"),
    restoreMarker: path.join(updDir, RESTORE_MARKER_NAME),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function setResult(status: Status, kind: LastResult["kind"], version: string | null, message: string, now: Date): void {
  status.lastResult = { kind, version, at: now.toISOString(), message };
}

/** True when a lock is younger than LOCK_MAX_AGE_MS. An older lock is removed (its updater must have died). */
function lockIsFresh(lockPath: string, now: Date): boolean {
  let mtime: number;
  try {
    mtime = statSync(lockPath).mtimeMs;
  } catch {
    return false;
  }
  if (now.getTime() - mtime < LOCK_MAX_AGE_MS) return true;
  rmSync(lockPath, { force: true });
  return false;
}

export interface ReadyUpdate {
  version: string;
  manifestPath: string;
  sigPath: string;
  installerPath: string;
}

export type CheckOutcome = { kind: "none" } | { kind: "failed" } | { kind: "ready"; update: ReadyUpdate };

/**
 * Stage 1, steps 3 and 4: list releases, pick one, download and verify it. Writes the status file.
 * Never installs anything. The nightly date is recorded unless the release list could not be read, so a
 * network failure at 03:00 is retried later in the hour (see decide), but a release that fails to verify is not
 * downloaded again all night.
 */
export async function checkRelease(
  ctx: UpdaterContext,
  input: { manual: boolean; nightlyDate: string | null },
): Promise<CheckOutcome> {
  const p = paths(ctx.updDir);
  const now = ctx.now();
  const status = readStatus(p.status, ctx.installedVersion);
  status.installedVersion = ctx.installedVersion;
  status.lastCheckAt = now.toISOString();
  status.state = "checking";
  writeStatus(p.status, status);

  const fail = (version: string | null, message: string): CheckOutcome => {
    setResult(status, "check-failed", version, message, now);
    status.state = "idle";
    writeStatus(p.status, status);
    return { kind: "failed" };
  };

  let releases: Release[];
  try {
    releases = await ctx.net.fetchReleases();
  } catch (error) {
    ctx.log(`Release check failed: ${errorMessage(error)}`);
    return fail(null, "Could not read the release list from GitHub.");
  }
  if (input.nightlyDate) status.lastNightlyDate = input.nightlyDate;

  const picked = pickRelease(releases, ctx.installedVersion, status.skipped, input.manual);
  if (!picked) {
    status.latestVersion = null;
    setResult(status, "up-to-date", null, `MediaHub ${ctx.installedVersion} is up to date.`, now);
    status.state = "idle";
    writeStatus(p.status, status);
    return { kind: "none" };
  }

  const version = picked.version;
  const dir = path.join(p.downloads, version);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, "update-manifest.json");
  const sigPath = path.join(dir, "update-manifest.json.sig");
  const installerPath = path.join(dir, picked.installerName);
  try {
    await ctx.net.download(picked.manifestUrl, manifestPath, MANIFEST_MAX_BYTES);
    await ctx.net.download(picked.sigUrl, sigPath, MANIFEST_MAX_BYTES);
    const manifest = verifyManifest(readFileSync(manifestPath), readFileSync(sigPath, "utf8"), ctx.publicKeyPem, version);
    const installer = await ctx.net.download(picked.installerUrl, installerPath, manifest.size);
    if (installer.size !== manifest.size || installer.sha256 !== manifest.sha256) {
      throw new Error("The installer does not match the update manifest.");
    }
  } catch (error) {
    ctx.log(`Update ${version} rejected: ${errorMessage(error)}`);
    rmSync(dir, { recursive: true, force: true });
    return fail(version, `Update ${version} could not be downloaded or verified.`);
  }

  status.latestVersion = version;
  status.state = "idle";
  writeStatus(p.status, status);
  return { kind: "ready", update: { version, manifestPath, sigPath, installerPath } };
}

export type Stage1Result =
  | { kind: "idle" }
  | { kind: "checked" }
  | { kind: "failed" }
  | { kind: "launch" };

export interface Stage1Options {
  checkOnly: boolean;
  autoUpdate: boolean;
  /** This script (tools/updater.mjs), copied into the run folder. */
  scriptPath: string;
}

/**
 * Stage 1, run by the launcher (see scripts/launcher.ts). Returns "launch" once the lock is taken, the run folder
 * (with job.json) is ready and stage 2 has been started; this process then exits.
 * --check-only always checks, never installs and never launches.
 */
export async function runStage1(ctx: UpdaterContext, options: Stage1Options): Promise<Stage1Result> {
  const p = paths(ctx.updDir);
  const now = ctx.now();
  let outcome: CheckOutcome;

  if (options.checkOnly) {
    outcome = await checkRelease(ctx, { manual: true, nightlyDate: null });
  } else {
    if (lockIsFresh(p.lock, now)) return { kind: "idle" };
    // No updater is running. Leftovers from the last update go: the run folder (a copy of node.exe and an
    // installer) can't be removed by the stage 2 that runs from it.
    // The restore marker is left alone: it expires by itself (see src/server/db/update-safety.ts).
    // Best effort: a stage 2 that has just removed the lock may still be running from run\node.exe.
    try {
      if (existsSync(p.run)) rmSync(p.run, { recursive: true, force: true });
    } catch (error) {
      ctx.log(`Could not clear the run folder yet: ${errorMessage(error)}`);
    }
    const status = readStatus(p.status, ctx.installedVersion);
    // A state other than idle with no updater running means the last one was killed (time limit, power cut).
    if (status.state !== "idle") {
      ctx.log(`The last updater run stopped while ${status.state}.`);
      if (status.state === "installing") {
        // The service may have been left stopped.
        await ctx.system.startService().catch((e: unknown) => ctx.log(`Could not start the service: ${errorMessage(e)}`));
      }
      status.state = "idle";
      setResult(status, "failed", status.latestVersion, "The last update check or install was interrupted.", now);
      writeStatus(p.status, status);
    }
    const input = {
      now,
      lastNightlyDate: status.lastNightlyDate,
      lastCheckAt: status.lastCheckAt,
      autoUpdate: options.autoUpdate,
    };
    // A request is only taken (removed) when it will be acted on, so one that comes too soon waits for later.
    // An entry that can't be removed doesn't count, so it can't cause a check every few minutes.
    let decision = decide({ ...input, hasRequest: hasRequests(p.requests) });
    if (decision.manual && !takeRequests(p.requests, ctx.log)) decision = decide({ ...input, hasRequest: false });
    if (!decision.check) return { kind: "idle" };
    outcome = await checkRelease(ctx, { manual: decision.manual, nightlyDate: decision.nightlyDate });
  }

  if (outcome.kind === "none") return { kind: "checked" };
  if (outcome.kind === "failed") return { kind: "failed" };
  if (options.checkOnly) return { kind: "checked" };

  // Stage 2 runs from a copy of node and this script, so the app folder can be replaced under it. It is started
  // outside this process (see startStage2), so this process can exit and release <APP>\node.exe.
  const { update } = outcome;
  rmSync(p.run, { recursive: true, force: true });
  mkdirSync(p.run, { recursive: true });
  copyFileSync(path.join(ctx.appDir, "node.exe"), path.join(p.run, "node.exe"));
  copyFileSync(options.scriptPath, path.join(p.run, "updater.mjs"));
  const rollbackName = `MediaHub-Setup-${ctx.installedVersion}.exe`;
  const rollbackSource = path.join(p.installers, rollbackName);
  let rollbackInstallerPath: string | null = null;
  if (existsSync(rollbackSource)) {
    rollbackInstallerPath = path.join(p.run, rollbackName);
    copyFileSync(rollbackSource, rollbackInstallerPath);
  }
  const job: Stage2Args = {
    version: update.version,
    installerPath: update.installerPath,
    manifestPath: update.manifestPath,
    sigPath: update.sigPath,
    rollbackInstallerPath,
  };
  writeFileSync(path.join(p.run, JOB_FILE), `${JSON.stringify(job, null, 2)}\n`);
  // wx: fails if another updater already holds the lock.
  writeFileSync(p.lock, `${ctx.now().toISOString()}\n`, { flag: "wx" });
  // Marked before stage 2 starts, so a stage 2 that never runs shows up as interrupted once the lock is stale.
  const status = readStatus(p.status, ctx.installedVersion);
  status.state = "installing";
  writeStatus(p.status, status);
  try {
    await ctx.system.startStage2();
  } catch (error) {
    ctx.log(`Could not start the install step: ${errorMessage(error)}`);
    rmSync(p.lock, { force: true });
    status.state = "idle";
    setResult(status, "failed", update.version, `Update ${update.version} was downloaded but the install step did not start. Nothing was changed.`, ctx.now());
    writeStatus(p.status, status);
    return { kind: "failed" };
  }
  return { kind: "launch" };
}

const JOB_FILE = "job.json";

const jobSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/),
  installerPath: z.string(),
  manifestPath: z.string(),
  sigPath: z.string(),
  rollbackInstallerPath: z.string().nullable(),
});

const ROLLBACK_NAME = /^MediaHub-Setup-\d+\.\d+\.\d+(?:-(?:rc|dev)\.\d+)?\.exe$/;

/**
 * The job stage 1 left for stage 2 in <UPD>\run\job.json. Only SYSTEM and Administrators can write there. Every
 * path must still be exactly where stage 1 puts it: the update in downloads\<version>\, and the previous
 * installer in run\.
 */
export function readJob(updDir: string): Stage2Args {
  const p = paths(updDir);
  const job = jobSchema.parse(JSON.parse(readFileSync(path.join(p.run, JOB_FILE), "utf8")));
  const dir = path.join(p.downloads, job.version);
  const expected = {
    installerPath: path.join(dir, `MediaHub-Setup-${job.version}.exe`),
    manifestPath: path.join(dir, "update-manifest.json"),
    sigPath: path.join(dir, "update-manifest.json.sig"),
  };
  const rollbackOk =
    job.rollbackInstallerPath === null ||
    (path.dirname(job.rollbackInstallerPath) === p.run && ROLLBACK_NAME.test(path.basename(job.rollbackInstallerPath)));
  if (
    job.installerPath !== expected.installerPath ||
    job.manifestPath !== expected.manifestPath ||
    job.sigPath !== expected.sigPath ||
    !rollbackOk
  ) {
    throw new Error("The update job names a file outside its expected place in the updates folder.");
  }
  return job;
}

export interface Stage2Args {
  version: string;
  installerPath: string;
  manifestPath: string;
  sigPath: string;
  /** Path to the previous version's installer, or null when there is none. */
  rollbackInstallerPath: string | null;
}

/**
 * Asks the launcher of the version being restored to put back its own pre-update database backup (see
 * src/server/db/update-safety.ts). The updater never touches the data folder itself. The service account can write
 * to parts of it when the service doesn't run as LocalSystem, and file operations there could be redirected with links.
 */
function writeRestoreMarker(ctx: UpdaterContext): void {
  writeFileSync(paths(ctx.updDir).restoreMarker, `${JSON.stringify({ createdAt: ctx.now().toISOString() })}\n`);
}

/**
 * Stage 2: verify again, stop the service, run the new installer, and check it comes up. (The new version's
 * launcher backs up the database before it migrates.) If it doesn't come up, leave the restore marker and run
 * the previous installer, whose launcher then restores that backup, and check the old version comes up.
 * Always removes the lock and the marker.
 */
export async function runStage2(ctx: UpdaterContext, args: Stage2Args): Promise<void> {
  const p = paths(ctx.updDir);
  const v = args.version;
  const status = readStatus(p.status, ctx.installedVersion);
  status.installedVersion = ctx.installedVersion;
  const finish = (kind: LastResult["kind"], version: string | null, message: string) => {
    setResult(status, kind, version, message, ctx.now());
    status.state = "idle";
    writeStatus(p.status, status);
  };
  let serviceStopped = false;
  try {
    // 1. Defence in depth: stage 1 checked this already, but the installer is what runs next.
    try {
      const manifest = verifyManifest(readFileSync(args.manifestPath), readFileSync(args.sigPath, "utf8"), ctx.publicKeyPem, v);
      const installer = await sha256File(args.installerPath);
      if (installer.size !== manifest.size || installer.sha256 !== manifest.sha256) throw new Error("installer mismatch");
    } catch (error) {
      ctx.log(`Stage 2 refused ${v}: ${errorMessage(error)}`);
      finish("check-failed", v, `Update ${v} could not be verified before installing. Nothing was changed.`);
      return;
    }

    // 2. Stop the service, so a service that won't stop leaves everything as it was.
    status.state = "installing";
    writeStatus(p.status, status);
    try {
      await ctx.system.stopService();
      serviceStopped = true;
    } catch (error) {
      ctx.log(`Could not stop the service: ${errorMessage(error)}`);
      finish("failed", v, `Update ${v} did not start because the MediaHub service would not stop. Nothing was changed.`);
      return;
    }

    // 3. Install the new version.
    const code = await runInstallerSafe(ctx, args.installerPath, path.join(ctx.updDir, `install-${v}.log`));
    if (code === 0 && (await ctx.system.waitHealthy(v, HEALTH_TIMEOUT_MS))) {
      status.installedVersion = v;
      status.latestVersion = v;
      status.skipped = status.skipped.filter((s) => s !== v);
      finish("installed", v, `MediaHub ${v} is installed and running.`);
      return;
    }

    // 4. Roll back.
    ctx.log(`Update ${v} did not come up (installer exit code ${code}). Rolling back.`);
    const old = ctx.installedVersion;
    let restored = false;
    if (args.rollbackInstallerPath) {
      await ctx.system.stopService().catch((e: unknown) => ctx.log(`Stop before rollback failed: ${errorMessage(e)}`));
      writeRestoreMarker(ctx);
      const rollbackCode = await runInstallerSafe(ctx, args.rollbackInstallerPath, path.join(ctx.updDir, `rollback-${old}.log`));
      restored = rollbackCode === 0 && (await ctx.system.waitHealthy(old, HEALTH_TIMEOUT_MS));
    } else {
      // Without the old program files there is nothing to roll back to. The service is started in case the new
      // version comes up after all.
      ctx.log(`No installer for ${old} is kept, so it cannot be restored.`);
      await ctx.system.startService().catch((e: unknown) => ctx.log(`Could not start the service: ${errorMessage(e)}`));
    }

    if (restored) {
      status.skipped = [...status.skipped.filter((s) => s !== v), v];
      finish("rolled-back", v, `Update to ${v} did not start, so MediaHub ${old} was restored.`);
    } else {
      finish(
        "failed",
        v,
        `Update to ${v} failed and the previous version could not be restored. Reinstall MediaHub from the GitHub releases page.`,
      );
    }
  } catch (error) {
    ctx.log(`Stage 2 stopped unexpectedly: ${errorMessage(error)}`);
    if (serviceStopped) {
      await ctx.system.startService().catch((e: unknown) => ctx.log(`Could not start the service: ${errorMessage(e)}`));
    }
    finish("failed", v, `Update to ${v} stopped unexpectedly. Check updater.log in the updates folder.`);
  } finally {
    rmSync(p.downloads, { recursive: true, force: true });
    rmSync(p.restoreMarker, { force: true });
    rmSync(p.lock, { force: true });
  }
}

/** SHA-256 and size of a file, streamed so a large installer is never held in memory. */
export async function sha256File(file: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), size };
}

async function runInstallerSafe(ctx: UpdaterContext, exe: string, logFile: string): Promise<number> {
  try {
    return await ctx.system.runInstaller(exe, logFile);
  } catch (error) {
    ctx.log(`Installer did not run: ${errorMessage(error)}`);
    return -1;
  }
}

