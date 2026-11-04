import "server-only";
import Database from "better-sqlite3";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";

const testDb = vi.hoisted(() => ({ current: undefined as BetterSQLite3Database<typeof schema> | undefined }));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));

import {
  clearPlexDataConnection,
  getPlexDataClientId,
  getPlexDataConnection,
  getPlexDataSummary,
  resetPlexDataClientIdCache,
  savePlexDataConnection,
} from "./data-connection";

const TOKEN = "fake-plex-data-token-0123456789abcdef";
const LAN = { url: "https://192-168-10-5.fakehash.plex.direct:32400", pinAddress: "192.168.10.5", token: TOKEN };

function settingKeys(): string[] {
  return testDb.current!.select().from(schema.setting).all().map((row) => row.key).sort();
}

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
  resetPlexDataClientIdCache();
});

describe("getPlexDataClientId", () => {
  it("generates a data client id once, with its own prefix, and reuses it", () => {
    const first = getPlexDataClientId();
    expect(first).toMatch(/^mediahub-data-[0-9a-f-]{36}$/);
    resetPlexDataClientIdCache();
    expect(getPlexDataClientId()).toBe(first);
    expect(settingKeys()).toEqual(["plex.dataClientId"]);
  });

  it("is not the sign-in client id", () => {
    getPlexDataClientId();
    expect(settingKeys()).not.toContain("plex.signInClientId");
  });
});

describe("the stored data connection", () => {
  it("is null until a url and a token are both stored", () => {
    expect(getPlexDataConnection()).toBeNull();
    expect(getPlexDataSummary()).toEqual({ connected: false, url: null });
  });

  it("saves and reads back the url, pin address and token", () => {
    savePlexDataConnection(LAN);
    expect(getPlexDataConnection()).toEqual(LAN);
  });

  it("stores a plain http connection with no pin address", () => {
    savePlexDataConnection({ url: "http://192.168.10.5:32400", pinAddress: null, token: TOKEN });
    expect(getPlexDataConnection()).toEqual({ url: "http://192.168.10.5:32400", pinAddress: null, token: TOKEN });
    expect(settingKeys()).not.toContain("plex.dataPinAddress");
  });

  it("removes an old pin address when the new connection has none", () => {
    savePlexDataConnection(LAN);
    savePlexDataConnection({ url: "http://192.168.10.5:32400", pinAddress: null, token: TOKEN });
    expect(getPlexDataConnection()?.pinAddress).toBeNull();
  });

  it("replaces an earlier connection", () => {
    savePlexDataConnection(LAN);
    savePlexDataConnection({ ...LAN, token: "fake-second-token-0123456789abcdef" });
    expect(getPlexDataConnection()?.token).toBe("fake-second-token-0123456789abcdef");
    expect(settingKeys().filter((key) => key === "plex.dataToken")).toHaveLength(1);
  });

  it("the summary shows the url and whether it is connected, never the token", () => {
    savePlexDataConnection(LAN);
    const summary = getPlexDataSummary();
    expect(summary).toEqual({ connected: true, url: LAN.url });
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
  });

  it("the summary is not connected when only the url is stored", () => {
    savePlexDataConnection(LAN);
    testDb.current!.delete(schema.setting).where(eq(schema.setting.key, "plex.dataToken")).run();
    expect(getPlexDataSummary()).toEqual({ connected: false, url: null });
    expect(getPlexDataConnection()).toBeNull();
  });

  it("clear removes the url, pin address and token but keeps the client id", () => {
    const clientId = getPlexDataClientId();
    savePlexDataConnection(LAN);
    clearPlexDataConnection();
    expect(getPlexDataConnection()).toBeNull();
    expect(getPlexDataSummary()).toEqual({ connected: false, url: null });
    expect(settingKeys()).toEqual(["plex.dataClientId"]);
    expect(getPlexDataClientId()).toBe(clientId);
  });

  it("clear also removes in-flight connect rows, and leaves other verification rows alone", () => {
    const now = new Date();
    const row = (identifier: string) => ({ id: identifier, identifier, value: "{}", expiresAt: now, createdAt: now, updatedAt: now });
    testDb
      .current!.insert(schema.verification)
      .values([row("plex-data-pin:admin-1"), row("plex-data-pending:admin-1"), row("plex-pin:fake-state")])
      .run();

    clearPlexDataConnection();

    const left = testDb.current!.select().from(schema.verification).all().map((r) => r.identifier);
    expect(left).toEqual(["plex-pin:fake-state"]);
  });
});
