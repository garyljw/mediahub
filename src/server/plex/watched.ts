import "server-only";
import { createHash } from "node:crypto";
import { toWatchedIndex, type WatchedIndex } from "@/server/merge/watched";
import { getPlexDataConnection, type PlexDataConnection } from "./data-connection";
import { PlexRequestError } from "./errors";
import { getLibrarySections, getSectionItems, getServerIdentity, type PlexSectionItem, type ServerConnection } from "./server";

// The watched index for the Home banners: one load of every movie and show section, cached in memory for 60 s.
// Keyed by Plex user, so a future per-requester Plex user gets its own entry. Only the three-value states leave
// this module (see merge/watched.ts); the ids, counts and token never do.

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
function fingerprintOf(connection: PlexDataConnection): string {
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
        type: section.type,
        items: await getSectionItems(server, connection.token, section.key),
      })),
    );

    const movieItems: PlexSectionItem[] = loaded.filter((s) => s.type === "movie").flatMap((s) => s.items);
    const showItems: PlexSectionItem[] = loaded.filter((s) => s.type === "show").flatMap((s) => s.items);
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

/** Forgets every cached and in-flight index. For tests only. */
export function resetWatchedCache(): void {
  cache.clear();
  inFlight.clear();
}
