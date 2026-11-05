import "server-only";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStatus, writeStatus } from "./status";
import { readJob, runStage1, runStage2, type Stage2Args, type System, type UpdaterContext } from "./run";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const NEW = "2.0.0";
const OLD = "1.0.0";

interface Fake {
  calls: string[];
  installerCodes: Map<string, number>;
  healthy: Map<string, boolean>;
  /** Runs inside runInstaller, to simulate what an installer does to the database. */
  onInstall?: (exe: string) => void;
  stopThrows: boolean;
}

let root: string;
let updDir: string;
let dbPath: string;
let fake: Fake;
let logs: string[];
let rollbackPath: string | null;
let args: Stage2Args;
let ctx: UpdaterContext;

function fakeSystem(state: Fake): System {
  return {
    async stopService() {
      state.calls.push("stop");
      if (state.stopThrows) throw new Error("stop failed");
    },
    async startService() {
      state.calls.push("start");
    },
    async runInstaller(exe) {
      state.calls.push(`install:${path.basename(exe)}`);
      state.onInstall?.(exe);
      return state.installerCodes.get(path.basename(exe)) ?? 0;
    },
    async waitHealthy(expectVersion) {
      state.calls.push(`healthy:${expectVersion}`);
      return state.healthy.get(expectVersion) ?? false;
    },
    async startStage2() {
      state.calls.push("start-stage2");
    },
  };
}

function unusedNet(): UpdaterContext["net"] {
  return {
    fetchReleases: async () => {
      throw new Error("not used in stage 2");
    },
    download: async () => {
      throw new Error("not used in stage 2");
    },
  };
}

beforeEach(() => {
  markerSeen.clear();
  root = mkdtempSync(path.join(os.tmpdir(), "updater-run-test-"));
  updDir = path.join(root, "updates");
  for (const dir of ["requests", "downloads", "run", "backup", "installers"]) mkdirSync(path.join(updDir, dir), { recursive: true });
  const dataDir = path.join(root, "data");
  mkdirSync(dataDir);
  dbPath = path.join(dataDir, "mediahub.db");
  writeFileSync(dbPath, "old-db");
  writeFileSync(`${dbPath}-wal`, "old-wal");

  // A signed manifest for the new version, and its installer.
  const installerDir = path.join(updDir, "downloads", NEW);
  mkdirSync(installerDir, { recursive: true });
  const installerPath = path.join(installerDir, `MediaHub-Setup-${NEW}.exe`);
  const installerBytes = Buffer.from("new-installer");
  writeFileSync(installerPath, installerBytes);
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schema: 1,
      product: "MediaHub",
      version: NEW,
      installer: `MediaHub-Setup-${NEW}.exe`,
      sha256: createHash("sha256").update(installerBytes).digest("hex"),
      size: installerBytes.length,
    }),
  );
  const manifestPath = path.join(installerDir, "update-manifest.json");
  const sigPath = path.join(installerDir, "update-manifest.json.sig");
  writeFileSync(manifestPath, manifestBytes);
  writeFileSync(sigPath, sign(null, manifestBytes, privateKey).toString("base64"));
  writeFileSync(path.join(updDir, "update.lock"), "lock");

  rollbackPath = path.join(updDir, "run", `MediaHub-Setup-${OLD}.exe`);
  writeFileSync(rollbackPath, "old-installer");

  fake = { calls: [], installerCodes: new Map(), healthy: new Map([[NEW, true]]), stopThrows: false };
  logs = [];
  args = {
    version: NEW,
    installerPath,
    manifestPath,
    sigPath,
    rollbackInstallerPath: rollbackPath,
  };
  makeContext();
});

function makeContext(): void {
  ctx = {
    appDir: path.join(root, "app"),
    dataDir: path.join(root, "data"),
    updDir,
    installedVersion: OLD,
    publicKeyPem: PUBLIC_PEM,
    system: fakeSystem(fake),
    net: unusedNet(),
    log: (message) => logs.push(message),
    now: () => new Date("2026-11-04T03:30:00Z"),
  };
}

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const markerPath = () => path.join(updDir, "restore-db.json");

/** Records, per installer, whether the restore marker was there while it ran (the old launcher reads it then). */
const markerSeen = new Map<string, boolean>();
function migratingInstaller(exe: string): void {
  markerSeen.set(path.basename(exe), existsSync(markerPath()));
}

/** The updater (SYSTEM) must never touch the data folder, which the service account can write to. */
function expectDataUntouched(): void {
  expect(readFileSync(dbPath, "utf8")).toBe("old-db");
  expect(readFileSync(`${dbPath}-wal`, "utf8")).toBe("old-wal");
  expect(existsSync(`${dbPath}-shm`)).toBe(false);
}

