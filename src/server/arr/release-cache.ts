import "server-only";

/** Which app's interactive search a release came from. A token only works through the app that issued it. */
export type ReleaseApp = "radarr" | "sonarr";

/**
 * What a Sonarr search was for: one season of a series, or one episode. The grab sends this id along. Sonarr only
 * reads it when its cached release has no series or episodes mapped; a release missing from its cache is a 404 anyway.
 */
export type SonarrContext = { seriesId: number } | { episodeId: number };

/** What the server remembers about one release it showed the admin. The browser only ever holds the token. */
export type CachedRelease =
  | { app: "radarr"; guid: string; indexerId: number; title: string }
  | { app: "sonarr"; guid: string; indexerId: number; title: string; context: SonarrContext };

/** A release taken out of the cache. `restore` puts it back with its original expiry, for a grab the app refused. */
export type TakenRelease<T extends CachedRelease = CachedRelease> = { release: T; restore: () => void };

/** `taken` marks a release a grab is using or has used. It stays in place, so the Map order stays oldest-first. */
type StoredRelease = { entry: CachedRelease; expiresAt: number; taken: boolean };

/**
 * A small in-memory map from opaque tokens to releases. Entries expire after `ttlMs` and the oldest
 * are dropped once `maxEntries` is reached. `now` is injected so tests can move the clock.
 */
export function createReleaseCache({
  ttlMs,
  maxEntries,
  now = Date.now,
}: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}) {
  // A Map keeps insertion order, so the first key is always the oldest entry.
  const entries = new Map<string, StoredRelease>();

  function purgeExpired() {
    const time = now();
    for (const [token, stored] of entries) {
      if (stored.expiresAt <= time) entries.delete(token);
    }
  }

  function makeRoom() {
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    /** Stores a release under a new random token and returns the token. */
    put(entry: CachedRelease): string {
      purgeExpired();
      makeRoom();
      const token = crypto.randomUUID();
      entries.set(token, { entry, expiresAt: now() + ttlMs, taken: false });
      return token;
    },
    /**
     * Returns the release and marks it taken, so a token works only once. Undefined when missing, taken or
     * expired, or when it was issued for the other app. A token for the other app is left alone (not marked),
     * so the app that issued it can still take it. `restore` clears the mark, so the release keeps its place
     * and its original expiry and a token never outlives the app's own cache of the release. A taken release
     * is dropped when it expires.
     */
    take<A extends ReleaseApp>(token: string, app: A): TakenRelease<Extract<CachedRelease, { app: A }>> | undefined {
      const stored = entries.get(token);
      if (!stored || stored.taken) return undefined;
      if (stored.entry.app !== app) return undefined;
      if (stored.expiresAt <= now()) {
        entries.delete(token);
        return undefined;
      }
      stored.taken = true;
      return {
        release: stored.entry as Extract<CachedRelease, { app: A }>,
        restore: () => void (stored.taken = false),
      };
    },
    size(): number {
      return entries.size;
    },
  };
}

export type ReleaseCache = ReturnType<typeof createReleaseCache>;

/** Radarr and Sonarr cache interactive search results for 30 minutes, so tokens expire just before the app forgets the release. */
export const RELEASE_TTL_MS = 25 * 60_000;

/**
 * Most releases held at once. Each search adds one entry per grabbable returned release, up to 600 (200 per
 * protocol, unknown included), so this keeps a few recent searches. Each entry is a guid and a short title.
 */
export const MAX_CACHED_RELEASES = 2000;

// Next's dev server reloads modules, and a bundle can be loaded twice. Keeping the cache on globalThis under
// a shared symbol means every copy of this module uses the same cache, so a token made in one copy can be
// taken in another.
const RELEASE_CACHE_KEY = Symbol.for("mediahub.releaseCache");
const globalWithCache = globalThis as typeof globalThis & { [RELEASE_CACHE_KEY]?: ReleaseCache };

export const releaseCache: ReleaseCache = (globalWithCache[RELEASE_CACHE_KEY] ??= createReleaseCache({
  ttlMs: RELEASE_TTL_MS,
  maxEntries: MAX_CACHED_RELEASES,
}));
