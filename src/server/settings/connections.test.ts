import "server-only";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

// Each test gets a fresh in-memory database with the real migrations applied.
const testDb = vi.hoisted(() => ({ current: undefined as BetterSQLite3Database<typeof schema> | undefined }));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));

import { getConnection, getConnectionSummary, saveConnection } from "./connections";

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
});

const RADARR = { url: "http://radarr.test:7878", apiKey: "fake-radarr-key-0123456789abcdef" };
const SONARR = { url: "http://sonarr.test:8989/sonarr", apiKey: "fake-sonarr-key-0123456789abcdef" };

function storedKeys(): string[] {
  return testDb.current!.select().from(schema.setting).all().map((row) => row.key).sort();
}

describe("getConnection", () => {
  it("is null when nothing is stored", () => {
    expect(getConnection("radarr")).toBeNull();
  });

  it("is null when the key is missing, even with a URL", () => {
    saveConnection("radarr", RADARR);
    testDb.current!.delete(schema.setting).where(eq(schema.setting.key, "radarr.apiKey")).run();
    expect(getConnection("radarr")).toBeNull();
  });

  it("is null when the URL is missing, even with a key", () => {
    saveConnection("radarr", RADARR);
    testDb.current!.delete(schema.setting).where(eq(schema.setting.key, "radarr.url")).run();
    expect(getConnection("radarr")).toBeNull();
  });

  it("returns both values once saved, and keeps the apps apart", () => {
    saveConnection("radarr", RADARR);
    saveConnection("sonarr", SONARR);
    expect(getConnection("radarr")).toEqual(RADARR);
    expect(getConnection("sonarr")).toEqual(SONARR);
  });
});

describe("getConnectionSummary", () => {
  it("reports no URL and no key before saving", () => {
    expect(getConnectionSummary("sonarr")).toEqual({ url: null, hasKey: false });
  });

  it("returns the URL and only whether a key exists, never the key", () => {
    saveConnection("radarr", RADARR);
    const summary = getConnectionSummary("radarr");
    expect(summary).toEqual({ url: RADARR.url, hasKey: true });
    expect(Object.keys(summary).sort()).toEqual(["hasKey", "url"]);
    expect(JSON.stringify(summary)).not.toContain(RADARR.apiKey);
  });
});

describe("saveConnection", () => {
  it("stores exactly the two keys for an app", () => {
    saveConnection("radarr", RADARR);
    expect(storedKeys()).toEqual(["radarr.apiKey", "radarr.url"]);
  });

  it("overwrites an existing connection without adding rows", () => {
    saveConnection("radarr", RADARR);
    const next = { url: "http://radarr.other:7878", apiKey: "new-radarr-key-0123456789" };
    saveConnection("radarr", next);
    expect(getConnection("radarr")).toEqual(next);
    expect(storedKeys()).toEqual(["radarr.apiKey", "radarr.url"]);
  });
});
