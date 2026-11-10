import "server-only";
import { createHash } from "node:crypto";
import { toWatchedIndex, type WatchedIndex } from "@/server/merge/watched";
import { getPlexDataConnection, type PlexDataConnection } from "./data-connection";
import { PlexRequestError } from "./errors";
import {
  getLibrarySections,
  getSectionItems,
  getServerIdentity,
  getShowEpisodes,
  type PlexEpisodeItem,
  type ServerConnection,
} from "./server";

// The watched index for the Home banners and the series page: one load of every movie and show section, cached in
// memory for 60 s, plus a show's episodes on demand. Keyed by Plex user, so a future per-requester Plex user gets
// its own entry. The index and episode lists hold Plex ratingKeys and guids, so they stay on the server: pages pass
// only the three-value states (see merge/watched.ts) to the browser. The token never leaves this module's callers.

export const DEFAULT_PLEX_USER = "default";
const CACHE_TTL_MS = 60_000;
// A failure is remembered briefly, so an unreachable Plex doesn't hold up every Home visit while it is down.
const FAILURE_TTL_MS = 30_000;
// The identity check answers fast on a working server, so a short timeout stops a dead address delaying Home.
const IDENTITY_TIMEOUT_MS = 3_000;

type CacheEntry = { index: WatchedIndex | "failed"; loadedAt: number; fingerprint: string };
type InFlight = { fingerprint: string; promise: Promise<WatchedIndex | "failed"> };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlight>();

/**
 * The connection a cached index belongs to: address, server and (hashed) token. A change to any makes the entry
 * stale, so a reconnect with a different Plex account never shows the old account's state.
 */
export function fingerprintOf(connection: PlexDataConnection): string {
  return createHash("sha256").update(`${connection.url}|${connection.serverId}|${connection.token}`).digest("hex");
}

/**
 * Loads every movie and show section. The server identity is checked first, so the token is never sent to an
 * address that isn't the stored server. A Plex request failure is logged and reported as "failed".
 */
async function loadIndex(connection: PlexDataConnection): Promise<WatchedIndex | "failed"> {
  const server: ServerConnection = { url: connection.url, pinAddress: connection.pinAddress };
  try {
    const identity = await getServerIdentity(server, { timeoutMs: IDENTITY_TIMEOUT_MS });
    if (identity !== connection.serverId) {
      console.error("Plex watched: server identity did not match");
      return "failed";
    }

    const sections = await getLibrarySections(server, connection.token);
    const wanted = sections.filter((section) => section.type === "movie" || section.type === "show");
    const loaded = await Promise.all(
      wanted.map(async (section) => ({
        key: section.key,
        type: section.type,
        items: await getSectionItems(server, connection.token, section.key),
      })),
    );

    // Each item carries its section key, so the index can say which section a collection item lives in.
    const inSection = (type: string) =>
      loaded.filter((s) => s.type === type).flatMap((s) => s.items.map((item) => ({ ...item, sectionKey: s.key })));
    const movieItems = inSection("movie");
    const showItems = inSection("show");
    return toWatchedIndex(movieItems, showItems);
  } catch (error) {
    if (error instanceof PlexRequestError) {
      // PlexRequestError messages name the step and the kind only, so they are safe to log.
      console.error(`Plex watched: ${error.message}`);
      return "failed";
    }
    throw error;
  }
}

/**
 * The watched index for one Plex user, or null when no Plex data connection is set up (no banners, no message),
 * or "failed" when Plex can't be reached or isn't the stored server. A fresh cached index is returned without any
 * Plex call. Concurrent callers share one load. A failure is cached for 30 s.
 */
export async function getWatchedIndex(plexUser = DEFAULT_PLEX_USER): Promise<WatchedIndex | null | "failed"> {
  const connection = getPlexDataConnection();
  if (!connection) return null;
  const fingerprint = fingerprintOf(connection);

  const cached = cache.get(plexUser);
  const ttl = cached?.index === "failed" ? FAILURE_TTL_MS : CACHE_TTL_MS;
  if (cached && cached.fingerprint === fingerprint && Date.now() - cached.loadedAt < ttl) {
    return cached.index;
  }

  const pending = inFlight.get(plexUser);
  if (pending && pending.fingerprint === fingerprint) return pending.promise;

  const promise = loadIndex(connection).then((result) => {
    cache.set(plexUser, { index: result, loadedAt: Date.now(), fingerprint });
    return result;
  });
  const entry: InFlight = { fingerprint, promise };
  inFlight.set(plexUser, entry);
  // Only clear the entry this call made, so a newer load for another connection is left alone.
  promise.finally(() => {
    if (inFlight.get(plexUser) === entry) inFlight.delete(plexUser);
  }).catch(() => {});
  return promise;
}

/**
 * Every episode of one series in Plex, for the series page. Returns null when no Plex data connection is set up or the
 * series isn't in Plex (no column, no message). Returns "failed" when Plex can't be reached or isn't the stored server. Like loadIndex, the server identity is checked before
 * the token is sent. Not cached: the section index is, and one page visit makes one allLeaves call per matching show.
 */
export async function getSeriesEpisodeWatched(
  tvdbId: number,
  plexUser = DEFAULT_PLEX_USER,
): Promise<PlexEpisodeItem[] | null | "failed"> {
  const connection = getPlexDataConnection();
  if (!connection) return null;
  const index = await getWatchedIndex(plexUser);
  if (index === null) return null;
  if (index === "failed") return "failed";
  const keys = index.showKeys.get(tvdbId);
  if (!keys || keys.length === 0) return null;

  const server: ServerConnection = { url: connection.url, pinAddress: connection.pinAddress };
  try {
    const identity = await getServerIdentity(server, { timeoutMs: IDENTITY_TIMEOUT_MS });
    if (identity !== connection.serverId) {
      console.error("Plex episodes: server identity did not match");
      return "failed";
    }
    const lists = await Promise.all(keys.map((key) => getShowEpisodes(server, connection.token, key)));
    return lists.flat();
  } catch (error) {
    if (error instanceof PlexRequestError) {
      // PlexRequestError messages name the step and the kind only, so they are safe to log.
      console.error(`Plex episodes: ${error.message}`);
      return "failed";
    }
    throw error;
  }
}

/** Forgets every cached and in-flight index. For tests only. */
export function resetWatchedCache(): void {
  cache.clear();
  inFlight.clear();
}