function statusNow() {
  return readStatus(path.join(updDir, "status.json"), OLD);
}

describe("runStage2", () => {
  it("installs the new version and records it", async () => {
    fake.onInstall = migratingInstaller;
    await runStage2(ctx, args);
    const status = statusNow();
    expect(status.lastResult?.kind).toBe("installed");
    expect(status.lastResult?.version).toBe(NEW);
    expect(status.installedVersion).toBe(NEW);
    expect(status.skipped).toEqual([]);
    expect(status.state).toBe("idle");
    expect(markerSeen.get(`MediaHub-Setup-${NEW}.exe`)).toBe(false);
    expectDataUntouched();
    expect(existsSync(path.join(updDir, "downloads"))).toBe(false);
    expect(existsSync(path.join(updDir, "update.lock"))).toBe(false);
  });

  it("rolls back when the installer fails, asking the old launcher to restore its database copy", async () => {
    fake.onInstall = migratingInstaller;
    fake.installerCodes.set(`MediaHub-Setup-${NEW}.exe`, 1);
    fake.healthy.set(OLD, true);
    await runStage2(ctx, args);
    const status = statusNow();
    expect(status.lastResult?.kind).toBe("rolled-back");
    expect(status.lastResult?.version).toBe(NEW);
    expect(status.installedVersion).toBe(OLD);
    expect(status.skipped).toContain(NEW);
    expect(fake.calls).toContain(`install:MediaHub-Setup-${OLD}.exe`);
    expect(markerSeen.get(`MediaHub-Setup-${OLD}.exe`)).toBe(true);
    expect(existsSync(markerPath())).toBe(false);
    expectDataUntouched();
    expect(existsSync(path.join(updDir, "update.lock"))).toBe(false);
  });

  it("rolls back when the new version does not come up", async () => {
    fake.onInstall = migratingInstaller;
    fake.healthy.set(NEW, false);
    fake.healthy.set(OLD, true);
    await runStage2(ctx, args);
    expect(statusNow().lastResult?.kind).toBe("rolled-back");
    expect(markerSeen.get(`MediaHub-Setup-${OLD}.exe`)).toBe(true);
  });

  it("reports failed when the rollback installer fails", async () => {
    fake.onInstall = migratingInstaller;
    fake.healthy.set(NEW, false);
    fake.installerCodes.set(`MediaHub-Setup-${OLD}.exe`, 1);
    await runStage2(ctx, args);
    const status = statusNow();
    expect(status.lastResult?.kind).toBe("failed");
    expect(status.lastResult?.message).toBe(
      `Update to ${NEW} failed and the previous version could not be restored. Reinstall MediaHub from the GitHub releases page.`,
    );
    expect(status.installedVersion).toBe(OLD);
    expect(existsSync(path.join(updDir, "update.lock"))).toBe(false);
    expect(existsSync(markerPath())).toBe(false);
  });

  it("reports failed and starts the service when no rollback installer is kept", async () => {
    fake.onInstall = migratingInstaller;
    fake.installerCodes.set(`MediaHub-Setup-${NEW}.exe`, 1);
    args.rollbackInstallerPath = null;
    await runStage2(ctx, args);
    expect(statusNow().lastResult?.kind).toBe("failed");
    expect(fake.calls.some((call) => call.startsWith("install:MediaHub-Setup-1.0.0"))).toBe(false);
    expect(existsSync(markerPath())).toBe(false);
    expectDataUntouched();
    expect(fake.calls.at(-1)).toBe("start");
  });

  it("starts the service again when something unexpected fails after it was stopped", async () => {
    fake.healthy.set(NEW, true);
    ctx.system.waitHealthy = async () => {
      throw new Error("boom");
    };
    await runStage2(ctx, args);
    expect(statusNow().lastResult?.kind).toBe("failed");
    expect(fake.calls).toContain("start");
    expect(existsSync(path.join(updDir, "update.lock"))).toBe(false);
  });

  it("refuses to install a tampered installer", async () => {
    writeFileSync(args.installerPath, "tampered");
    await runStage2(ctx, args);
    expect(statusNow().lastResult?.kind).toBe("check-failed");
    expect(fake.calls.some((call) => call.startsWith("install:"))).toBe(false);
    expect(existsSync(path.join(updDir, "update.lock"))).toBe(false);
  });

  it("changes nothing when the service will not stop", async () => {
    fake.stopThrows = true;
    await runStage2(ctx, args);
    const status = statusNow();
    expect(status.lastResult?.kind).toBe("failed");
    expect(status.lastResult?.message).toContain("Nothing was changed");
    expect(fake.calls.some((call) => call.startsWith("install:"))).toBe(false);
    expectDataUntouched();
  });
});

