import "server-only";
import { toPlexAddedIndex, type PlexAddedIndex } from "@/server/merge/plex-added";
import { getPlexDataConnection, type PlexDataConnection } from "./data-connection";
import { PlexRequestError } from "./errors";
import {
  getLibrarySections,
  getSectionEpisodeAdded,
  getSectionItems,
  getServerIdentity,
  type PlexSectionItem,
  type ServerConnection,
} from "./server";
import { fingerprintOf } from "./watched";

// When each movie and series arrived in Plex, for the Home "Date downloaded" sort. It loads every movie and show section
// (and every show's episodes, for the newest episode date), and keeps the result for 5 minutes. The index holds guids
// and ratingKeys only as far as building it needs them: pages get ISO dates keyed by TMDB and TVDB id, nothing else.

const CACHE_TTL_MS = 5 * 60_000;
// A failure is remembered briefly, so an unreachable Plex doesn't hold up every Home visit while it is down.
const FAILURE_TTL_MS = 30_000;
// The identity check answers fast on a working server, so a short timeout stops a dead address delaying Home.
const IDENTITY_TIMEOUT_MS = 3_000;

type CacheEntry = { index: PlexAddedIndex | "failed"; loadedAt: number; fingerprint: string };

let cache: CacheEntry | null = null;
let inFlight: { fingerprint: string; promise: Promise<PlexAddedIndex | "failed"> } | null = null;

/**
 * Loads the added dates. The server identity is checked first, so the token is never sent to an address that isn't the
 * stored server. A Plex request failure is logged (its message names the step and kind only) and reported as "failed".
 */
async function loadIndex(connection: PlexDataConnection): Promise<PlexAddedIndex | "failed"> {
  const server: ServerConnection = { url: connection.url, pinAddress: connection.pinAddress };
  try {
    const identity = await getServerIdentity(server, { timeoutMs: IDENTITY_TIMEOUT_MS });
    if (identity !== connection.serverId) {
      console.error("Plex added: server identity did not match");
      return "failed";
    }

    const sections = await getLibrarySections(server, connection.token);
    const movieSections = sections.filter((section) => section.type === "movie");
    const showSections = sections.filter((section) => section.type === "show");

    // Every section starts at once, and a show section reads its items and its episodes together. Episodes are only
    // read for show sections: their newest addedAt is the show's date.
    const [movieLists, shows] = await Promise.all([
      Promise.all(movieSections.map((section) => getSectionItems(server, connection.token, section.key))),
      Promise.all(
        showSections.map(async (section) => {
          const [items, episodes] = await Promise.all([
            getSectionItems(server, connection.token, section.key),
            getSectionEpisodeAdded(server, connection.token, section.key),
          ]);
          return { items, episodes };
        }),
      ),
    ]);
    const movieItems: PlexSectionItem[] = movieLists.flat();
    return toPlexAddedIndex(
      movieItems,
      shows.flatMap((show) => show.items),
      shows.flatMap((show) => show.episodes),
    );
  } catch (error) {
    if (error instanceof PlexRequestError) {
      console.error(`Plex added: ${error.message}`);
      return "failed";
    }
    throw error;
  }
}

/**
 * When each movie and series arrived in Plex, or null when no Plex data connection is set up, or "failed" when Plex can't
 * be reached or isn't the stored server. A fresh cached index is returned without any Plex call. Concurrent callers share
 * one load. A failure is cached for 30 s.
 */
export async function getPlexAddedIndex(): Promise<PlexAddedIndex | null | "failed"> {
  const connection = getPlexDataConnection();
  if (!connection) return null;
  const fingerprint = fingerprintOf(connection);

  const ttl = cache?.index === "failed" ? FAILURE_TTL_MS : CACHE_TTL_MS;
  if (cache && cache.fingerprint === fingerprint && Date.now() - cache.loadedAt < ttl) return cache.index;

  if (inFlight && inFlight.fingerprint === fingerprint) return inFlight.promise;

  const entry = {
    fingerprint,
    promise: loadIndex(connection).then((result) => {
      cache = { index: result, loadedAt: Date.now(), fingerprint };
      return result;
    }),
  };
  inFlight = entry;
  // Only clear the load this call started, so a newer load for another connection is left alone.
  entry.promise
    .finally(() => {
      if (inFlight === entry) inFlight = null;
    })
    .catch(() => {});
  return entry.promise;
}

/** Forgets the cached and in-flight index. For tests only. */
export function resetPlexAddedCache(): void {
  cache = null;
  inFlight = null;
}
