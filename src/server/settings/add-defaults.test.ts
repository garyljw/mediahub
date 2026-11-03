import "server-only";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

// Each test gets a fresh in-memory database with the real migrations applied.
const testDb = vi.hoisted(() => ({ current: undefined as BetterSQLite3Database<typeof schema> | undefined }));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));

import { getMovieAddDefaults, getSeriesAddDefaults, saveMovieAddDefaults, saveSeriesAddDefaults } from "./add-defaults";

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
});

/** Writes a raw value straight into the table, bypassing the save functions, to simulate bad stored data. */
function storeRaw(key: string, value: string): void {
  testDb.current!.insert(schema.setting).values({ key, value, updatedAt: new Date() }).run();
}

describe("getMovieAddDefaults", () => {
  it("is all null when nothing is stored", () => {
    expect(getMovieAddDefaults()).toEqual({ profileId: null, rootFolderId: null });
  });

  it("returns the stored ids", () => {
    saveMovieAddDefaults({ profileId: 4, rootFolderId: 7 });
    expect(getMovieAddDefaults()).toEqual({ profileId: 4, rootFolderId: 7 });
  });

  it.each(["0", "-3", "1.5", "abc", "", " 4", "4 ", "1e3", "99999999999999999999"])("reads %j as null", (raw) => {
    storeRaw("radarr.defaultProfileId", raw);
    storeRaw("radarr.defaultRootFolderId", raw);
    expect(getMovieAddDefaults()).toEqual({ profileId: null, rootFolderId: null });
  });

  it("ignores Sonarr keys", () => {
    saveSeriesAddDefaults({ profileId: 2, rootFolderId: 3, monitor: "future" });
    expect(getMovieAddDefaults()).toEqual({ profileId: null, rootFolderId: null });
  });
});

describe("getSeriesAddDefaults", () => {
  it("is all null when nothing is stored", () => {
    expect(getSeriesAddDefaults()).toEqual({ profileId: null, rootFolderId: null, monitor: null });
  });

  it("returns the stored ids and monitor", () => {
    saveSeriesAddDefaults({ profileId: 2, rootFolderId: 8, monitor: "firstSeason" });
    expect(getSeriesAddDefaults()).toEqual({ profileId: 2, rootFolderId: 8, monitor: "firstSeason" });
  });

  it("reads a monitor that is not a known option as null", () => {
    storeRaw("sonarr.defaultMonitor", "everything");
    expect(getSeriesAddDefaults().monitor).toBeNull();
  });

  it("reads bad ids as null while keeping a good monitor", () => {
    storeRaw("sonarr.defaultProfileId", "-1");
    storeRaw("sonarr.defaultRootFolderId", "zero");
    storeRaw("sonarr.defaultMonitor", "none");
    expect(getSeriesAddDefaults()).toEqual({ profileId: null, rootFolderId: null, monitor: "none" });
  });
});

describe("saveMovieAddDefaults", () => {
  it("stores exactly the two Radarr keys and overwrites on a second save", () => {
    saveMovieAddDefaults({ profileId: 4, rootFolderId: 7 });
    saveMovieAddDefaults({ profileId: 5, rootFolderId: 9 });
    expect(getMovieAddDefaults()).toEqual({ profileId: 5, rootFolderId: 9 });
    expect(testDb.current!.select().from(schema.setting).all().map((row) => row.key).sort()).toEqual([
      "radarr.defaultProfileId",
      "radarr.defaultRootFolderId",
    ]);
  });
});

describe("saveSeriesAddDefaults", () => {
  it("stores exactly the three Sonarr keys and overwrites on a second save", () => {
    saveSeriesAddDefaults({ profileId: 2, rootFolderId: 8, monitor: "all" });
    saveSeriesAddDefaults({ profileId: 3, rootFolderId: 8, monitor: "latestSeason" });
    expect(getSeriesAddDefaults()).toEqual({ profileId: 3, rootFolderId: 8, monitor: "latestSeason" });
    expect(testDb.current!.select().from(schema.setting).all().map((row) => row.key).sort()).toEqual([
      "sonarr.defaultMonitor",
      "sonarr.defaultProfileId",
      "sonarr.defaultRootFolderId",
    ]);
  });
});
