import "server-only";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupPath, DB_NEWER_THAN_APP, prepareDatabaseForStart } from "./update-safety";

const EXPECTED = 200;
// Real time: the restore checks the copy's file time against it.
const NOW = new Date();

let root: string;
let dbPath: string;
let updatesDir: string;
let logs: string[];

/** A database whose newest applied migration is `latest` (null: never migrated), holding one marker value. */
function makeDb(file: string, latest: number | null, value: string): void {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  if (latest !== null) {
    sqlite.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC)");
    sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h', ?)").run(latest);
  }
  sqlite.exec("CREATE TABLE IF NOT EXISTS data (v TEXT)");
  sqlite.prepare("INSERT INTO data (v) VALUES (?)").run(value);
  sqlite.close();
}

function valueIn(file: string): string {
  const sqlite = new Database(file, { readonly: true });
  try {
    return (sqlite.prepare("SELECT v FROM data").get() as { v: string }).v;
  } finally {
    sqlite.close();
  }
}

function run(options: { noUpdatesDir?: boolean } = {}) {
  return prepareDatabaseForStart({
    open: () => new Database(dbPath),
    dbPath,
    updatesDir: options.noUpdatesDir ? undefined : updatesDir,
    now: NOW,
    log: (message) => logs.push(message),
    latestExpected: EXPECTED,
  });
}

function writeMarker(createdAt: Date): void {
  writeFileSync(path.join(updatesDir, "restore-db.json"), JSON.stringify({ createdAt: createdAt.toISOString() }));
}

/** The state a rolled-back update leaves: a copy saved by this version, and a database migrated past it. */
function afterFailedUpdate(): void {
  makeDb(backupPath(dbPath), EXPECTED, "before-update");
  makeDb(dbPath, 300, "after-update");
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "update-safety-test-"));
  dbPath = path.join(root, "mediahub.db");
  updatesDir = path.join(root, "updates");
  mkdirSync(updatesDir);
  logs = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prepareDatabaseForStart", () => {
  it("saves nothing for a database that was never migrated", async () => {
    makeDb(dbPath, null, "x");
    await run();
    expect(existsSync(backupPath(dbPath))).toBe(false);
  });

  it("saves nothing when the database is already up to date", async () => {
    makeDb(dbPath, EXPECTED, "x");
    await run();
    expect(existsSync(backupPath(dbPath))).toBe(false);
  });

  it("saves a consistent copy before migrating, noting its newest migration", async () => {
    makeDb(dbPath, 100, "old-data");
    await run();
    expect(valueIn(backupPath(dbPath))).toBe("old-data");
    expect(existsSync(`${backupPath(dbPath)}.tmp`)).toBe(false);
  });

  it("restores the copy after a rolled-back update when the updater asked for it", async () => {
    afterFailedUpdate();
    writeMarker(new Date(NOW.getTime() - 5 * 60_000));
    await run();
    // Checked before valueIn opens the file, which creates new side files.
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);
    expect(valueIn(dbPath)).toBe("before-update");
    expect(logs.join("\n")).toContain("restored");
  });

  it("refuses a newer database when the updater did not ask for a restore (a hand downgrade)", async () => {
    afterFailedUpdate();
    await expect(run()).rejects.toThrow(DB_NEWER_THAN_APP);
    expect(valueIn(dbPath)).toBe("after-update");
  });

  it("refuses when the restore request is more than an hour old", async () => {
    afterFailedUpdate();
    writeMarker(new Date(NOW.getTime() - 61 * 60_000));
    await expect(run()).rejects.toThrow(DB_NEWER_THAN_APP);
    expect(valueIn(dbPath)).toBe("after-update");
  });

  it("refuses when the saved copy was made by a different version", async () => {
    makeDb(backupPath(dbPath), 100, "older-copy");
    makeDb(dbPath, 300, "after-update");
    writeMarker(NOW);
    await expect(run()).rejects.toThrow(DB_NEWER_THAN_APP);
  });

  it("refuses when there is no updates folder (not a Windows install)", async () => {
    afterFailedUpdate();
    writeMarker(NOW);
    await expect(run({ noUpdatesDir: true })).rejects.toThrow(DB_NEWER_THAN_APP);
  });

  it("refuses when the saved copy is more than two hours old", async () => {
    afterFailedUpdate();
    const old = new Date(NOW.getTime() - 3 * 60 * 60_000);
    utimesSync(backupPath(dbPath), old, old);
    writeMarker(NOW);
    await expect(run()).rejects.toThrow(DB_NEWER_THAN_APP);
    expect(valueIn(dbPath)).toBe("after-update");
  });

  it("refuses when the saved copy is not a database", async () => {
    makeDb(dbPath, 300, "after-update");
    writeFileSync(backupPath(dbPath), "not a database");
    writeMarker(NOW);
    await expect(run()).rejects.toThrow(DB_NEWER_THAN_APP);
    expect(valueIn(dbPath)).toBe("after-update");
  });

  it("ignores an unreadable restore request", async () => {
    afterFailedUpdate();
    writeFileSync(path.join(updatesDir, "restore-db.json"), "not json");
    await expect(run()).rejects.toThrow(DB_NEWER_THAN_APP);
  });
});
