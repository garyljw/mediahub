import "server-only";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { PlexRequestError } from "@/server/plex/errors";

// Each test gets a fresh in-memory database with the real migrations applied, so the Focus list and the stored
// collection are real rows. Plex, the watched index and the Arr lists are mocked.
const testDb = vi.hoisted(() => ({ current: undefined as BetterSQLite3Database<typeof schema> | undefined }));
const envState = vi.hoisted(() => ({ focusSync: true, testName: undefined as string | undefined }));
const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getPlexDataConnection: vi.fn(),
  getServerIdentity: vi.fn(),
  createCollection: vi.fn(),
  getCollectionItemKeys: vi.fn(),
  addCollectionItem: vi.fn(),
  removeCollectionItem: vi.fn(),
  moveCollectionItem: vi.fn(),
  setCollectionCustomOrder: vi.fn(),
  pinCollectionToHome: vi.fn(),
  deleteCollection: vi.fn(),
  getWatchedIndex: vi.fn(),
  listMovies: vi.fn(),
  listSeries: vi.fn(),
}));

vi.mock("@/server/db", () => ({ db: () => testDb.current }));
vi.mock("@/server/env", () => ({
  env: () => ({ MEDIAHUB_PLEX_FOCUS_SYNC: envState.focusSync, MEDIAHUB_PLEX_FOCUS_TEST_NAME: envState.testName }),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/server/plex/data-connection", () => ({ getPlexDataConnection: mocks.getPlexDataConnection }));
vi.mock("@/server/plex/watched", () => ({ getWatchedIndex: mocks.getWatchedIndex }));
vi.mock("@/server/plex/server", () => ({
  getServerIdentity: mocks.getServerIdentity,
  createCollection: mocks.createCollection,
  getCollectionItemKeys: mocks.getCollectionItemKeys,
  addCollectionItem: mocks.addCollectionItem,
  removeCollectionItem: mocks.removeCollectionItem,
  moveCollectionItem: mocks.moveCollectionItem,
  setCollectionCustomOrder: mocks.setCollectionCustomOrder,
  pinCollectionToHome: mocks.pinCollectionToHome,
  deleteCollection: mocks.deleteCollection,
}));
vi.mock("@/server/arr/movies", () => ({ listMovies: mocks.listMovies }));
vi.mock("@/server/arr/series", () => ({ listSeries: mocks.listSeries }));

import { addToFocus } from "./focus";
import { requestFocusSync, resetFocusSyncForTests, syncFocusIfStale, syncFocusToPlex } from "./plex-sync";

const TOKEN = "fake-plex-data-token-0123456789abcdef";
const SERVER_ID = "fakefriendmachine0123456789abcdef0123";
const CONNECTION = {
  url: "https://192-168-10-5.fakehash.plex.direct:32400",
  pinAddress: "192.168.10.5",
  token: TOKEN,
  serverId: SERVER_ID,
  serverName: "Fake Friend Server",
};
const SERVER = { url: CONNECTION.url, pinAddress: CONNECTION.pinAddress };
const MOVIE_KEY = "plex.focusCollection.movie";

/** A watched index with only the item keys the sync reads. Maps are external id -> items. */
function watchedIndex(movie: Record<number, { sectionKey: string; ratingKey: string }[]>, series: Record<number, { sectionKey: string; ratingKey: string }[]> = {}) {
  return {
    movies: new Map(),
    series: new Map(),
    showKeys: new Map(),
    itemKeys: { movie: new Map(Object.entries(movie).map(([id, keys]) => [Number(id), keys])), series: new Map(Object.entries(series).map(([id, keys]) => [Number(id), keys])) },
  };
}

/** Focus movie rows 1, 2, 3 with TMDB ids 101, 102, 103. Plex has 11, 12, 13 in section 1 for them. */
function useStandardLibrary() {
  mocks.listMovies.mockResolvedValue({
    rows: [
      { id: 1, tmdbId: 101 },
      { id: 2, tmdbId: 102 },
      { id: 3, tmdbId: 103 },
    ],
    profiles: [],
  });
  mocks.getWatchedIndex.mockResolvedValue(
    watchedIndex({
      101: [{ sectionKey: "1", ratingKey: "11" }],
      102: [{ sectionKey: "1", ratingKey: "12" }],
      103: [{ sectionKey: "1", ratingKey: "13" }],
    }),
  );
}

function storedRecord(value: unknown) {
  const now = new Date();
  testDb.current!
    .insert(schema.setting)
    .values({ key: MOVIE_KEY, value: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value: JSON.stringify(value), updatedAt: now } })
    .run();
}

function storedValue(key = MOVIE_KEY): string | undefined {
  return testDb.current!.select().from(schema.setting).all().find((row) => row.key === key)?.value;
}

beforeEach(() => {
  // resetAllMocks also clears queued mockResolvedValueOnce values, so one test's queue can't reach the next.
  vi.resetAllMocks();
  const instance = drizzle(new Database(":memory:"), { schema });
  migrate(instance, { migrationsFolder: join(__dirname, "..", "..", "..", "drizzle") });
  const now = new Date();
  instance
    .insert(schema.user)
    .values({ id: "u1", name: "A", email: "a@example.test", emailVerified: false, role: "requester", createdAt: now, updatedAt: now })
    .run();
  testDb.current = instance;
  resetFocusSyncForTests();
  envState.focusSync = true;
  envState.testName = undefined;

  mocks.getPlexDataConnection.mockReturnValue(CONNECTION);
  mocks.getServerIdentity.mockResolvedValue(SERVER_ID);
  mocks.createCollection.mockResolvedValue("900");
  mocks.getCollectionItemKeys.mockResolvedValue([]);
  mocks.addCollectionItem.mockResolvedValue(undefined);
  mocks.removeCollectionItem.mockResolvedValue(undefined);
  mocks.moveCollectionItem.mockResolvedValue(undefined);
  mocks.setCollectionCustomOrder.mockResolvedValue(undefined);
  mocks.pinCollectionToHome.mockResolvedValue(undefined);
  mocks.deleteCollection.mockResolvedValue(undefined);
  useStandardLibrary();
  addToFocus("movie", 1, "u1");
  addToFocus("movie", 2, "u1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("no Plex data connection", () => {
  it("makes no Plex call and writes nothing", async () => {
    mocks.getPlexDataConnection.mockReturnValue(null);
    await syncFocusToPlex("movie");
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
    expect(mocks.createCollection).not.toHaveBeenCalled();
    expect(storedValue()).toBeUndefined();
  });
});

describe("the server check", () => {
  it("writes nothing when the address answers as a different server", async () => {
    mocks.getServerIdentity.mockResolvedValue("someone-else-machine-id");
    await syncFocusToPlex("movie");
    expect(console.error).toHaveBeenCalledWith("Plex Focus sync: server identity did not match");
    expect(mocks.createCollection).not.toHaveBeenCalled();
    expect(mocks.addCollectionItem).not.toHaveBeenCalled();
    expect(mocks.removeCollectionItem).not.toHaveBeenCalled();
    expect(mocks.moveCollectionItem).not.toHaveBeenCalled();
  });

  it("checks the identity with a 3 second timeout, before any write", async () => {
    await syncFocusToPlex("movie");
    expect(mocks.getServerIdentity).toHaveBeenCalledWith(SERVER, { timeoutMs: 3000 });
    expect(mocks.getServerIdentity.mock.invocationCallOrder[0]).toBeLessThan(mocks.createCollection.mock.invocationCallOrder[0]!);
  });
});

describe("the first sync", () => {
  it("creates the collection, saves it, sets its custom order, pins it, then adds the items in list order", async () => {
    await syncFocusToPlex("movie");

    expect(mocks.createCollection).toHaveBeenCalledWith(SERVER, TOKEN, {
      kind: "movie",
      title: "Movie Focus",
      sectionKey: "1",
    });
    expect(JSON.parse(storedValue()!)).toEqual({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "900", setUp: true, testName: null });
    expect(mocks.setCollectionCustomOrder).toHaveBeenCalledWith(SERVER, TOKEN, "900");
    expect(mocks.pinCollectionToHome).toHaveBeenCalledWith(SERVER, TOKEN, "1", "900");

    const created = mocks.createCollection.mock.invocationCallOrder[0]!;
    expect(created).toBeLessThan(mocks.setCollectionCustomOrder.mock.invocationCallOrder[0]!);
    expect(mocks.setCollectionCustomOrder.mock.invocationCallOrder[0]!).toBeLessThan(mocks.pinCollectionToHome.mock.invocationCallOrder[0]!);
    expect(mocks.pinCollectionToHome.mock.invocationCallOrder[0]!).toBeLessThan(mocks.addCollectionItem.mock.invocationCallOrder[0]!);

    expect(mocks.addCollectionItem.mock.calls.map((call) => call[2])).toEqual([
      { collectionKey: "900", machineId: SERVER_ID, itemKey: "11" },
      { collectionKey: "900", machineId: SERVER_ID, itemKey: "12" },
    ]);
    expect(mocks.removeCollectionItem).not.toHaveBeenCalled();
    expect(mocks.moveCollectionItem).not.toHaveBeenCalled();
  });

  it("names the collection for TV Focus when the series list syncs", async () => {
    addToFocus("series", 9, "u1");
    mocks.listSeries.mockResolvedValue({ rows: [{ id: 9, tvdbId: 555 }], profiles: [] });
    mocks.getWatchedIndex.mockResolvedValue(watchedIndex({}, { 555: [{ sectionKey: "2", ratingKey: "77" }] }));
    await syncFocusToPlex("series");
    expect(mocks.createCollection).toHaveBeenCalledWith(SERVER, TOKEN, { kind: "series", title: "TV Focus", sectionKey: "2" });
    expect(storedValue("plex.focusCollection.series")).toBeDefined();
  });
});

describe("set-up retry", () => {
  it("keeps the collection unfinished when the pin fails, and the next sync pins it without creating another", async () => {
    mocks.pinCollectionToHome.mockRejectedValueOnce(new PlexRequestError("Plex hub pin request failed: HTTP 500", "http", 500));
    await syncFocusToPlex("movie");
    expect(JSON.parse(storedValue()!)).toEqual({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "900", setUp: false, testName: null });
    expect(mocks.addCollectionItem).not.toHaveBeenCalled();

    mocks.getCollectionItemKeys.mockResolvedValueOnce([]).mockResolvedValueOnce(["11", "12"]);
    await syncFocusToPlex("movie");
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
    expect(mocks.setCollectionCustomOrder).toHaveBeenCalledTimes(2);
    expect(mocks.pinCollectionToHome).toHaveBeenCalledTimes(2);
    expect(mocks.pinCollectionToHome).toHaveBeenLastCalledWith(SERVER, TOKEN, "1", "900");
    expect(JSON.parse(storedValue()!)).toMatchObject({ setUp: true });
    expect(mocks.addCollectionItem).toHaveBeenCalledTimes(2);
  });

  it("does not pin again once set-up is done", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["11", "12"]).mockResolvedValueOnce(["11", "12"]);
    await syncFocusToPlex("movie");
    expect(mocks.setCollectionCustomOrder).not.toHaveBeenCalled();
    expect(mocks.pinCollectionToHome).not.toHaveBeenCalled();
  });

  it("treats a stored record without the set-up flag as unreadable", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800" });
    await syncFocusToPlex("movie");
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
  });
});

