import "server-only";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { getPlexClientId, resetPlexClientIdCache } from "./client-id";

const testDb = vi.hoisted(() => ({ current: undefined as BetterSQLite3Database<typeof schema> | undefined }));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));

const SETTING_KEY = "plex.signInClientId";

function settingRows(): { key: string; value: string }[] {
  return testDb.current!.select().from(schema.setting).all().map((row) => ({ key: row.key, value: row.value }));
}

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
  resetPlexClientIdCache();
});

describe("getPlexClientId", () => {
  it("creates an id with the MediaHub prefix and stores it under its own key", () => {
    const clientId = getPlexClientId();
    expect(clientId).toMatch(/^mediahub-[0-9a-f-]{36}$/);
    expect(settingRows()).toEqual([{ key: SETTING_KEY, value: clientId }]);
  });

  it("returns the same id on every call, and stores it only once", () => {
    const first = getPlexClientId();
    const second = getPlexClientId();
    expect(second).toBe(first);
    expect(settingRows()).toHaveLength(1);
  });

  it("survives a cache reset: the stored id is read back, not replaced", () => {
    const first = getPlexClientId();
    resetPlexClientIdCache();
    expect(getPlexClientId()).toBe(first);
    expect(settingRows()).toHaveLength(1);
  });

  it("does not reuse the old plex.clientId setting", () => {
    testDb.current!.insert(schema.setting).values({ key: "plex.clientId", value: "mediahub-fake-old", updatedAt: new Date() }).run();
    expect(getPlexClientId()).not.toBe("mediahub-fake-old");
    expect(settingRows().map((row) => row.key).sort()).toEqual(["plex.clientId", SETTING_KEY]);
  });
});

describe("the migration that removes the old stored device", () => {
  it("deletes the two old setting rows and keeps other settings", () => {
    const sqlite = new Database(":memory:");
    const instance = drizzle(sqlite, { schema });
    migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });

    // Rows as the previous version wrote them, plus an unrelated setting that must survive.
    const now = Date.now();
    sqlite.exec(`
      INSERT INTO setting (key, value, updated_at) VALUES
        ('plex.clientId', 'mediahub-fake-old-client', ${now}),
        ('plex.devicePrivateKey', 'fake-old-private-key', ${now}),
        ('unrelated.key', 'fake-value', ${now});
    `);

    // Run the migration's SQL against the seeded rows.
    const sql = readFileSync(join(__dirname, "..", "..", "..", "drizzle", "0002_remove_plex_device.sql"), "utf8");
    sqlite.exec(sql);

    const keys = sqlite.prepare("SELECT key FROM setting ORDER BY key").all() as { key: string }[];
    expect(keys.map((row) => row.key)).toEqual(["unrelated.key"]);
  });
});
