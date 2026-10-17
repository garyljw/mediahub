import "server-only";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { env } from "../env";
import { schema } from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

let instance: Db | undefined;

// Owner-only modes. Passed to mkdir/open and also enforced with chmod. The umask can
// only remove bits, so these modes can never be looser than requested.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Restricts the DB file and any WAL/SHM side files to the owner. A side file may not
 * exist yet (SQLite creates it lazily) or may vanish between the check and chmod, so
 * ENOENT is ignored. Any other error is rethrown.
 */
function restrictFiles(file: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      chmodSync(/*turbopackIgnore: true*/ `${file}${suffix}`, FILE_MODE);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * Lazily-created SQLite connection. Nothing touches the file until the first
 * call, so importing this module (or running `next build`) never needs the DB.
 * Schema changes are applied with `npm run db:migrate`, not here.
 *
 * Permissions: a missing parent directory is created with mode 0700. An existing
 * directory is never changed, since its mode is the operator's choice. A missing DB
 * file is created empty with mode 0600 before SQLite opens it, so it is never
 * world-readable, even briefly.
 */
export function db(): Db {
  if (instance) return instance;
  const file = path.resolve(env().DATABASE_PATH);
  const dir = path.dirname(file);

  if (!existsSync(/*turbopackIgnore: true*/ dir)) {
    mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true, mode: DIR_MODE });
  }
  if (!existsSync(/*turbopackIgnore: true*/ file)) {
    closeSync(openSync(/*turbopackIgnore: true*/ file, "a", FILE_MODE));
  }

  const sqlite = new Database(/*turbopackIgnore: true*/ file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  restrictFiles(file);

  instance = drizzle(sqlite, { schema });
  return instance;
}