describe("later syncs", () => {
  it("recreates the collection when the stored one is gone from Plex", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });
    mocks.getCollectionItemKeys.mockResolvedValueOnce(null).mockResolvedValueOnce(["11", "12"]);

    await syncFocusToPlex("movie");
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storedValue()!)).toMatchObject({ collectionKey: "900" });
    expect(mocks.deleteCollection).not.toHaveBeenCalled();
  });

  it("deletes the stored collection and makes one in the new section when the plan moves to another section", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "2", collectionKey: "800", setUp: true });
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["11", "12"]);

    await syncFocusToPlex("movie");
    expect(mocks.deleteCollection).toHaveBeenCalledWith(SERVER, TOKEN, "800");
    expect(mocks.createCollection).toHaveBeenCalledWith(SERVER, TOKEN, { kind: "movie", title: "Movie Focus", sectionKey: "1" });
    expect(JSON.parse(storedValue()!)).toMatchObject({ sectionKey: "1", collectionKey: "900" });
  });

  it("removes items that are not on the list, and adds the ones that are missing", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["12", "99"]).mockResolvedValueOnce(["12", "11", "13"]);
    addToFocus("movie", 3, "u1");

    await syncFocusToPlex("movie");
    expect(mocks.removeCollectionItem).toHaveBeenCalledWith(SERVER, TOKEN, "800", "99");
    expect(mocks.addCollectionItem.mock.calls.map((call) => call[2].itemKey)).toEqual(["11", "13"]);
  });

  it("moves only what is needed to match the list order", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });
    addToFocus("movie", 3, "u1");
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["12", "11", "13"]).mockResolvedValueOnce(["12", "11", "13"]);

    await syncFocusToPlex("movie");
    expect(mocks.addCollectionItem).not.toHaveBeenCalled();
    expect(mocks.moveCollectionItem.mock.calls).toEqual([[SERVER, TOKEN, "800", "11", null]]);
  });

  it("empties a stored collection when no title is in Plex", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });
    mocks.getWatchedIndex.mockResolvedValue(watchedIndex({}));
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["11", "12"]).mockResolvedValueOnce([]);

    await syncFocusToPlex("movie");
    expect(mocks.removeCollectionItem.mock.calls.map((call) => call[3])).toEqual(["11", "12"]);
    expect(mocks.createCollection).not.toHaveBeenCalled();
    expect(JSON.parse(storedValue()!)).toMatchObject({ collectionKey: "800", setUp: true });
  });

  it("leaves out a title not in Plex until it arrives, then adds it on the next sync", async () => {
    mocks.getWatchedIndex.mockResolvedValue(watchedIndex({ 101: [{ sectionKey: "1", ratingKey: "11" }] }));
    mocks.getCollectionItemKeys.mockResolvedValue(["11"]);
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });

    await syncFocusToPlex("movie");
    expect(mocks.addCollectionItem).not.toHaveBeenCalled();

    mocks.getWatchedIndex.mockResolvedValue(watchedIndex({ 101: [{ sectionKey: "1", ratingKey: "11" }], 102: [{ sectionKey: "1", ratingKey: "12" }] }));
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["11"]).mockResolvedValueOnce(["11", "12"]);
    await syncFocusToPlex("movie");
    expect(mocks.addCollectionItem.mock.calls.map((call) => call[2].itemKey)).toEqual(["12"]);
  });

  it("ignores a stored record for another server and makes a new collection on this one", async () => {
    storedRecord({ serverId: "some-other-server-id", sectionKey: "1", collectionKey: "800", setUp: true });
    await syncFocusToPlex("movie");
    expect(mocks.getCollectionItemKeys).not.toHaveBeenCalledWith(SERVER, TOKEN, "800");
    expect(mocks.createCollection).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storedValue()!)).toMatchObject({ serverId: SERVER_ID, collectionKey: "900" });
  });

  it("stops when the collection does not match after the changes, and makes no moves", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["12", "11"]).mockResolvedValueOnce(["12", "11", "99"]);
    addToFocus("movie", 3, "u1");

    await syncFocusToPlex("movie");
    expect(console.error).toHaveBeenCalledWith("Plex Focus sync: collection did not match after changes");
    expect(mocks.moveCollectionItem).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  it("logs a Plex failure by its message only, never the token", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });
    mocks.getCollectionItemKeys.mockRejectedValue(new PlexRequestError("Plex collection items request failed: HTTP 500", "http", 500));

    await expect(syncFocusToPlex("movie")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Plex Focus sync: Plex collection items request failed: HTTP 500");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(TOKEN);
  });

  it("logs any other error by its name only, and never throws", async () => {
    mocks.getWatchedIndex.mockRejectedValue(new TypeError(`bad value ${TOKEN}`));
    await expect(syncFocusToPlex("movie")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Plex Focus sync: stopped by TypeError");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(TOKEN);
  });
});

