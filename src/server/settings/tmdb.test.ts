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

import { getChosenServices, getPopularIncludes, getTmdbConfig, getTmdbSummary, removeTmdbConfig, saveChosenServices, savePopularIncludes, saveTmdbConfig } from "./tmdb";

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

  it("keeps the chosen services in order, reads a bad stored value as none, and removes them with the config", () => {
    expect(getChosenServices()).toEqual([]);
    saveChosenServices([337, 8]);
    expect(getChosenServices()).toEqual([337, 8]);
    testDb.current?.update(schema.setting).set({ value: "[8,0]" }).run();
    expect(getChosenServices()).toEqual([]);
    testDb.current?.update(schema.setting).set({ value: "[337,8,337]" }).run();
    expect(getChosenServices()).toEqual([337, 8]);
    testDb.current?.update(schema.setting).set({ value: "not json" }).run();
    expect(getChosenServices()).toEqual([]);
    saveChosenServices([8]);
    removeTmdbConfig();
    expect(getChosenServices()).toEqual([]);
  });

  it("keeps the included Popular categories in canonical order, drops unknown keys and duplicates, reads a bad value as none, and removes them with the config", () => {
    expect(getPopularIncludes()).toEqual([]);
    savePopularIncludes(["talk", "documentary"]);
    expect(getPopularIncludes()).toEqual(["documentary", "talk"]);
    testDb.current?.update(schema.setting).set({ value: '["soap","bogus","soap",7]' }).run();
    expect(getPopularIncludes()).toEqual([]);
    testDb.current?.update(schema.setting).set({ value: '["soap","bogus","soap","news"]' }).run();
    expect(getPopularIncludes()).toEqual(["news", "soap"]);
    testDb.current?.update(schema.setting).set({ value: "not json" }).run();
    expect(getPopularIncludes()).toEqual([]);
    savePopularIncludes(["news"]);
    removeTmdbConfig();
    expect(getPopularIncludes()).toEqual([]);
  });
});
