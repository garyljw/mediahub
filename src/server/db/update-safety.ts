import "server-only";
import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { LATEST_EXPECTED, latestAppliedMigration } from "./migration-check";

// Database safety around updates, for the packaged launcher only. It runs as the service account, before
// migrations and before the server starts.
// - Before this version migrates an existing database, it saves a copy next to it (<db>.pre-update). The copy is
//   a complete SQLite file, so its newest migration is read from the copy itself.
// - A database that is newer than this version (an update migrated it, then failed and was rolled back) is put
//   back from that copy, but only when the updater asked for it: a fresh restore-db.json in the updates folder,
//   which only SYSTEM and Administrators can write. Without that request this version refuses to start, so a
//   hand downgrade never silently throws away data.
// The updater (SYSTEM) never copies or deletes anything in the data folder itself, because the service account
// can write there and could redirect those file operations with links.

export const DB_NEWER_THAN_APP =
  "The database was changed by a newer version of MediaHub, so this version can't use it. Install the newer version again, or restore a backup of the data folder.";

/** Same name as RESTORE_MARKER_NAME in src/server/updater/run.ts. */
const RESTORE_MARKER_NAME = "restore-db.json";
const MARKER_MAX_AGE_MS = 60 * 60 * 1000;
const COPY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const markerSchema = z.object({ createdAt: z.string() });

export interface UpdateSafetyInput {
  /** Opens the database without checking migrations. */
  open: () => Database.Database;
  /** Absolute path of the database file. */
  dbPath: string;
  /** The updater's folder, or undefined when MediaHub isn't installed by the Windows installer. */
  updatesDir: string | undefined;
  now: Date;
  log: (message: string) => void;
  /** The newest migration this version has. Tests pass their own. */
  latestExpected?: number;
}

export function backupPath(dbPath: string): string {
  return `${dbPath}.pre-update`;
}

/** The newest migration in the saved copy, or null when there is no readable copy. */
function copyMigration(copy: string): number | null {
  if (!existsSync(/*turbopackIgnore: true*/ copy)) return null;
  try {
    const sqlite = new Database(/*turbopackIgnore: true*/ copy, { readonly: true, fileMustExist: true });
    try {
      return latestAppliedMigration(sqlite);
    } finally {
      sqlite.close();
    }
  } catch {
    return null;
  }
}

/** True when the file was written less than COPY_MAX_AGE_MS ago. */
function isRecent(file: string, now: Date): boolean {
  try {
    return now.getTime() - statSync(/*turbopackIgnore: true*/ file).mtimeMs < COPY_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** Replaces `target` with a copy of `source` by renaming a full temp copy over it, so a crash never leaves half a file. */
function replaceWithCopy(source: string, target: string): void {
  const tmp = `${target}.tmp`;
  rmSync(/*turbopackIgnore: true*/ tmp, { force: true });
  copyFileSync(/*turbopackIgnore: true*/ source, /*turbopackIgnore: true*/ tmp);
  renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ target);
}

function readJson<T>(file: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** True when the updater left a restore request less than an hour ago. */
function restoreRequested(updatesDir: string | undefined, now: Date): boolean {
  if (!updatesDir) return false;
  const marker = readJson(path.join(updatesDir, RESTORE_MARKER_NAME), markerSchema);
  if (!marker) return false;
  const age = now.getTime() - Date.parse(marker.createdAt);
  // A marker from the future (clock change) counts only within a minute.
  return Number.isFinite(age) && age > -60_000 && age < MARKER_MAX_AGE_MS;
}

/**
 * Backs up the database before this version migrates it, or restores the pre-update copy after a rolled-back
 * update. Throws DB_NEWER_THAN_APP when the database is newer than this version and can't be restored, and
 * throws when a needed backup fails (so nothing is migrated without one).
 */
export async function prepareDatabaseForStart(input: UpdateSafetyInput): Promise<void> {
  const expected = input.latestExpected ?? LATEST_EXPECTED;
  const copy = backupPath(input.dbPath);
  const sqlite = input.open();
  let latest: number | null;
  try {
    latest = latestAppliedMigration(sqlite);
    if (latest !== null && latest < expected) {
      // An existing database that this version will migrate: keep a consistent copy first, written in full to a
      // temp file and then renamed, so the copy is either the old one or the new one. It holds the same secrets
      // as the database, so it gets the same owner-only mode (which does nothing on Windows, where the data
      // folder's permissions protect it).
      const tmp = `${copy}.tmp`;
      rmSync(/*turbopackIgnore: true*/ tmp, { force: true });
      await sqlite.backup(/*turbopackIgnore: true*/ tmp);
      chmodSync(/*turbopackIgnore: true*/ tmp, 0o600);
      renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ copy);
      input.log("Saved a copy of the database before updating it.");
      return;
    }
  } finally {
    sqlite.close();
  }
  if (latest === null || latest <= expected) return;

  // The database is newer than this version.
  // The copy must be one this version could have made (at exactly its own newest migration), and recent: the
  // failed version made it just before it migrated, minutes before the rollback.
  if (!restoreRequested(input.updatesDir, input.now) || copyMigration(copy) !== expected || !isRecent(copy, input.now)) {
    throw new Error(DB_NEWER_THAN_APP);
  }
  // The connection is closed, so the -wal and -shm files belong to the newer database and go with it. They are
  // removed first: if the rename below never happens, the next start finds the newer database (without its
  // last uncheckpointed writes) and restores again, because the marker is still there.
  rmSync(/*turbopackIgnore: true*/ `${input.dbPath}-wal`, { force: true });
  rmSync(/*turbopackIgnore: true*/ `${input.dbPath}-shm`, { force: true });
  replaceWithCopy(copy, input.dbPath);
  input.log("An update was rolled back: restored the database copy saved before that update.");
}
