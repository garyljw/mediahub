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
const envState = vi.hoisted(() => ({ secret: undefined as string | undefined }));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));
vi.mock("@/server/env", () => ({ env: () => ({ BETTER_AUTH_SECRET: envState.secret }) }));

import { getAuthSecret } from "./auth-secret";

const ENV_SECRET = "fake-env-secret-0123456789abcdefghij";

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
  envState.secret = undefined;
});

function storedValue(): string | undefined {
  return testDb.current!.select().from(schema.setting).where(eq(schema.setting.key, "auth.secret")).get()?.value;
}

describe("getAuthSecret", () => {
  it("uses BETTER_AUTH_SECRET from the environment when set, and stores nothing", () => {
    envState.secret = ENV_SECRET;
    expect(getAuthSecret()).toBe(ENV_SECRET);
    expect(storedValue()).toBeUndefined();
  });

  it("prefers the environment value over a stored one", () => {
    testDb.current!.insert(schema.setting).values({ key: "auth.secret", value: "fake-stored-secret-0123456789abcdef", updatedAt: new Date() }).run();
    envState.secret = ENV_SECRET;
    expect(getAuthSecret()).toBe(ENV_SECRET);
  });

  it("generates a secret of at least 32 characters once, then returns the same one", () => {
    const first = getAuthSecret();
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(getAuthSecret()).toBe(first);
    expect(storedValue()).toBe(first);
  });

  it("returns the stored value when another writer got there first", () => {
    testDb.current!.insert(schema.setting).values({ key: "auth.secret", value: "fake-other-writer-secret-0123456789", updatedAt: new Date() }).run();
    expect(getAuthSecret()).toBe("fake-other-writer-secret-0123456789");
    expect(testDb.current!.select().from(schema.setting).all()).toHaveLength(1);
  });
});
