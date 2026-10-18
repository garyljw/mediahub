import "server-only";

/** What the server remembers about one release it showed the admin. The browser only ever holds the token. */
export type CachedRelease = { guid: string; indexerId: number; title: string };

/** A release taken out of the cache. `restore` puts it back with its original expiry, for a grab Radarr refused. */
export type TakenRelease = { release: CachedRelease; restore: () => void };

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
     * expired. `restore` clears the mark, so the release keeps its place and its original expiry and a token
     * never outlives Radarr's own cache of the release. A taken release is dropped when it expires.
     */
    take(token: string): TakenRelease | undefined {
      const stored = entries.get(token);
      if (!stored || stored.taken) return undefined;
      if (stored.expiresAt <= now()) {
        entries.delete(token);
        return undefined;
      }
      stored.taken = true;
      return { release: stored.entry, restore: () => void (stored.taken = false) };
    },
    size(): number {
      return entries.size;
    },
  };
}

export type ReleaseCache = ReturnType<typeof createReleaseCache>;

/** Radarr caches interactive search results for 30 minutes, so tokens expire just before Radarr forgets the release. */
export const RELEASE_TTL_MS = 25 * 60_000;

/** Most releases held at once. Each search adds one entry per returned release, capped by the search itself. */
export const MAX_CACHED_RELEASES = 1000;

// Next's dev server reloads modules, and a bundle can be loaded twice. Keeping the cache on globalThis under
// a shared symbol means every copy of this module uses the same cache, so a token made in one copy can be
// taken in another.
const RELEASE_CACHE_KEY = Symbol.for("mediahub.releaseCache");
const globalWithCache = globalThis as typeof globalThis & { [RELEASE_CACHE_KEY]?: ReleaseCache };

export const releaseCache: ReleaseCache = (globalWithCache[RELEASE_CACHE_KEY] ??= createReleaseCache({
  ttlMs: RELEASE_TTL_MS,
  maxEntries: MAX_CACHED_RELEASES,
}));
