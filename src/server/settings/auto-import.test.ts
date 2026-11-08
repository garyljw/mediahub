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

import { readAutoImportMatchedById, saveAutoImportMatchedById } from "./auto-import";

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  testDb.current = instance;
});

describe("readAutoImportMatchedById", () => {
  it("is off when nothing is stored", () => {
    expect(readAutoImportMatchedById()).toBe(false);
  });

  it("reads back the saved value, including after it is turned off again", () => {
    saveAutoImportMatchedById(true);
    expect(readAutoImportMatchedById()).toBe(true);

    saveAutoImportMatchedById(false);
    expect(readAutoImportMatchedById()).toBe(false);
  });
});