describe("overlapping syncs", () => {
  it("runs exactly one more sync when a call arrives during a sync", async () => {
    const first = syncFocusToPlex("movie");
    await syncFocusToPlex("movie");
    await first;
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(2);
  });

  it("runs no extra sync when nothing arrives during it", async () => {
    await syncFocusToPlex("movie");
    expect(mocks.getServerIdentity).toHaveBeenCalledTimes(1);
  });
});

describe("requests", () => {
  it("runs the sync after the response, through next's after", () => {
    requestFocusSync("movie");
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
  });

  it("asks for both kinds when none has been asked for, and not again for 5 minutes", () => {
    vi.useFakeTimers();
    syncFocusIfStale();
    expect(mocks.after).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(4 * 60_000);
    syncFocusIfStale();
    expect(mocks.after).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2 * 60_000);
    syncFocusIfStale();
    expect(mocks.after).toHaveBeenCalledTimes(4);
  });

  it("asks again at the next visit when the last sync failed", async () => {
    mocks.getServerIdentity.mockRejectedValueOnce(new PlexRequestError("Plex server identity request timed out", "timeout"));
    requestFocusSync("movie");
    await (mocks.after.mock.calls[0]![0] as () => Promise<void>)();
    syncFocusIfStale();
    // Both kinds: series was never asked for, and movie failed.
    expect(mocks.after).toHaveBeenCalledTimes(3);
  });

  it("asks again at the next visit when Plex's index couldn't be loaded", async () => {
    mocks.getWatchedIndex.mockResolvedValueOnce("failed");
    requestFocusSync("movie");
    await (mocks.after.mock.calls[0]![0] as () => Promise<void>)();
    requestFocusSync("series");
    syncFocusIfStale();
    expect(mocks.after).toHaveBeenCalledTimes(3);
  });

  it("waits 5 minutes after a sync that finished", async () => {
    // A new collection reads back empty, then with both items after they are added.
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["11", "12"]);
    requestFocusSync("movie");
    await (mocks.after.mock.calls[0]![0] as () => Promise<void>)();
    requestFocusSync("series");
    syncFocusIfStale();
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });

  it("counts a change's own request as the last attempt for that kind", () => {
    vi.useFakeTimers();
    requestFocusSync("series");
    expect(mocks.after).toHaveBeenCalledTimes(1);
    syncFocusIfStale();
    // The series kind was just requested, so only the movie kind is asked for.
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });
});

