import "server-only";
import { createHash } from "node:crypto";
import { TmdbRequestError, type TmdbFailureKind } from "./errors";
import {
  AuthenticationSchema,
  ExternalIdsSchema,
  GenresSchema,
  EXCLUDED_MOVIE_GENRES,
  EXCLUDED_TV_GENRES,
  MovieDetailsSchema,
  ShowDetailsSchema,
  MovieListSchema,
  ProvidersSchema,
  RegionsSchema,
  TvListSchema,
  type TmdbMovie,
  type TmdbMovieDetails,
  type TmdbShowDetails,
  type TmdbProvider,
  type TmdbRegion,
  type TmdbShow,
} from "./schemas";
import type { z } from "zod";

export { TmdbRequestError } from "./errors";

// TMDB v3. The base URL is fixed here; the token goes only in the Authorization header, never in the URL.
const BASE_URL = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
/** Documentaries and Reality are left out of every section. */
const genreQuery = (ids: readonly number[]) => [...ids].sort((a, b) => a - b).join(",");
const WITHOUT_MOVIE_GENRES = genreQuery(EXCLUDED_MOVIE_GENRES);
const WITHOUT_TV_GENRES = genreQuery(EXCLUDED_TV_GENRES);
const FAILURE_TTL_MS = 60 * 1000;
const TVDB_TTL_MS = 24 * 60 * 60 * 1000;

const FAILURE_TEXT: Record<Exclude<TmdbFailureKind, "http">, string> = {
  timeout: "timed out",
  network: "network error",
  invalid: "invalid response",
};

type Params = Record<string, string | number>;

async function tmdbGet<S extends z.ZodType>(
  step: string,
  path: string,
  token: string,
  schema: S,
  params: Params = {},
): Promise<z.output<S>> {
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Name the kind only: the underlying error may contain the URL.
    const kind = error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network";
    throw new TmdbRequestError(`TMDB ${step} request failed: ${FAILURE_TEXT[kind]}`, kind);
  }
  if (!response.ok) {
    throw new TmdbRequestError(`TMDB ${step} request failed: HTTP ${response.status}`, "http", response.status);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TmdbRequestError(`TMDB ${step} request failed: ${FAILURE_TEXT.invalid}`, "invalid");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new TmdbRequestError(`TMDB ${step} request failed: ${FAILURE_TEXT.invalid}`, "invalid");
  return parsed.data;
}

// Calls are cached by call and parameters (never the token), so page loads don't re-hit TMDB. The promise is cached,
// so concurrent misses share one request. A failure is cached too, briefly (except TVDB ids, which an Add click asks for, so a retry must reach TMDB), so a refused token, a busy TMDB or an
// outage isn't retried on every view. A load that was in flight when the cache was cleared is no longer in the map,
// so it can't write stale data back (the generation check and the entry check below).
type Entry = { at: number; ttl: number; promise: Promise<unknown> };
const cache = new Map<string, Entry>();
let generation = 0;

/** Drops every cached call, including failures. Called when the TMDB settings are saved or removed. */
export function clearTmdbCache(): void {
  generation += 1;
  cache.clear();
}

const MAX_ENTRIES = 500;

/** On a miss: drops expired entries, then the oldest ones while the map is over its cap. */
function sweep(now: number): void {
  for (const [key, entry] of cache) if (now - entry.at >= entry.ttl) cache.delete(key);
  for (const key of cache.keys()) {
    if (cache.size < MAX_ENTRIES) break;
    cache.delete(key);
  }
}

/**
 * `failureTtl` is how long a failure is kept (null: not at all). `keep` says whether a successful value is worth
 * keeping; when it returns false the entry is dropped, so the next call asks TMDB again.
 */
function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
  failureTtl: number | null = FAILURE_TTL_MS,
  keep: (value: T) => boolean = () => true,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise as Promise<T>;
  sweep(Date.now());
  const loadedIn = generation;
  const entry: Entry = { at: Date.now(), ttl, promise: load() };
  cache.set(key, entry);
  entry.promise.then(
    (value) => {
      if (!keep(value as T) && cache.get(key) === entry) cache.delete(key);
    },
    () => {
      // Only the entry still in the map is changed: after a clear, the old load leaves nothing behind.
      if (generation !== loadedIn || cache.get(key) !== entry) return;
      if (failureTtl === null) cache.delete(key);
      else {
        entry.at = Date.now();
        entry.ttl = failureTtl;
      }
    },
  );
  return entry.promise as Promise<T>;
}

/**
 * A short fingerprint of the token, part of every cache key, so a list fetched with one token is never served for
 * another, whichever code path changed it. It is only ever used inside the cache keys: never logged or sent anywhere.
 */
