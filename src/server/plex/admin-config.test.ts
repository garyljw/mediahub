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

import { claimPlexAdminConfig, clearPlexAdminConfig, getPlexAdminConfig } from "./admin-config";
import { getPlexDataConnection, savePlexDataConnection } from "./data-connection";

const CONFIG = { serverId: "fake-server-id-1", serverName: "Fake Server", ownerAccountId: "1001" };
const OTHER = { serverId: "fake-server-id-2", serverName: "Other Server", ownerAccountId: "2002" };

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
});

describe("Plex admin config", () => {
  it("is null until a config is claimed", () => {
    expect(getPlexAdminConfig()).toBeNull();
  });

  it("a claim wins once, and the second claim returns false and stores nothing", () => {
    expect(claimPlexAdminConfig(CONFIG)).toBe(true);
    expect(claimPlexAdminConfig(OTHER)).toBe(false);
    expect(getPlexAdminConfig()).toEqual(CONFIG);
  });

  it("clear removes the config so a new claim can win", () => {
    claimPlexAdminConfig(CONFIG);
    clearPlexAdminConfig();
    expect(getPlexAdminConfig()).toBeNull();
    expect(claimPlexAdminConfig(OTHER)).toBe(true);
    expect(getPlexAdminConfig()).toEqual(OTHER);
  });

  it("clearing the admin config also clears the Plex data connection, but keeps other settings", () => {
    claimPlexAdminConfig(CONFIG);
    savePlexDataConnection({
      url: "http://192.168.10.5:32400",
      pinAddress: null,
      token: "fake-data-token-0123456789",
      serverId: "fake-server-id-1",
      serverName: "Fake Server",
    });
    testDb.current!.insert(schema.setting).values({ key: "radarr.url", value: "http://radarr.test:7878", updatedAt: new Date() }).run();

    clearPlexAdminConfig();

    expect(getPlexAdminConfig()).toBeNull();
    expect(getPlexDataConnection()).toBeNull();
    expect(testDb.current!.select().from(schema.setting).all().map((row) => row.key)).toEqual(["radarr.url"]);
  });

  it("returns null when only some of the values are stored", () => {
    testDb.current!.insert(schema.setting).values({ key: "plex.serverId", value: "fake-partial", updatedAt: new Date() }).run();
    expect(getPlexAdminConfig()).toBeNull();
  });
});
