import "server-only";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { FOCUS_KINDS, FOCUS_NAME, type FocusKind } from "@/components/focus/focus-kinds";
import { env } from "@/server/env";
import { listMovies } from "@/server/arr/movies";
import { listSeries } from "@/server/arr/series";
import { ArrRequestError } from "@/server/arr/request";
import { db } from "@/server/db";
import { setting } from "@/server/db/schema";
import { collectionMoves, planFocusCollection } from "@/server/merge/focus-sync";
import { getPlexDataConnection } from "@/server/plex/data-connection";
import { PlexRequestError } from "@/server/plex/errors";
import {
  addCollectionItem,
  createCollection,
  deleteCollection,
  getCollectionItemKeys,
  getServerIdentity,
  moveCollectionItem,
  pinCollectionToHome,
  removeCollectionItem,
  setCollectionCustomOrder,
  type ServerConnection,
} from "@/server/plex/server";
import { getWatchedIndex } from "@/server/plex/watched";
import { listFocusIds } from "./focus";

// Keeps each Focus list's Plex collection in step with MediaHub's list. MediaHub wins: each sync makes the collection's
// items and order match the list, so items added in Plex are removed. The title and the pin are only set when the
// collection is made, so a rename or unpin done in Plex stays. The collection's key is stored in the setting table, and
// the token is only ever sent to the Plex server (see server/plex/server.ts).

/** A stored collection is only used when its server is the connected one. Its keys are Plex ratingKeys (digits). */
const KEY = z.string().regex(/^\d+$/);
// `setUp` is true once custom order and the Home pin have been set. Until then each sync tries them again (both are
// safe to repeat: checked live, a second pin leaves one row).
const StoredCollection = z.object({
  serverId: z.string().min(1),
  sectionKey: KEY,
  collectionKey: KEY,
  setUp: z.boolean(),
  // The test name the collection was made under (MEDIAHUB_PLEX_FOCUS_TEST_NAME), or null for the real collection. A
  // record saved before this field existed is a real one. A collection made under another name is not used (see
  // readStored), so a test copy never edits the real collection and the real copy never adopts a test one.
  testName: z.string().nullable().default(null),
});
type StoredCollection = z.infer<typeof StoredCollection>;

/** How long a sync attempt is reused before Home or a Focus page asks for another. */
const STALE_AFTER_MS = 5 * 60_000;
// The identity check answers fast on a working server, so a short timeout stops a dead address holding up the sync.
const IDENTITY_TIMEOUT_MS = 3_000;

// The last time a sync was requested for each kind. In memory, so it is per process; a restart asks again.
const lastRequested = new Map<FocusKind, number>();
// Each kind's sync state: running, and whether another change arrived while it ran.
type RunState = { running: boolean; again: boolean };
const runs = new Map<FocusKind, RunState>();

/**
 * False when this copy's settings turn Focus sync off (MEDIAHUB_PLEX_FOCUS_SYNC=false). Then nothing is requested, read
 * or written in Plex. env() is read once per process, so a change needs a restart.
 */
function syncEnabled(): boolean {
  return env().MEDIAHUB_PLEX_FOCUS_SYNC;
}

/**
 * The title of a new collection. A test name tells a second copy's collections apart, e.g. "TV Focus (dev)". The title
 * is only set when the collection is made. A change of test name makes a new collection instead (see readStored).
 */
function collectionTitle(kind: FocusKind, testName: string | null): string {
  return testName ? `${FOCUS_NAME[kind]} (${testName})` : FOCUS_NAME[kind];
}

function settingKey(kind: FocusKind): string {
  return `plex.focusCollection.${kind}`;
}

/**
 * The stored collection for this kind, or null when none is stored, it belongs to a different server, or it was made
 * under a different test name. Null means a new collection is made; the other one is left in Plex untouched.
 */
function readStored(kind: FocusKind, serverId: string, testName: string | null): StoredCollection | null {
  const raw = db().select().from(setting).where(eq(setting.key, settingKey(kind))).get()?.value;
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = StoredCollection.safeParse(json);
  if (!parsed.success || parsed.data.serverId !== serverId || parsed.data.testName !== testName) return null;
  return parsed.data;
}

