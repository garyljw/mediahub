import "server-only";
import type Database from "better-sqlite3";
import journal from "../../../drizzle/meta/_journal.json";

export const DB_OUT_OF_DATE =
  "The database needs updating. Stop MediaHub, run `npm run db:migrate`, then start it again.";

// The journal is imported at build time, so this needs no file read at runtime.
const LATEST_EXPECTED = journal.entries[journal.entries.length - 1].when;

// drizzle-orm stores each applied migration's journal `when` as created_at, and treats a
// migration as pending when the latest created_at is older than its `when`.
export function isUpToDate(latestApplied: number | null, latestExpected: number): boolean {
  return latestApplied !== null && latestApplied >= latestExpected;
}

/** Throws DB_OUT_OF_DATE when migrations in drizzle/ have not all been applied. */
export function assertMigrated(sqlite: Database.Database): void {
  // The table is missing until the first migration has run, which means nothing is applied.
  const hasTable = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  const latestApplied = hasTable
    ? (sqlite.prepare("SELECT MAX(created_at) AS latest FROM __drizzle_migrations").get() as { latest: number | null })
        .latest
    : null;
  if (!isUpToDate(latestApplied, LATEST_EXPECTED)) throw new Error(DB_OUT_OF_DATE);
}