describe("runStage1", () => {
  const options = { checkOnly: false, autoUpdate: true, scriptPath: "/x/updater.mjs" };
  const statusFile = () => path.join(updDir, "status.json");

  beforeEach(() => {
    rmSync(path.join(updDir, "update.lock"), { force: true });
  });

  it("starts the service when an install was interrupted", async () => {
    writeStatus(statusFile(), { ...statusNow(), state: "installing" });
    ctx.now = () => new Date(2026, 10, 4, 12, 0);
    await runStage1(ctx, options);
    expect(fake.calls).toContain("start");
  });

  it("keeps a check-now request that comes too soon after the last check, and acts on it later", async () => {
    let fetches = 0;
    ctx.net = {
      fetchReleases: async () => {
        fetches += 1;
        return [];
      },
      download: async () => {
        throw new Error("not used");
      },
    };
    const noon = new Date(2026, 10, 4, 12, 0);
    writeStatus(statusFile(), { ...statusNow(), lastCheckAt: new Date(noon.getTime() - 60_000).toISOString() });
    writeFileSync(path.join(updDir, "requests", "check-now"), "");
    ctx.now = () => noon;
    expect(await runStage1(ctx, options)).toEqual({ kind: "idle" });
    expect(existsSync(path.join(updDir, "requests", "check-now"))).toBe(true);
    ctx.now = () => new Date(noon.getTime() + 2 * 60_000);
    expect(await runStage1(ctx, options)).toEqual({ kind: "checked" });
    expect(fetches).toBe(1);
    expect(existsSync(path.join(updDir, "requests", "check-now"))).toBe(false);
  });

  it("does not count a request entry that can't be removed", async () => {
    mkdirSync(path.join(updDir, "requests", "full"));
    writeFileSync(path.join(updDir, "requests", "full", "inside"), "");
    ctx.net = {
      fetchReleases: async () => {
        throw new Error("must not check");
      },
      download: async () => {
        throw new Error("not used");
      },
    };
    ctx.now = () => new Date(2026, 10, 4, 12, 0);
    expect(await runStage1(ctx, options)).toEqual({ kind: "idle" });
  });

  it("clears a stale state and the old run folder when no updater is running", async () => {
    writeStatus(statusFile(), { ...statusNow(), state: "installing", latestVersion: NEW });
    ctx.now = () => new Date(2026, 10, 4, 12, 0);
    expect(await runStage1(ctx, options)).toEqual({ kind: "idle" });
    const status = statusNow();
    expect(status.state).toBe("idle");
    expect(status.lastResult?.kind).toBe("failed");
    expect(status.lastResult?.message).toContain("interrupted");
    expect(existsSync(path.join(updDir, "run"))).toBe(false);
  });

  it("leaves a restore marker alone (it expires by itself, and the old launcher may not have read it yet)", async () => {
    writeFileSync(markerPath(), JSON.stringify({ createdAt: new Date().toISOString() }));
    ctx.now = () => new Date(2026, 10, 4, 12, 0);
    await runStage1(ctx, options);
    expect(existsSync(markerPath())).toBe(true);
  });

  it("leaves everything alone while a fresh lock exists", async () => {
    writeFileSync(path.join(updDir, "update.lock"), "lock");
    writeStatus(statusFile(), { ...statusNow(), state: "installing" });
    ctx.now = () => new Date();
    expect(await runStage1(ctx, options)).toEqual({ kind: "idle" });
    expect(statusNow().state).toBe("installing");
    expect(existsSync(path.join(updDir, "run"))).toBe(true);
  });

  it("retries a nightly check that could not reach GitHub, but not every minute", async () => {
    let fetches = 0;
    ctx.net = {
      fetchReleases: async () => {
        fetches += 1;
        throw new Error("offline");
      },
      download: async () => {
        throw new Error("not used");
      },
    };
    ctx.now = () => new Date(2026, 10, 4, 3, 0);
    expect(await runStage1(ctx, options)).toEqual({ kind: "failed" });
    expect(statusNow().lastNightlyDate).toBeNull();
    ctx.now = () => new Date(2026, 10, 4, 3, 5);
    expect(await runStage1(ctx, options)).toEqual({ kind: "idle" });
    ctx.now = () => new Date(2026, 10, 4, 3, 10);
    expect(await runStage1(ctx, options)).toEqual({ kind: "failed" });
    expect(fetches).toBe(2);
  });

  it("records the nightly date once the release list was read", async () => {
    ctx.net = {
      fetchReleases: async () => [],
      download: async () => {
        throw new Error("not used");
      },
    };
    ctx.now = () => new Date(2026, 10, 4, 3, 0);
    expect(await runStage1(ctx, options)).toEqual({ kind: "checked" });
    expect(statusNow().lastNightlyDate).toBe("2026-11-04");
    ctx.now = () => new Date(2026, 10, 4, 3, 20);
    expect(await runStage1(ctx, options)).toEqual({ kind: "idle" });
  });
});

