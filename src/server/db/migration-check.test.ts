import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schema } from "./schema";
import { DB_OUT_OF_DATE, assertMigrated, isUpToDate } from "./migration-check";

const MIGRATIONS = join(__dirname, "..", "..", "..", "drizzle");
const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as {
  entries: { when: number }[];
};
const LATEST = journal.entries[journal.entries.length - 1].when;

describe("isUpToDate", () => {
  it("is false when nothing has been applied", () => {
    expect(isUpToDate(null, LATEST)).toBe(false);
  });

  it("is false when the latest applied migration is older than the latest expected", () => {
    expect(isUpToDate(LATEST - 1, LATEST)).toBe(false);
  });

  it("is true when the latest applied migration matches the latest expected", () => {
    expect(isUpToDate(LATEST, LATEST)).toBe(true);
  });

  it("is true when the applied migration is newer than expected", () => {
    expect(isUpToDate(LATEST + 1, LATEST)).toBe(true);
  });
});

describe("assertMigrated", () => {
  it("throws DB_OUT_OF_DATE when the migrations table does not exist", () => {
    expect(() => assertMigrated(new Database(":memory:"))).toThrow(DB_OUT_OF_DATE);
  });

  it("throws DB_OUT_OF_DATE when the latest applied migration is older", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
    );
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("old", LATEST - 1);
    expect(() => assertMigrated(sqlite)).toThrow(DB_OUT_OF_DATE);
  });

  it("passes when the latest applied migration matches the journal", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
    );
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("latest", LATEST);
    expect(() => assertMigrated(sqlite)).not.toThrow();
  });

  it("passes after the real migrations have been applied", () => {
    const sqlite = new Database(":memory:");
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS });
    expect(() => assertMigrated(sqlite)).not.toThrow();
  });

  it("rethrows errors that are not a missing migrations table", () => {
    const sqlite = new Database(":memory:");
    sqlite.close();
    expect(() => assertMigrated(sqlite)).toThrow(TypeError);
  });
});