function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function cachedGet<S extends z.ZodType>(
  step: string,
  path: string,
  token: string,
  schema: S,
  params: Params = {},
  ttl = CACHE_TTL_MS,
) {
  const key = `${tokenKey(token)}|${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;
  return cached(key, ttl, () => tmdbGet(step, path, token, schema, params));
}

/** Checks a token with TMDB. Throws TmdbRequestError (status 401 when the token is refused). */
export async function validateToken(token: string): Promise<void> {
  await tmdbGet("authentication", "/authentication", token, AuthenticationSchema);
}

/** The country list straight from TMDB, never cached. For checking a token that isn't saved yet. */
export function fetchRegions(token: string): Promise<TmdbRegion[]> {
  return tmdbGet("regions", "/watch/providers/regions", token, RegionsSchema, { language: "en-US" });
}

/** The country list for the Connections page, cached with the other lists. */
export function listRegions(token: string): Promise<TmdbRegion[]> {
  return cachedGet("regions", "/watch/providers/regions", token, RegionsSchema, { language: "en-US" });
}

/** Genre names by id for movies or TV, for the hover card. Cached for a day: the lists rarely change. */
export function getGenres(token: string, kind: "movie" | "tv"): Promise<Map<number, string>> {
  return cachedGet("genres", `/genre/${kind}/list`, token, GenresSchema, { language: "en-US" }, TVDB_TTL_MS);
}

/** One movie's page facts and cast. Cached for a day. A TMDB 404 is a TmdbRequestError with status 404. */
export function getMovieDetails(token: string, id: number): Promise<TmdbMovieDetails> {
  return cachedGet("movie details", `/movie/${id}`, token, MovieDetailsSchema, { language: "en-US", append_to_response: "credits" }, TVDB_TTL_MS);
}

/** One show's page facts and cast. Cached for a day. A TMDB 404 is a TmdbRequestError with status 404. */
export function getShowDetails(token: string, id: number): Promise<TmdbShowDetails> {
  return cachedGet("show details", `/tv/${id}`, token, ShowDetailsSchema, { language: "en-US", append_to_response: "aggregate_credits" }, TVDB_TTL_MS);
}

export function getTrendingMovies(token: string): Promise<TmdbMovie[]> {
  return cachedGet("trending movies", "/trending/movie/week", token, MovieListSchema, { language: "en-US" });
}

export function getTrendingShows(token: string): Promise<TmdbShow[]> {
  return cachedGet("trending shows", "/trending/tv/week", token, TvListSchema, { language: "en-US" });
}

export function getProviders(token: string, kind: "movie" | "tv", region: string): Promise<TmdbProvider[]> {
  return cachedGet("providers", `/watch/providers/${kind}`, token, ProvidersSchema, { watch_region: region });
}

function discoverParams(region: string, providerId: number): Params {
  return {
    watch_region: region,
    with_watch_providers: providerId,
    with_watch_monetization_types: "flatrate",
    sort_by: "popularity.desc",
    include_adult: "false",
    page: 1,
  };
}

export function discoverMovies(token: string, region: string, providerId: number): Promise<TmdbMovie[]> {
  return cachedGet("discover movies", "/discover/movie", token, MovieListSchema, {
    ...discoverParams(region, providerId),
    without_genres: WITHOUT_MOVIE_GENRES,
  });
}

export function discoverShows(token: string, region: string, providerId: number): Promise<TmdbShow[]> {
  return cachedGet("discover shows", "/discover/tv", token, TvListSchema, {
    ...discoverParams(region, providerId),
    without_genres: WITHOUT_TV_GENRES,
  });
}

export function getUpcomingMovies(token: string, region: string): Promise<TmdbMovie[]> {
  return cachedGet("upcoming movies", "/movie/upcoming", token, MovieListSchema, { region, language: "en-US", page: 1 });
}

/** The TVDB id for a TMDB show, or null when TMDB has none. An id is cached for a day (they don't change); a null is not, so a show TMDB links later can be added on a retry. */
export function getTvdbId(token: string, tmdbId: number): Promise<number | null> {
  const path = `/tv/${tmdbId}/external_ids`;
  return cached(`${tokenKey(token)}|${path}`, TVDB_TTL_MS, async () => (await tmdbGet("external ids", path, token, ExternalIdsSchema)).tvdbId, null, (tvdbId) => tvdbId !== null);
}

/** A UTC date as YYYY-MM-DD, `days` after `from`. Done by hand on the ISO text: no Intl, no local time zone. */
function utcDay(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The discover filter for a show's original language. Left out for "any". */
function languageParams(language: string): Params {
  return language === "any" ? {} : { with_original_language: language };
}

/** New shows with a first air date in the next 28 days, most popular first. */
export function getUpcomingShows(token: string, language: string): Promise<TmdbShow[]> {
  const today = new Date();
  return cachedGet("upcoming shows", "/discover/tv", token, TvListSchema, {
    "first_air_date.gte": utcDay(today, 0),
    "first_air_date.lte": utcDay(today, 28),
    sort_by: "popularity.desc",
    include_adult: "false",
    include_null_first_air_dates: "false",
    without_genres: WITHOUT_TV_GENRES,
    ...languageParams(language),
    language: "en-US",
    page: 1,
  });
}

/**
 * Shows with an episode airing in the next 7 days, most popular first. The type filter lists every TMDB show type
 * except Documentary (0), News (1), Reality (3) and Talk Show (5), and the excluded TV genres are left out too. This is
 * the discover call TMDB documents as /tv/on_the_air.
 */
export function getShowsOnThisWeek(token: string, language: string): Promise<TmdbShow[]> {
  const today = new Date();
  return cachedGet("shows on this week", "/discover/tv", token, TvListSchema, {
    "air_date.gte": utcDay(today, 0),
    "air_date.lte": utcDay(today, 7),
    with_type: "2|4|6",
    without_genres: WITHOUT_TV_GENRES,
    sort_by: "popularity.desc",
    include_adult: "false",
    ...languageParams(language),
    language: "en-US",
    page: 1,
  });
}