describe("readJob", () => {
  const jobFile = () => path.join(updDir, "run", "job.json");

  it("reads the job stage 1 left", () => {
    writeFileSync(jobFile(), JSON.stringify(args));
    expect(readJob(updDir)).toEqual(args);
  });

  it("refuses a job that names a file outside the updates folder", () => {
    writeFileSync(jobFile(), JSON.stringify({ ...args, installerPath: path.join(root, "elsewhere.exe") }));
    expect(() => readJob(updDir)).toThrow(/expected place/);
    writeFileSync(jobFile(), JSON.stringify({ ...args, rollbackInstallerPath: path.join(updDir, "..", "x.exe") }));
    expect(() => readJob(updDir)).toThrow(/expected place/);
  });

  it("refuses a job whose files are in the wrong place inside the updates folder", () => {
    writeFileSync(jobFile(), JSON.stringify({ ...args, rollbackInstallerPath: path.join(updDir, "requests", `MediaHub-Setup-${OLD}.exe`) }));
    expect(() => readJob(updDir)).toThrow(/expected place/);
    writeFileSync(jobFile(), JSON.stringify({ ...args, rollbackInstallerPath: path.join(updDir, "run", "other.exe") }));
    expect(() => readJob(updDir)).toThrow(/expected place/);
  });

  it("refuses a malformed version", () => {
    writeFileSync(jobFile(), JSON.stringify({ ...args, version: "../2.0.0" }));
    expect(() => readJob(updDir)).toThrow();
  });
});

describe("runStage1 with an update available", () => {
  let files: Map<string, Buffer>;

  beforeEach(() => {
    rmSync(path.join(updDir, "update.lock"), { force: true });
    files = new Map([
      ["update-manifest.json", readFileSync(args.manifestPath)],
      ["update-manifest.json.sig", readFileSync(args.sigPath)],
      [`MediaHub-Setup-${NEW}.exe`, readFileSync(args.installerPath)],
    ]);
    const base = `https://github.com/garyljw/mediahub/releases/download/v${NEW}/`;
    ctx.net = {
      fetchReleases: async () => [
        {
          tag_name: `v${NEW}`,
          draft: false,
          assets: [...files.entries()].map(([name, bytes]) => ({ name, browser_download_url: base + name, size: bytes.length })),
        },
      ],
      download: async (url, dest) => {
        const bytes = files.get(url.slice(base.length));
        if (!bytes) throw new Error("unknown asset");
        writeFileSync(dest, bytes);
        return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
      },
    };
    mkdirSync(ctx.appDir, { recursive: true });
    writeFileSync(path.join(ctx.appDir, "node.exe"), "node");
    writeFileSync(path.join(updDir, "installers", `MediaHub-Setup-${OLD}.exe`), "old-installer");
    writeFileSync(path.join(updDir, "requests", "check-now"), "");
    ctx.now = () => new Date(2026, 10, 4, 12, 0);
  });

  const options = () => {
    const script = path.join(root, "updater.mjs");
    writeFileSync(script, "script");
    return { checkOnly: false, autoUpdate: true, scriptPath: script };
  };

  it("prepares the run folder and job, marks installing, and starts stage 2", async () => {
    expect(await runStage1(ctx, options())).toEqual({ kind: "launch" });
    const job = readJob(updDir);
    expect(job.version).toBe(NEW);
    expect(job.rollbackInstallerPath).toBe(path.join(updDir, "run", `MediaHub-Setup-${OLD}.exe`));
    expect(existsSync(path.join(updDir, "run", "node.exe"))).toBe(true);
    expect(existsSync(path.join(updDir, "update.lock"))).toBe(true);
    expect(statusNow().state).toBe("installing");
    expect(fake.calls).toEqual(["start-stage2"]);
  });

  it("reports a failure and frees the lock when stage 2 won't start", async () => {
    ctx.system.startStage2 = async () => {
      throw new Error("WMI failed");
    };
    expect(await runStage1(ctx, options())).toEqual({ kind: "failed" });
    const status = statusNow();
    expect(status.state).toBe("idle");
    expect(status.lastResult?.kind).toBe("failed");
    expect(status.lastResult?.message).toContain("install step did not start");
    expect(existsSync(path.join(updDir, "update.lock"))).toBe(false);
  });
});