describe("sync turned off", () => {
  it.each(["movie", "series"] as const)("makes no Plex or Arr call and writes nothing for %s", async (kind) => {
    envState.focusSync = false;
    addToFocus("series", 9, "u1");
    await syncFocusToPlex(kind);
    expect(mocks.getPlexDataConnection).not.toHaveBeenCalled();
    expect(mocks.getServerIdentity).not.toHaveBeenCalled();
    expect(mocks.listMovies).not.toHaveBeenCalled();
    expect(mocks.listSeries).not.toHaveBeenCalled();
    expect(mocks.getWatchedIndex).not.toHaveBeenCalled();
    expect(mocks.createCollection).not.toHaveBeenCalled();
    expect(mocks.deleteCollection).not.toHaveBeenCalled();
    expect(storedValue(kind === "movie" ? MOVIE_KEY : "plex.focusCollection.series")).toBeUndefined();
  });

  it("does not run a sync after a change, and records no request time", () => {
    vi.useFakeTimers();
    envState.focusSync = false;
    requestFocusSync("movie");
    syncFocusIfStale();
    expect(mocks.after).not.toHaveBeenCalled();

    // Once sync is back on, the first visit asks for both kinds: no request time was recorded while it was off.
    envState.focusSync = true;
    syncFocusIfStale();
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });
});

