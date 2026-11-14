import "server-only";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

const testDb = vi.hoisted(() => ({ current: undefined as BetterSQLite3Database<typeof schema> | undefined }));

const cache = vi.hoisted(() => ({ clear: vi.fn() }));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));
vi.mock("@/server/tmdb/client", () => ({ clearTmdbCache: cache.clear }));

import { getTmdbConfig, getTmdbSummary, removeTmdbConfig, saveTmdbConfig } from "./tmdb";

beforeEach(() => {
  cache.clear.mockClear();
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
});

const TOKEN = "fake-tmdb-token-0123456789abcdef";

describe("tmdb settings", () => {
  it("has no config and the default country until something is saved", () => {
    expect(getTmdbConfig()).toBeNull();
    expect(getTmdbSummary()).toEqual({ hasToken: false, region: "GB", language: "en" });
  });

  it("stores the token and country; the summary never contains the token", () => {
    saveTmdbConfig({ token: TOKEN, region: "US", language: "ja" });
    expect(getTmdbConfig()).toEqual({ token: TOKEN, region: "US", language: "ja" });
    const summary = getTmdbSummary();
    expect(summary).toEqual({ hasToken: true, region: "US", language: "ja" });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
  });

  it("clears the cached TMDB lists on every save and remove, whoever calls", () => {
    saveTmdbConfig({ token: TOKEN, region: "US", language: "en" });
    expect(cache.clear).toHaveBeenCalledTimes(1);
    removeTmdbConfig();
    expect(cache.clear).toHaveBeenCalledTimes(2);
  });

  it("removes both values", () => {
    saveTmdbConfig({ token: TOKEN, region: "US", language: "any" });
    removeTmdbConfig();
    expect(getTmdbConfig()).toBeNull();
    expect(testDb.current!.select().from(schema.setting).all()).toEqual([]);
  });
});