function saveStored(kind: FocusKind, value: StoredCollection): void {
  const updatedAt = new Date();
  const json = JSON.stringify(value);
  db()
    .insert(setting)
    .values({ key: settingKey(kind), value: json, updatedAt })
    .onConflictDoUpdate({ target: setting.key, set: { value: json, updatedAt } })
    .run();
}

function forgetStored(kind: FocusKind): void {
  db().delete(setting).where(eq(setting.key, settingKey(kind))).run();
}

/** The external id (TMDB for movies, TVDB for series) of each library title, by Arr id. Titles without one are left out. */
async function externalIdsFor(kind: FocusKind): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (kind === "movie") {
    const { rows } = await listMovies();
    for (const row of rows) if (row.tmdbId !== null) map.set(row.id, row.tmdbId);
  } else {
    const { rows } = await listSeries();
    for (const row of rows) if (row.tvdbId !== null) map.set(row.id, row.tvdbId);
  }
  return map;
}

/** True when the collection holds exactly the wanted keys, each once, in any order. */
function sameKeys(actual: readonly string[], wanted: readonly string[]): boolean {
  const expected = new Set(wanted);
  return new Set(actual).size === actual.length && actual.length === expected.size && actual.every((key) => expected.has(key));
}

/**
 * One full sync of a kind. Returns "done" when Plex now matches or there is nothing to do, and "skipped" when it
 * stopped before finishing (Plex unreachable, or not the stored server). Throws a Plex or Arr request error (or anything
 * else) for the caller to log. Writes happen only after the server identity check passes.
 */
async function syncOnce(kind: FocusKind): Promise<"done" | "skipped"> {
  // Checked first, so a copy with sync off reads and writes nothing, here or in Plex.
  if (!syncEnabled()) return "done";
  const testName = env().MEDIAHUB_PLEX_FOCUS_TEST_NAME ?? null;
  const connection = getPlexDataConnection();
  if (!connection) return "done";
  const server: ServerConnection = { url: connection.url, pinAddress: connection.pinAddress };
  const token = connection.token;

  let stored = readStored(kind, connection.serverId, testName);
  const ids = listFocusIds(kind);
  if (ids.length === 0 && stored === null) return "done";

  const [externalIds, index] = await Promise.all([externalIdsFor(kind), getWatchedIndex()]);
  if (index === null) return "done";
  if (index === "failed") return "skipped";

  // The token is not sent to an address that isn't the stored server. This is the first Plex call that carries it.
  const identity = await getServerIdentity(server, { timeoutMs: IDENTITY_TIMEOUT_MS });
  if (identity !== connection.serverId) {
    console.error("Plex Focus sync: server identity did not match");
    return "skipped";
  }

  const plan = planFocusCollection({
    ids,
    externalIds,
    itemKeys: kind === "movie" ? index.itemKeys.movie : index.itemKeys.series,
    storedSectionKey: stored?.sectionKey ?? null,
  });
  if (plan === null && stored === null) return "done";
  const wanted = plan?.wanted ?? [];

  // A collection in another section than the plan is deleted, and a new one is made in the planned section.
  if (stored && plan && stored.sectionKey !== plan.sectionKey) {
    await deleteCollection(server, token, stored.collectionKey);
    forgetStored(kind);
    stored = null;
  }

  let collection: { collectionKey: string; current: string[] } | null = null;
  if (stored) {
    const current = await getCollectionItemKeys(server, token, stored.collectionKey);
    // Gone from Plex: forget it, and a new one is made below.
    if (current === null) {
      forgetStored(kind);
      stored = null;
    } else {
      collection = { collectionKey: stored.collectionKey, current };
    }
  }

  if (collection === null) {
    if (plan === null) return "done";
    const collectionKey = await createCollection(server, token, {
      kind: kind === "movie" ? "movie" : "series",
      title: collectionTitle(kind, testName),
      sectionKey: plan.sectionKey,
    });
    // Saved at once, so a later failure in this sync doesn't leave a collection MediaHub has forgotten.
    stored = { serverId: connection.serverId, sectionKey: plan.sectionKey, collectionKey, setUp: false, testName };
    saveStored(kind, stored);
    collection = { collectionKey, current: [] };
  }

  // Custom order and the Home pin, for a new collection or one whose set-up failed part way in an earlier sync.
  if (stored && !stored.setUp) {
    await setCollectionCustomOrder(server, token, stored.collectionKey);
    // A test-name collection stays unpinned, so it doesn't sit on Home beside the real lists.
    if (!testName) await pinCollectionToHome(server, token, stored.sectionKey, stored.collectionKey);
    saveStored(kind, { ...stored, setUp: true });
  }

  const { collectionKey, current } = collection;
  const wantedSet = new Set(wanted);
  for (const itemKey of current) {
    if (!wantedSet.has(itemKey)) await removeCollectionItem(server, token, collectionKey, itemKey);
  }
  const kept = new Set(current.filter((itemKey) => wantedSet.has(itemKey)));
  for (const itemKey of wanted) {
    if (!kept.has(itemKey)) {
      await addCollectionItem(server, token, { collectionKey, machineId: connection.serverId, itemKey });
    }
  }

  // The order is only changed once the set of items is confirmed to match.
  const readBack = await getCollectionItemKeys(server, token, collectionKey);
  if (readBack === null || !sameKeys(readBack, wanted)) {
    console.error("Plex Focus sync: collection did not match after changes");
    return "skipped";
  }
  for (const move of collectionMoves(readBack, wanted)) {
    await moveCollectionItem(server, token, collectionKey, move.itemKey, move.after);
  }
  return "done";
}

