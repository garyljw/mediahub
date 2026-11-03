import "server-only";
import { radarrClient } from "./client";
import { LOOKUP_IMAGE_TTL_MS, cachedImage } from "@/server/image-cache";
import { fetchFixedJpeg } from "./poster";
import { ArrRequestError, arrRequest, getList } from "./request";
import { toRootFolderOptions, type RootFolderOption } from "./root-folders";
import type { components as RadarrComponents } from "./generated/radarr";

type MovieResource = RadarrComponents["schemas"]["MovieResource"];

/** One TMDB search hit, reduced to what the add dialog shows. Nothing else from Radarr's resource reaches the browser. */
export type LookupResult = {
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string;
  /** True when the movie is already in the Radarr library. */
  inLibrary: boolean;
  /** The TMDB poster file name (e.g. "abc123.jpg"), or null when there is no usable poster. Validated by tmdbPosterFile. */
  posterFile: string | null;
};

/** What the server needs to add one movie. The browser never sends a path or a title. */
export type MovieAdd = {
  tmdbId: number;
  qualityProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  searchForMovie: boolean;
};

/** Longest overview sent to the browser, in code points (so an emoji is never cut in half). Longer text is cut and ends with an ellipsis. */
const MAX_OVERVIEW = 300;
/** Most search hits returned. Radarr can return hundreds; the dialog only needs a short list. */
const MAX_RESULTS = 20;

/**
 * Why an add was refused: "not-found" when TMDB has no usable title for the id, "exists" when the
 * movie is already in the library. Thrown from addMovie and mapped to messages in the action.
 */
export class MovieAddError extends Error {
  constructor(readonly reason: "not-found" | "exists") {
    super(reason === "exists" ? "movie already in library" : "movie not found");
    this.name = "MovieAddError";
  }
}

/** A TMDB poster file name: letters and digits, then ".jpg". Also the only shape the poster route accepts. */
export const TMDB_POSTER_FILE = /^[A-Za-z0-9]{1,64}\.jpg$/;

const TMDB_HOST = "image.tmdb.org";
const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w342/";
const TMDB_HEADSHOT_BASE = "https://image.tmdb.org/t/p/w185/";

/**
 * The file name of a TMDB poster URL, or null. Accepts only https, the exact host image.tmdb.org with
 * no port or credentials, and a last path segment that is a bare TMDB file name.
 */
export function posterFileFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== TMDB_HOST || url.port !== "" || url.username !== "" || url.password !== "") {
      return null;
    }
    const last = url.pathname.split("/").pop() ?? "";
    return TMDB_POSTER_FILE.test(last) ? last : null;
  } catch {
    return null;
  }
}

/**
 * The TMDB poster file for a Radarr movie, or null. Tries remotePoster first, then the poster entry's
 * remoteUrl. Each candidate must pass posterFileFromUrl, so a URL on any other host or scheme is ignored.
 */
export function tmdbPosterFile(movie: MovieResource): string | null {
  const posterImage = movie.images?.find((image) => image.coverType === "poster")?.remoteUrl;
  for (const candidate of [movie.remotePoster, posterImage]) {
    if (typeof candidate !== "string" || candidate === "") continue;
    const file = posterFileFromUrl(candidate);
    if (file !== null) return file;
  }
  return null;
}

/** Radarr's year when it is a real year, otherwise null. Same rule as toMovieRows. */
function yearOrNull(year: unknown): number | null {
  return typeof year === "number" && year > 0 ? year : null;
}

/** Pure: Radarr search hits to dialog results, in upstream order, capped at MAX_RESULTS. */
export function toLookupResults(movies: MovieResource[], libraryTmdbIds: Set<number>): LookupResult[] {
  const results: LookupResult[] = [];
  for (const movie of movies) {
    if (results.length >= MAX_RESULTS) break;
    if (typeof movie.tmdbId !== "number" || !(movie.tmdbId > 0)) continue;
    if (!movie.title) continue;
    // Array.from splits by code point, so the cut and the length check never split a surrogate pair.
    const overviewChars = Array.from(movie.overview ?? "");
    results.push({
      tmdbId: movie.tmdbId,
      title: movie.title,
      year: yearOrNull(movie.year),
      overview: overviewChars.length > MAX_OVERVIEW ? `${overviewChars.slice(0, MAX_OVERVIEW - 1).join("")}…` : overviewChars.join(""),
      inLibrary: libraryTmdbIds.has(movie.tmdbId),
      posterFile: tmdbPosterFile(movie),
    });
  }
  return results;
}