describe("test name", () => {
  it("titles the collections with the test name, sets the custom order, and does not pin them to Home", async () => {
    envState.testName = "dev";
    await syncFocusToPlex("movie");
    expect(mocks.createCollection).toHaveBeenCalledWith(SERVER, TOKEN, { kind: "movie", title: "Movie Focus (dev)", sectionKey: "1" });
    expect(mocks.setCollectionCustomOrder).toHaveBeenCalledWith(SERVER, TOKEN, "900");
    expect(mocks.pinCollectionToHome).not.toHaveBeenCalled();
    expect(JSON.parse(storedValue()!)).toEqual({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "900", setUp: true, testName: "dev" });
    expect(mocks.addCollectionItem.mock.calls.map((call) => call[2].itemKey)).toEqual(["11", "12"]);
  });

  it("never edits the real collection from a copy with a test name, and makes its own instead", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true, testName: null });
    envState.testName = "dev";
    await syncFocusToPlex("movie");
    expect(mocks.getCollectionItemKeys).not.toHaveBeenCalledWith(SERVER, TOKEN, "800");
    expect(mocks.removeCollectionItem).not.toHaveBeenCalledWith(SERVER, TOKEN, "800", expect.anything());
    expect(mocks.deleteCollection).not.toHaveBeenCalled();
    expect(mocks.createCollection).toHaveBeenCalledWith(SERVER, TOKEN, { kind: "movie", title: "Movie Focus (dev)", sectionKey: "1" });
    expect(JSON.parse(storedValue()!)).toMatchObject({ collectionKey: "900", testName: "dev" });
  });

  it("never adopts a test collection once the test name is removed, and makes a real, pinned one", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true, testName: "dev" });
    await syncFocusToPlex("movie");
    expect(mocks.getCollectionItemKeys).not.toHaveBeenCalledWith(SERVER, TOKEN, "800");
    expect(mocks.createCollection).toHaveBeenCalledWith(SERVER, TOKEN, { kind: "movie", title: "Movie Focus", sectionKey: "1" });
    expect(mocks.pinCollectionToHome).toHaveBeenCalledWith(SERVER, TOKEN, "1", "900");
    expect(JSON.parse(storedValue()!)).toMatchObject({ collectionKey: "900", testName: null });
  });

  it("reads a record saved before the test name was stored as the real collection", async () => {
    storedRecord({ serverId: SERVER_ID, sectionKey: "1", collectionKey: "800", setUp: true });
    mocks.getCollectionItemKeys.mockResolvedValueOnce(["11", "12"]).mockResolvedValueOnce(["11", "12"]);
    await syncFocusToPlex("movie");
    expect(mocks.createCollection).not.toHaveBeenCalled();
    expect(mocks.getCollectionItemKeys).toHaveBeenCalledWith(SERVER, TOKEN, "800");
  });

  it("titles the series collection with the test name too", async () => {
    envState.testName = "dev";
    addToFocus("series", 9, "u1");
    mocks.listSeries.mockResolvedValue({ rows: [{ id: 9, tvdbId: 555 }], profiles: [] });
    mocks.getWatchedIndex.mockResolvedValue(watchedIndex({}, { 555: [{ sectionKey: "2", ratingKey: "77" }] }));
    await syncFocusToPlex("series");
    expect(mocks.createCollection).toHaveBeenCalledWith(SERVER, TOKEN, { kind: "series", title: "TV Focus (dev)", sectionKey: "2" });
    expect(mocks.pinCollectionToHome).not.toHaveBeenCalled();
  });
});