/**
 * Runs one sync and never throws. A Plex or Arr failure is logged by its message; anything else by its name only. A
 * sync that didn't finish forgets its request time, so the next Home or Focus page visit tries again instead of
 * waiting 5 minutes.
 */
async function syncSafely(kind: FocusKind): Promise<void> {
  let result: "done" | "skipped" = "skipped";
  try {
    result = await syncOnce(kind);
  } catch (error) {
    if (error instanceof PlexRequestError || error instanceof ArrRequestError) {
      // Their messages name the step and the kind or status only, so they are safe to log.
      console.error(`Plex Focus sync: ${error.message}`);
    } else {
      console.error(`Plex Focus sync: stopped by ${error instanceof Error ? error.name : "an unknown error"}`);
    }
  }
  if (result === "skipped") lastRequested.delete(kind);
}

/**
 * Syncs one kind to Plex. At most one sync per kind runs at a time. A call made while one is running sets a flag, and
 * exactly one more sync runs after it, so the last change always reaches Plex. Never throws.
 */
export async function syncFocusToPlex(kind: FocusKind): Promise<void> {
  const state = runs.get(kind) ?? { running: false, again: false };
  runs.set(kind, state);
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  try {
    do {
      state.again = false;
      await syncSafely(kind);
    } while (state.again);
  } finally {
    state.running = false;
  }
}

/** Asks for a sync after a Focus change. The work runs after the response, so the change isn't held up by Plex. */
export function requestFocusSync(kind: FocusKind): void {
  if (!syncEnabled()) return;
  lastRequested.set(kind, Date.now());
  after(() => syncFocusToPlex(kind));
}

/**
 * Asks for a sync of each kind whose last request is over 5 minutes old, or that has never been requested in this
 * process. Called from Home and the Focus pages, so changes made in Plex are put back, and titles that have arrived
 * in Plex since the last sync are added.
 */
export function syncFocusIfStale(): void {
  if (!syncEnabled()) return;
  const now = Date.now();
  for (const kind of FOCUS_KINDS) {
    const last = lastRequested.get(kind);
    if (last === undefined || now - last > STALE_AFTER_MS) requestFocusSync(kind);
  }
}

/** Forgets the requests and run states. For tests only. */
export function resetFocusSyncForTests(): void {
  lastRequested.clear();
  runs.clear();
}
