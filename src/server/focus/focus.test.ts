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

import {
  FocusLimitError,
  FocusOrderError,
  MAX_FOCUS_ITEMS,
  addToFocus,
  focusMembership,
  listFocusIds,
  reorderFocus,
  removeFromFocus,
} from "./focus";

beforeEach(() => {
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  const now = new Date();
  instance
    .insert(schema.user)
    .values({ id: "u1", name: "A", email: "a@example.test", emailVerified: false, role: "requester", createdAt: now, updatedAt: now })
    .run();
  testDb.current = instance;
});

describe("focus lists", () => {
  it("appends in add order and ignores a repeat add", () => {
    addToFocus("movie", 30, "u1");
    addToFocus("movie", 10, "u1");
    addToFocus("movie", 30, "u1");
    expect(listFocusIds("movie")).toEqual([30, 10]);
  });

  it("keeps movies and series apart, so the same number can be in both", () => {
    addToFocus("movie", 7, "u1");
    addToFocus("series", 7, "u1");
    expect(listFocusIds("movie")).toEqual([7]);
    expect(listFocusIds("series")).toEqual([7]);
    removeFromFocus("movie", [7]);
    expect(listFocusIds("series")).toEqual([7]);
  });

  it("reports membership per kind", () => {
    addToFocus("movie", 1, "u1");
    addToFocus("series", 2, "u1");
    expect(focusMembership()).toEqual({ movie: new Set([1]), series: new Set([2]) });
  });

  it("closes the gap when an item is removed, and ignores a missing one", () => {
    addToFocus("series", 1, "u1");
    addToFocus("series", 2, "u1");
    addToFocus("series", 3, "u1");
    removeFromFocus("series", [2]);
    removeFromFocus("series", [99]);
    expect(listFocusIds("series")).toEqual([1, 3]);
    addToFocus("series", 4, "u1");
    expect(listFocusIds("series")).toEqual([1, 3, 4]);
  });

  it("removes several items in one call, closing every gap", () => {
    [1, 2, 3, 4, 5].forEach((id) => addToFocus("movie", id, "u1"));
    expect(removeFromFocus("movie", [4, 2, 77])).toBe(2);
    expect(listFocusIds("movie")).toEqual([1, 3, 5]);
  });

  it("does nothing for an empty id list", () => {
    addToFocus("movie", 1, "u1");
    expect(removeFromFocus("movie", [])).toBe(0);
    expect(listFocusIds("movie")).toEqual([1]);
  });

  it("reorders to a full permutation", () => {
    addToFocus("movie", 1, "u1");
    addToFocus("movie", 2, "u1");
    addToFocus("movie", 3, "u1");
    reorderFocus("movie", [3, 1, 2]);
    expect(listFocusIds("movie")).toEqual([3, 1, 2]);
  });

  it("refuses a stale or invalid reorder and writes nothing", () => {
    addToFocus("movie", 1, "u1");
    addToFocus("movie", 2, "u1");
    expect(() => reorderFocus("movie", [2])).toThrow(FocusOrderError);
    expect(() => reorderFocus("movie", [2, 2])).toThrow(FocusOrderError);
    expect(() => reorderFocus("movie", [1, 2, 3])).toThrow(FocusOrderError);
    expect(listFocusIds("movie")).toEqual([1, 2]);
  });

  it("refuses an add past the per-kind limit", () => {
    for (let id = 1; id <= MAX_FOCUS_ITEMS; id += 1) addToFocus("movie", id, "u1");
    expect(() => addToFocus("movie", MAX_FOCUS_ITEMS + 1, "u1")).toThrow(FocusLimitError);
    expect(listFocusIds("movie")).toHaveLength(MAX_FOCUS_ITEMS);
  });

  it("clears added_by when the user is deleted, and keeps the item", () => {
    addToFocus("movie", 5, "u1");
    testDb.current!.delete(schema.user).run();
    expect(listFocusIds("movie")).toEqual([5]);
  });
});