/**
 * Searches TMDB through Radarr. The term goes in the typed client's query, never into a URL string.
 * The library lookup runs in parallel so each hit can say whether it is already in the library.
 */
export async function lookupMovies(term: string): Promise<LookupResult[]> {
  const client = radarrClient();
  const [hits, library] = await Promise.all([
    getList("Radarr movie lookup", (signal) => client.GET("/api/v3/movie/lookup", { params: { query: { term } }, signal })),
    getList("Radarr movie", (signal) => client.GET("/api/v3/movie", { signal })),
  ]);
  const libraryTmdbIds = new Set<number>();
  for (const movie of library) {
    if (typeof movie.tmdbId === "number") libraryTmdbIds.add(movie.tmdbId);
  }
  return toLookupResults(hits, libraryTmdbIds);
}

/** Root folders Radarr can add movies to, as dropdown options. */
export async function listRootFolders(): Promise<RootFolderOption[]> {
  const client = radarrClient();
  const folders = await getList("Radarr root folder", (signal) => client.GET("/api/v3/rootfolder", { signal }));
  return toRootFolderOptions(folders);
}

/**
 * Pure: the body for POST /api/v3/movie. Only these fields are sent. minimumAvailability is set
 * explicitly because Radarr's own default is "tba". `year` is left out when unknown.
 */
export function movieAddBody(add: MovieAdd, title: string, year: number | null): MovieResource {
  const body: MovieResource = {
    tmdbId: add.tmdbId,
    title,
    qualityProfileId: add.qualityProfileId,
    rootFolderPath: add.rootFolderPath,
    monitored: add.monitored,
    minimumAvailability: "released",
    addOptions: {
      monitor: add.monitored ? "movieOnly" : "none",
      searchForMovie: add.searchForMovie,
      addMethod: "manual",
    },
  };
  if (year !== null) body.year = year;
  return body;
}

/**
 * Adds one movie to Radarr. Looks the id up again so the title and year come from Radarr, not from
 * the browser. Refuses a movie that is already in the library. `onSend` runs just before the add request
 * goes out, so the caller knows that a later timeout may mean Radarr added the movie.
 */
export async function addMovie(add: MovieAdd, onSend: () => void = () => {}): Promise<{ title: string; year: number | null }> {
  const client = radarrClient();

  let found: MovieResource | undefined;
  try {
    found = await arrRequest("Radarr movie lookup", (signal) =>
      client.GET("/api/v3/movie/lookup/tmdb", { params: { query: { tmdbId: add.tmdbId } }, signal }),
    );
  } catch (error) {
    // Radarr answers 404 for an id it does not know. That is "not found", not a Radarr outage.
    if (error instanceof ArrRequestError && error.status === 404) throw new MovieAddError("not-found");
    throw error;
  }
  if (typeof found?.title !== "string" || found.title.trim() === "") throw new MovieAddError("not-found");
  const title = found.title;
  const year = yearOrNull(found.year);

  const existing = await getList("Radarr movie", (signal) =>
    client.GET("/api/v3/movie", { params: { query: { tmdbId: add.tmdbId } }, signal }),
  );
  if (existing.length > 0) throw new MovieAddError("exists");

  const body = movieAddBody(add, title, year);
  onSend();
  await arrRequest("Radarr movie add", (signal) => client.POST("/api/v3/movie", { body, signal }));

  return { title, year };
}

/**
 * One TMDB image as JPEG bytes. The file name must match TMDB_POSTER_FILE, and the fetch goes to the caller's fixed
 * base URL (a module constant) with no redirects, no custom headers and no Radarr key.
 */
async function getTmdbImage(label: string, base: string, file: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!TMDB_POSTER_FILE.test(file)) throw new ArrRequestError(`${label} request failed: invalid name`, "invalid");
  return cachedImage(`tmdb|${label}|${file}`, LOOKUP_IMAGE_TTL_MS, () => fetchFixedJpeg(label, `${base}${file}`));
}

/** One TMDB poster thumbnail (w342), for the Add movie search results. */
export function getTmdbPoster(file: string): Promise<Uint8Array<ArrayBuffer>> {
  return getTmdbImage("TMDB poster", TMDB_POSTER_BASE, file);
}

/** One TMDB person headshot (w185), for the movie page's cast row. */
export function getTmdbHeadshot(file: string): Promise<Uint8Array<ArrayBuffer>> {
  return getTmdbImage("TMDB headshot", TMDB_HEADSHOT_BASE, file);
}
